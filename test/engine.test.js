import assert from 'node:assert/strict';
import test from 'node:test';
import { boilModel, compareTreatment, flushLead, normalizeSample, screenSample } from '../src/engine.js';

const input = (values = {}, advisory = 'none', ecoli = 'absent') =>
  ({ tap: 'Lab tap', advisory, ecoli, values });
const result = (id, value) => screenSample(input({ [id]: value })).results.find(row => row.id === id);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

const benchmarks = [
  ['lead', '9.999999999999', '10', '10.000000000001', 'action level', 'ppb'],
  ['copper', '1299.999999999999', '1300', '1300.000000000001', 'action level', 'ppb'],
  ['nitrate', '9.999999999999', '10', '10.000000000001', 'MCL', 'mg/L as N'],
  ['arsenic', '9.999999999999', '10', '10.000000000001', 'MCL', 'ppb'],
  ['pfoa', '3.999', '4.0', '4.001', 'MCL', 'ppt'],
  ['pfos', '3.999', '4.0', '4.001', 'MCL', 'ppt'],
  ['pfhxs', '9.999999999999', '10', '10.000000000001', 'MCL', 'ppt'],
  ['pfna', '9.999999999999', '10', '10.000000000001', 'MCL', 'ppt'],
  ['genx', '9.999999999999', '10', '10.000000000001', 'MCL', 'ppt'],
];

for (const [id, below, equal, above, kind, unit] of benchmarks) {
  for (const [value, expected] of [[below, 'below'], [equal, 'at'], [above, 'above'], [null, 'missing'], ['0', 'below']]) {
    test(`${id} reports ${value ?? 'unreported'} as ${expected} with correct units and benchmark`, () => {
      const row = result(id, value);
      assert.deepEqual([row.value, row.status, row.limit, row.kind, row.unit], [value, expected, equal, kind, unit]);
    });
  }
  test(`${id} above the benchmark is part of the boil conflict`, () => {
    const screened = screenSample(input({ [id]: above }, 'boil'));
    assert.equal(screened.action, 'co-occurrence');
    const mixtureFlag = ['pfhxs', 'pfna', 'genx'].includes(id) ? ['hazard-index'] : [];
    assert.deepEqual(screened.chemicals, [id, ...mixtureFlag]);
  });
}

for (const id of ['pfoa', 'pfos']) {
  for (const [value, shown, context] of [
    ['0', '0.0', 'below'], ['0.00000404', '0.0000040', 'below'], ['3.949', '3.9', 'below'],
    ['3.95', '4.0', 'at'], ['3.999', '4.0', 'at'], ['4.001', '4.0', 'at'], ['4.049', '4.0', 'at'],
    ['4.05', '4.1', 'above'], ['4.099', '4.1', 'above'],
  ]) {
    test(`${id} ${value} shows two significant figures without replacing raw input`, () => {
      const row = result(id, value);
      assert.deepEqual([row.value, row.rounded, row.roundedStatus], [value, shown, context]);
    });
  }
}

for (const id of ['pfhxs', 'pfna', 'genx']) {
  for (const [value, shown, context] of [
    ['9.49', '9', 'below'], ['9.5', '10', 'at'], ['10.001', '10', 'at'], ['14.999', '10', 'at'], ['15', '20', 'above'],
  ]) {
    test(`${id} ${value} has one-significant-figure context ${shown}`, () => {
      const row = result(id, value);
      assert.deepEqual([row.value, row.rounded, row.roundedStatus], [value, shown, context]);
    });
  }
}

for (const id of ['pfoa', 'pfos']) {
  test(`${id} rounding context stays inside the 12-fraction input grammar when the value allows it`, () => {
    const row = result(id, '0.000000000001');
    assert.equal(row.rounded, '0.000000000001');
    assert.match(row.rounded, /^[0-9]{1,9}(?:\.[0-9]{1,12})?$/);
  });
}

for (const [value, expected] of [[null, 'missing'], ['10.001', 'below'], ['14.999999999999', 'below'],
  ['15', 'at'], ['15.000000000001', 'above'], ['999999999.999999999999', 'above']]) {
  test(`legacy lead 15 ppb reports ${value ?? 'unreported'} as ${expected}`, () => {
    assert.equal(screenSample(input({ lead: value })).legacyLead, expected);
  });
}

const hi = values => screenSample(input(values)).mixture;
const mixture = (pfhxs, pfna, genx, pfbs) => ({ pfhxs, pfna, genx, pfbs });
for (const [values, exact, status, rounded, roundedStatus] of [
  [mixture('3', '3', '3', '199.8'), '0.9999', 'below', '1', 'at'],
  [mixture('3', '3', '3', '200'), '1', 'at', '1', 'at'],
  [mixture('3', '3', '3', '200.2'), '1.0001', 'above', '1', 'at'],
  [mixture('3', '3', '3', '200.000000000001'), '1.0000000000000005', 'above', '1', 'at'],
  [mixture('3', '3', '3', '199.999999999999'), '0.9999999999999995', 'below', '1', 'at'],
  [mixture('0', '2', '2', '0'), '0.4', 'not-applicable', null, null],
  [mixture('3', '3', '3', '99.999999999999'), '0.9499999999999995', 'below', '0.9', 'below'],
  [mixture('3', '3', '3', '100'), '0.95', 'below', '1', 'at'],
  [mixture('4', '4', '4', '599.999999999999'), '1.4999999999999995', 'above', '1', 'at'],
  [mixture('4', '4', '4', '600'), '1.5', 'above', '2', 'above'],
  [mixture('6', '5', '0', '0'), '1.1', 'above', '1', 'at'],
  [mixture('10', '0', '0', '0'), '1', 'not-applicable', null, null],
  [mixture('0', '0', '0', '2000'), '1', 'not-applicable', null, null],
  [mixture('0', '0', '0', '5000'), '2.5', 'above', null, null],
  [mixture('0', '0', '0', '0'), '0', 'not-applicable', null, null],
  [mixture('0', '0', '0', null), '0', 'incomplete', null, null],
  [mixture('4', '4', '0', null), '0.8', 'incomplete', null, null],
  [mixture('5', '5', '0', null), '1', 'incomplete', null, null],
  [mixture('6', '5', '0', null), '1.1', 'above-lower-bound', null, null],
  [mixture('0', '0', null, '5000'), '2.5', 'above-lower-bound', null, null],
  [mixture(null, null, null, null), null, 'incomplete', null, null],
]) {
  test(`mixture ${JSON.stringify(values)} preserves exact ${exact} and eligibility`, () => {
    const screened = hi(values);
    assert.deepEqual([screened.raw, screened.status, screened.rounded, screened.roundedStatus],
      [exact, status, rounded, roundedStatus]);
  });
}

test('mixture returns every quotient and denominators without including PFOA or PFOS', () => {
  const screened = hi({ pfoa: '99', pfos: '99', ...mixture('2.7', '5.4', null, '20') });
  assert.deepEqual(screened.terms, [
    { id: 'pfhxs', denominator: '10', pql: '3.0', quotient: '0.27', quantified: false },
    { id: 'pfna', denominator: '10', pql: '4.0', quotient: '0.54', quantified: true },
    { id: 'genx', denominator: '10', pql: '5.0', quotient: null, quantified: false },
    { id: 'pfbs', denominator: '2000', pql: '3.0', quotient: '0.01', quantified: true },
  ]);
  assert.deepEqual(screened.missing, ['genx']);
  assert.equal(screened.positives, 3);
  assert.equal(screened.quantified, 2);
  assert.equal(screened.epaMixture, true);
});

test('PFBS has no individual maximum contaminant level', () => {
  const row = result('pfbs', '999999999');
  assert.deepEqual([row.status, row.limit, row.rounded], ['no-limit', null, null]);
});

const MIXTURE_IDS = ['pfhxs', 'pfna', 'genx', 'pfbs'];
const ALL_CHEMICAL_IDS = ['lead', 'copper', 'nitrate', 'arsenic', 'pfoa', 'pfos', 'pfhxs', 'pfna', 'genx', 'pfbs'];

test('a lone PFBS exceedance still flags the summed index', () => {
  const clean = Object.fromEntries(ALL_CHEMICAL_IDS.map(id => [id, '0']));
  clean.pfbs = '5000';
  const screened = screenSample(input(clean));
  assert.equal(screened.mixture.status, 'above');
  assert.equal(screened.action, 'chemical');
  assert.deepEqual(screened.chemicals, ['hazard-index']);
});

test('a summed index above 1 flags regardless of missing terms or positive count', () => {
  const withMissing = screenSample(input(mixture('0', '0', null, '5000')));
  assert.equal(withMissing.mixture.status, 'above-lower-bound');
  assert.equal(withMissing.action, 'chemical');
  const singleMcl = screenSample(input({ ...Object.fromEntries(MIXTURE_IDS.map(id => [id, '0'])), pfhxs: '15' }));
  assert.equal(singleMcl.mixture.status, 'above');
  assert.deepEqual(singleMcl.chemicals, ['pfhxs', 'hazard-index']);
});

const complete = { lead: '0', copper: '20', nitrate: '1', arsenic: '1', pfoa: '0', pfos: '0',
  pfhxs: '1', pfna: '1', genx: '0', pfbs: '1' };

for (const [notice, ecoli, values, expected] of [
  ['do-not-use', 'present', { nitrate: '25' }, 'do-not-use'],
  ['do-not-drink', 'present', { nitrate: '25' }, 'do-not-drink'],
  ['do-not-use', 'absent', complete, 'do-not-use'],
  ['do-not-drink', 'absent', complete, 'do-not-drink'],
  ['boil', 'present', complete, 'boil'],
  ['boil', 'absent', {}, 'boil'],
  ['boil', 'unknown', { nitrate: '11' }, 'co-occurrence'],
  ['boil', 'present', { ...complete, nitrate: '10' }, 'co-occurrence'],
  ['boil', 'present', mixture('6', '5', '0', null), 'co-occurrence'],
  ['boil', 'absent', mixture('6', '5', '0', '0'), 'co-occurrence'],
  ['none', 'present', { arsenic: '10.001' }, 'co-occurrence'],
  ['none', 'present', {}, 'microbial'],
  ['unknown', 'present', {}, 'microbial'],
  ['none', 'absent', { pfoa: '4.000000000001' }, 'chemical'],
  ['none', 'absent', complete, 'review'],
  ['none', 'unknown', complete, 'incomplete'],
  ['unknown', 'absent', complete, 'incomplete'],
  ['none', 'absent', {}, 'incomplete'],
  ['unknown', 'unknown', { lead: '16' }, 'chemical'],
]) {
  test(`alert priority: ${notice}/${ecoli}/${JSON.stringify(values)} => ${expected}`, () => {
    assert.equal(screenSample(input(values, notice, ecoli)).action, expected);
  });
}

test('exactly 10 mg/L nitrate with boil advisory and E. coli blocks boiled-formula advice', () => {
  const screened = screenSample(input({ nitrate: '10.0' }, 'boil', 'present'));
  assert.equal(screened.results.find(row => row.id === 'nitrate').status, 'at');
  assert.deepEqual(screened.chemicals, []);
  assert.equal(screened.action, 'co-occurrence');
});

test('quantitation levels decide EPA mixture eligibility at exact boundaries', () => {
  const exact = hi(mixture('3.0', '4.0', '5.0', '3.0'));
  assert.equal(exact.quantified, 4);
  assert.equal(exact.epaMixture, true);
  const justBelow = hi(mixture('2.999999999999', '3.999999999999', '4.999999999999', '2.999999999999'));
  assert.equal(justBelow.quantified, 0);
  assert.equal(justBelow.epaMixture, false);
});

test('unknown fields do not become zero or disappear from the safety report', () => {
  const screened = screenSample({ tap: 'T', values: { lead: '0' } });
  assert.deepEqual(screened.unknowns, ['copper', 'nitrate', 'arsenic', 'pfoa', 'pfos', 'pfhxs', 'pfna',
    'genx', 'pfbs', 'advisory', 'ecoli']);
});

for (const value of [NaN, Infinity, -0.001, '-1', '1e-6', '1,000', '1.1 mg/L', '.5', '5.', '5/2', {},
  false, '  ', 'ND', '<0.5', '1000000000', '0.1234567890123', '+2', '0x20']) {
  test(`concentration ${String(value)} (${typeof value}) fails closed`, () => {
    assert.throws(() => normalizeSample(input({ lead: value })), /decimal/);
  });
}

for (const value of ['', '    ', 'X'.repeat(101), 'fake\nname', 'before\u202Eafter', '\uD800', null]) {
  test(`tap ${JSON.stringify(value)} rejected`, () => {
    assert.throws(() => normalizeSample({ tap: value }), /Tap name/);
  });
}

for (const [value, expected] of [
  ['a\u00A0b', 'a b'], ['a\u2028b', 'a b'], ['a\u2029b', 'a b'],
  ['a\u2003\u2003b', 'a b'], ['North\u00A0tap', 'North tap'], ['\u00A0\u00A0padded\u00A0\u00A0', 'padded'],
]) {
  test(`tap ${JSON.stringify(value)} stores ${JSON.stringify(expected)}`, () => {
    assert.equal(normalizeSample({ tap: value }).tap, expected);
  });
}

test('tap length counts code points, so astral characters are not double-billed', () => {
  const emojiTap = `${'💧'.repeat(60)} tap`;
  assert.equal(normalizeSample({ tap: emojiTap }).tap, emojiTap);
  assert.throws(() => normalizeSample({ tap: '💧'.repeat(101) }), /Tap name/);
});

test('advisory and organism are closed input vocabularies', () => {
  assert.throws(() => normalizeSample(input({}, 'boil water')), /advisory/i);
  assert.throws(() => normalizeSample(input({}, 'none', '0')), /E\. coli/);
});

test('non-object samples fail closed with a type error', () => {
  for (const bad of [null, undefined, 42, 'x', true]) {
    assert.throws(() => normalizeSample(bad), TypeError);
    assert.throws(() => screenSample(bad), TypeError);
  }
});

test('prototype properties are not accepted as readings or mistaken for own data', () => {
  assert.throws(() => normalizeSample(input(JSON.parse('{"__proto__":3}'))), /Unknown measurement/);
  assert.equal(normalizeSample(input(Object.create({ lead: '4' }))).values.lead, null);
});

for (const [percent, factor] of [[0, 1], [10, 10 / 9], [20, 1.25], [37.5, 1.6], [50, 2], [75, 4], [95, 20]]) {
  test(`illustrative water loss ${percent}% conserves dissolved nonvolatile mass`, () => {
    const modeled = boilModel(input({ lead: '24', nitrate: '12', pfbs: '200' }), percent);
    near(modeled.factor, factor);
    near(modeled.values.lead * (1 - percent / 100), 24);
    near(modeled.values.nitrate * (1 - percent / 100), 12);
    near(modeled.values.pfbs * (1 - percent / 100), 200);
    assert.equal(modeled.values.arsenic, null);
  });
}

for (const percent of [-1, 95.1, 100, null, ' ', 'five']) {
  test(`boil model rejects unsupported loss ${JSON.stringify(percent)}`, () => {
    assert.throws(() => boilModel(input(), percent), /Evaporation/);
  });
}

const flush = { initial: '30', background: '2', volumeLiters: '8', flowLitersPerMinute: '4' };
for (const [minutes, expected] of [
  [0, 30], [1, 18.98285847195374], [2, 12.300624352800385], [4, 5.789387930625155],
  [6, 3.39403791430019], [8, 2.512837888884557], [10, 2.188662515974393],
]) {
  test(`flush curve at minute ${minutes} and monotonic approach to its floor`, () => {
    const current = flushLead({ ...flush, minutes });
    near(current, expected);
    const later = flushLead({ ...flush, minutes: minutes + 1 });
    assert.ok(later < current && later > 2);
  });
}

test('doubling the flow or halving the stagnant volume is equivalent in this model', () => {
  const fast = flushLead({ ...flush, minutes: 2, flowLitersPerMinute: 8 });
  near(fast, flushLead({ ...flush, minutes: 2, volumeLiters: 4 }));
  near(fast, flushLead({ ...flush, minutes: 4 }));
});

for (const [field, value] of [
  ['volumeLiters', '0'], ['flowLitersPerMinute', '0'], ['minutes', '-1'], ['initial', null], ['background', '35'],
]) {
  test(`flush model rejects invalid ${field} = ${value}`, () => {
    assert.throws(() => flushLead({ ...flush, minutes: 2, [field]: value }), /outside|nonnegative/);
  });
}

const economics = { litersPerDay: '4', bottledPerLiter: '0.75', waterPerLiter: '0.002' };
test('cost calculation accounts for volume, recurring costs, RO waste and upfront expense', () => {
  const { annualBottled, filters: [carbon, ro] } = compareTreatment(input(), economics);
  near(annualBottled, 1095);
  near(carbon.annualOperating, 77.92);
  near(ro.annualOperating, 113.76);
  near(carbon.annualFirstYear, 122.92);
  near(ro.annualFirstYear, 393.76);
  assert.deepEqual([carbon.paybackMonth, ro.paybackMonth], [1, 4]);
});

for (const [id, expected] of [
  ['lead', [2, 1]], ['nitrate', [null, 3]], ['arsenic', [null, 2]], ['pfoa', [5, 2]], ['pfos', [5, 2]],
  ['pfhxs', [null, null]], ['pfna', [null, null]], ['genx', [null, null]], ['pfbs', [null, null]],
  ['copper', [null, null]],
]) {
  test(`only explicit model claims produce a ${id} estimate`, () => {
    const estimates = compareTreatment(input({ [id]: '20' }), economics).filters.map(item => item.values[id]);
    for (let k = 0; k < estimates.length; k += 1) {
      if (expected[k] === null) assert.equal(estimates[k], null);
      else near(estimates[k], expected[k]);
    }
  });
}

for (const [id, price, delta, month] of [
  ['carbon', '0.206249999999', 'below crossover', 1921], ['carbon', '0.20625', 'exact crossover', 1920],
  ['carbon', '0.206250000001', 'above crossover', 1920], ['ro', '0.302399999999', 'below crossover', 626],
  ['ro', '0.3024', 'exact crossover', 625], ['ro', '0.302400000001', 'above crossover', 625],
]) {
  test(`${id} exact integer month ${delta}`, () => {
    const { filters } = compareTreatment(input(), { litersPerDay: '1', bottledPerLiter: price, waterPerLiter: '0' });
    assert.equal(filters.find(model => model.id === id).paybackMonth, month);
  });
}

test('no fictitious payback when modeled bottled cost is below filter operating cost', () => {
  assert.deepEqual(compareTreatment(input(), { ...economics, bottledPerLiter: '0' }).filters
    .map(item => item.paybackMonth), [null, null]);
});
