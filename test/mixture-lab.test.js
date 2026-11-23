import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { screenSample, flushLead, compareTreatment } from '../src/engine.js';
import { canonicalJson } from '../src/exports.js';
import {
  LAB_PRESETS, LAB_SCENARIOS, SCENARIO_PARAMS, STRINGS,
  advisoryBlocks, buildComparator, buildDatasets, decodeLabHash, encodeLabHash,
  labBrief, labBriefPayload, normalizeLabState, runSelfTests, scenarioMatrix,
  sha256Bytes, sha256Hex, summarizeSample, tamperBrief, verifyBrief,
} from '../src/mixture-lab.js';

const base = (values = {}, advisory = 'none', ecoli = 'absent') =>
  ({ tap: 'Lab tap', advisory, ecoli, values });

/* ---------- pure-JS SHA-256 ---------- */

for (const [input, expected] of [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ['abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
    'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1'],
  ['The quick brown fox jumps over the lazy dog',
    'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
  ['a'.repeat(1000000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
]) {
  test(`FIPS 180-4 vector for ${input.length === 0 ? 'empty' : input.slice(0, 16)}`, () => {
    assert.equal(sha256Hex(input), expected);
  });
}

for (const input of [
  'bench 4.0 ppt', 'Plomo vs 10 ppb', 'Índice de Peligro', 'número ½ tap',
  '0'.repeat(4096), '\n\r\t boundaries', ' waterwatch-lab/v1 ',
  JSON.stringify({ a: [1, 2, 3], b: { c: null } }),
]) {
  test(`pure digest matches node:crypto for ${JSON.stringify(input.slice(0, 20))}`, () => {
    assert.equal(sha256Hex(input), createHash('sha256').update(input, 'utf8').digest('hex'));
  });
}

for (const [form, expected] of [
  [new Uint8Array([0x61, 0x62, 0x63]), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [new Uint8Array([0x61, 0x62, 0x63]).buffer, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [new DataView(new Uint8Array([0x61, 0x62, 0x63]).buffer), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
]) {
  test('byte views hash identically', () => {
    assert.equal(sha256Hex(form), expected);
    assert.equal(sha256Bytes(form).length, 32);
  });
}

for (const bad of [null, undefined, 42, {}, true, Symbol('x'), 7n]) {
  test(`digest input ${String(bad)} fails closed`, () => {
    assert.throws(() => sha256Hex(bad), TypeError);
  });
}

/* ---------- lab state and hash codec ---------- */

for (const preset of LAB_PRESETS) {
  for (const scenario of LAB_SCENARIOS) {
    for (const lang of ['en', 'es']) {
      test(`hash round trip ${preset}/${scenario}/${lang}`, () => {
        const state = { preset, scenario, lang, focus: 'lead' };
        assert.deepEqual(decodeLabHash(encodeLabHash(state)), state);
      });
    }
  }
}

for (const focus of [null, 'lead', 'copper', 'nitrate', 'arsenic', 'pfoa', 'pfos',
  'pfhxs', 'pfna', 'genx', 'pfbs', 'hazard-index']) {
  test(`hash round trip focus ${focus}`, () => {
    const state = { preset: 'baseline', scenario: 'ro', lang: 'en', focus };
    assert.deepEqual(decodeLabHash(`#${encodeLabHash(state)}`), state);
  });
}

for (const hostile of [
  null, undefined, '', '#', 'ww=', 'ww=!', 'ww=AAA', 'ww=AAAAA', 'ww=AAA=',
  '#ww=', '#ww', 'wv=AAAA', 'other', '#report',
  `ww=${Buffer.from('{"preset":"school","hack":1}').toString('base64url')}`,
  `ww=${Buffer.from('{"preset":"bogus"}').toString('base64url')}`,
  `ww=${Buffer.from('{"scenario":"bogus"}').toString('base64url')}`,
  `ww=${Buffer.from('{"lang":"fr"}').toString('base64url')}`,
  `ww=${Buffer.from('{"focus":"bogus"}').toString('base64url')}`,
  `ww=${Buffer.from('{"focus":7}').toString('base64url')}`,
  `ww=${Buffer.from('{"__proto__":{"a":1},"preset":"school"}').toString('base64url')}`,
  `ww=${Buffer.from('{"constructor":{"a":1},"preset":"school"}').toString('base64url')}`,
  `ww=${Buffer.from('{"preset":"school"}').toString('base64url').slice(0, -1)}x`,
  `ww=${Buffer.from('not json').toString('base64url')}`,
  `ww=${Buffer.from('[1,2]').toString('base64url')}`,
  `ww=${Buffer.from('"school"').toString('base64url')}`,
  `ww=${Buffer.from('null').toString('base64url')}`,
  `ww=${'A'.repeat(5000)}`,
]) {
  test(`hostile hash ${String(hostile).slice(0, 40)} fails closed`, () => {
    assert.equal(decodeLabHash(hostile), null);
  });
}

test('hash with padded base64 is rejected rather than silently accepted', () => {
  const body = encodeLabHash({ preset: 'school' }).slice(3);
  assert.equal(decodeLabHash(`ww=${body}=`), null);
});

for (const [input, expected] of [
  [{}, { preset: 'school', scenario: 'baseline', lang: 'en', focus: null }],
  [{ preset: 'storm' }, { preset: 'storm', scenario: 'baseline', lang: 'en', focus: null }],
  [{ preset: 'well', lang: 'es' }, { preset: 'well', scenario: 'baseline', lang: 'es', focus: null }],
]) {
  test(`state defaults fill for ${JSON.stringify(input)}`, () => {
    assert.deepEqual(normalizeLabState(input), expected);
  });
}

for (const bad of [null, undefined, 42, 'x', true, [], ['school'], Symbol('s'),
  { preset: 4 }, { preset: ['school'] }, { scenario: null }, { lang: 'EN' },
  { preset: '__proto__' }, { preset: 'constructor' }, { preset: 'prototype' },
  { focus: '__proto__' }, { focus: 'constructor' }, { focus: 'prototype' }]) {
  test(`state ${String(JSON.stringify(bad) ?? bad)} fails closed`, () => {
    assert.equal(normalizeLabState(bad), null);
  });
}

test('state reads only own enumerable keys and never the prototype chain', () => {
  const sneaky = Object.create({ preset: 'storm', lang: 'es' });
  assert.deepEqual(normalizeLabState(sneaky), { preset: 'school', scenario: 'baseline', lang: 'en', focus: null });
  assert.equal(normalizeLabState(JSON.parse('{"__proto__":{"preset":"storm"},"preset":"well"}')), null);
});

test('encode writes a deterministic ww= body', () => {
  const a = encodeLabHash({ preset: 'well', scenario: 'carbon', lang: 'es', focus: 'pfbs' });
  const b = encodeLabHash({ focus: 'pfbs', lang: 'es', scenario: 'carbon', preset: 'well' });
  assert.equal(a, b);
  assert.match(a, /^ww=[A-Za-z0-9_-]+$/);
  assert.throws(() => encodeLabHash({ preset: 'bogus' }), TypeError);
});

/* ---------- datasets and comparator ---------- */

test('all four presets build with synthetic origin and parsed taps', () => {
  const datasets = buildDatasets(null);
  assert.equal(datasets.length, 4);
  assert.deepEqual(datasets.map(d => d.id), ['school', 'well', 'storm', 'baseline']);
  assert.ok(datasets.every(d => d.source === 'synthetic' && d.samples.length > 0));
});

test('imported CSV joins the comparator with its real origin tag', () => {
  const samples = [{ tap: 'Cistern', advisory: 'none', ecoli: 'absent', values: { lead: '3' } }];
  const datasets = buildDatasets({ origin: 'unverified-input', samples });
  assert.equal(datasets.length, 5);
  assert.equal(datasets[4].source, 'unverified-input');
  const forged = buildDatasets({ origin: 'verified', samples });
  assert.equal(forged[4].source, 'unverified-input');
  const preset = buildDatasets({ origin: 'synthetic', samples });
  assert.equal(preset[4].source, 'synthetic');
});

test('comparator rows carry exact engine outputs, never rounded or zero-filled', () => {
  const rows = buildComparator(buildDatasets(null));
  assert.equal(rows.length, 4);
  const school = rows.find(row => row.id === 'school');
  const direct = screenSample({ tap: 'x', advisory: 'none', ecoli: 'absent', values: {
    lead: '24.6', copper: '310', nitrate: '2.1', arsenic: '1.2',
    pfoa: '1.3', pfos: '1.1', pfhxs: '0.9', pfna: '0.6', genx: '0.2', pfbs: '5',
  } });
  assert.equal(school.mixture.raw, direct.mixture.raw);
  assert.equal(school.mixture.status, direct.mixture.status);
  assert.equal(school.mixture.positives, direct.mixture.positives);
  assert.equal(school.ratios.pfoa.ratio, 1.3 / 4.0);
  assert.equal(school.ratios.pfos.ratio, 1.1 / 4.0);
  assert.equal(school.ratios.lead.status, 'above');
  assert.equal(school.legacyLead, 'above');
  assert.equal(school.unreported, 0);
});

test('comparator counts unreported cells and never converts them to zero', () => {
  const rows = buildComparator([{ id: 'imported', source: 'unverified-input',
    samples: [{ tap: 'Sparse', advisory: 'unknown', ecoli: 'unknown', values: { lead: '5' } }] }]);
  assert.equal(rows[0].unreported, 9);
  assert.equal(rows[0].values.copper, null);
  assert.equal(rows[0].ratios.copper.value, null);
  assert.equal(rows[0].ratios.copper.ratio, null);
  assert.ok(rows[0].unknowns.includes('advisory') && rows[0].unknowns.includes('ecoli'));
});

test('comparator rejects malformed dataset shapes', () => {
  assert.throws(() => buildComparator(null), TypeError);
  assert.throws(() => buildComparator([{ id: 'x', samples: [] }]), TypeError);
  assert.throws(() => buildComparator(['x']), TypeError);
  assert.throws(() => buildComparator([{ id: 'x', samples: [42] }]), TypeError);
});

test('PFBS is reported only as a mixture input, never an individual benchmark', () => {
  const summary = summarizeSample(base({ pfbs: '5000' }));
  assert.equal(summary.ratios.pfbs.benchmark, null);
  assert.equal(summary.ratios.pfbs.reference, '2000');
  assert.equal(summary.ratios.pfbs.mixtureInputOnly, true);
  assert.equal(summary.ratios.pfbs.ratio, 2.5);
  assert.equal(summary.ratios.pfbs.status, 'no-limit');
});

/* ---------- advisory and E. coli gating ---------- */

for (const [advisory, ecoli, expected] of [
  ['none', 'absent', false], ['none', 'unknown', false], ['unknown', 'absent', false],
  ['unknown', 'unknown', false],
  ['boil', 'absent', true], ['do-not-drink', 'absent', true], ['do-not-use', 'absent', true],
  ['none', 'present', true], ['unknown', 'present', true], ['boil', 'present', true],
  ['do-not-use', 'present', true],
]) {
  test(`claims gating advisory=${advisory} ecoli=${ecoli}`, () => {
    assert.equal(advisoryBlocks(base({ lead: '20' }, advisory, ecoli)), expected);
  });
}

/* ---------- scenario matrix ---------- */

test('baseline matrix reproduces the screen exactly', () => {
  const sample = base({ lead: '24.6', nitrate: '2.1', pfbs: '5' });
  const matrix = scenarioMatrix(sample, 'baseline');
  const direct = screenSample(sample);
  assert.equal(matrix.blocked, false);
  for (const row of matrix.rows) {
    const engine = direct.results.find(r => r.id === row.id);
    assert.equal(row.baseline.value, engine.value);
    assert.equal(row.baseline.status, engine.status);
    assert.equal(row.cell.kind, engine.value === null ? 'unreported' : 'measured');
  }
  assert.equal(matrix.hazardIndex.baseline.value, direct.mixture.raw);
});

test('flush matrix applies the engine exponential only to lead', () => {
  const sample = base({ lead: '24', copper: '310' });
  const matrix = scenarioMatrix(sample, 'flush');
  const lead = matrix.rows.find(row => row.id === 'lead').cell;
  assert.equal(lead.kind, 'modeled');
  assert.equal(lead.value, flushLead({ initial: '24', ...SCENARIO_PARAMS.flush }));
  const copper = matrix.rows.find(row => row.id === 'copper').cell;
  assert.equal(copper.kind, 'unmodeled');
  assert.equal(copper.value, '310');
});

for (const [scenario, filterIndex] of [['carbon', 0], ['ro', 1]]) {
  test(`${scenario} matrix matches compareTreatment removal fractions`, () => {
    const sample = base({ lead: '20', pfoa: '8', nitrate: '12', arsenic: '9' });
    const matrix = scenarioMatrix(sample, scenario);
    const engine = compareTreatment(sample, SCENARIO_PARAMS.cost).filters[filterIndex];
    for (const row of matrix.rows) {
      if (row.baseline.value === null) {
        assert.equal(row.cell.kind, 'unreported');
      } else if (Object.hasOwn(engine.removal, row.id)) {
        assert.equal(row.cell.kind, 'modeled');
        assert.equal(row.cell.value, engine.values[row.id]);
      } else {
        assert.equal(row.cell.kind, 'uncovered');
        assert.equal(row.cell.value, null);
      }
    }
  });
}

for (const scenario of ['flush', 'carbon', 'ro']) {
  test(`${scenario} withholds every modeled claim under boil advisory`, () => {
    const matrix = scenarioMatrix(base({ lead: '30', pfoa: '8' }, 'boil'), scenario);
    assert.equal(matrix.blocked, true);
    assert.ok(matrix.rows.every(row => row.cell.kind === 'blocked'));
    assert.equal(matrix.hazardIndex.cell.kind, 'blocked');
  });
  test(`${scenario} withholds every modeled claim under positive E. coli`, () => {
    const matrix = scenarioMatrix(base({ lead: '30', pfoa: '8' }, 'none', 'present'), scenario);
    assert.equal(matrix.blocked, true);
    assert.ok(matrix.rows.every(row => row.cell.kind === 'blocked'));
  });
  test(`${scenario} still computes under advisory unknown`, () => {
    const matrix = scenarioMatrix(base({ lead: '30' }, 'unknown', 'unknown'), scenario);
    assert.equal(matrix.blocked, false);
  });
}

test('unknown scenario ids fail closed', () => {
  for (const bad of ['', 'carbon ', 'CARBON', 'distill', null, 3, {}]) {
    assert.throws(() => scenarioMatrix(base({ lead: '1' }), bad), RangeError);
  }
});

test('hostile samples fail closed inside the matrix', () => {
  for (const bad of [null, 7, 'x', base({ lead: 'ND' }), base({ lead: '<2' }),
    base({ lead: '-1' }), base({ lead: '1e6' }), base({ lead: NaN }),
    base({ lead: Infinity }), { tap: 'x', values: null }]) {
    assert.throws(() => scenarioMatrix(bad, 'baseline'), /decimal|object|measurement/i);
  }
});

test('modeled Hazard Index is a lower bound when constituents are unreported', () => {
  const matrix = scenarioMatrix(base({ pfhxs: '6', pfna: '5' }), 'baseline');
  assert.equal(matrix.hazardIndex.cell.kind, 'modeled');
  assert.equal(matrix.hazardIndex.cell.lowerBound, true);
  assert.equal(matrix.hazardIndex.cell.missing, 2);
});

test('modeled Hazard Index is unreported when every constituent is blank', () => {
  const matrix = scenarioMatrix(base({}), 'carbon');
  assert.equal(matrix.hazardIndex.cell.kind, 'unreported');
});

/* ---------- lab brief and digest ---------- */

const briefInput = (overrides = {}) => ({
  state: { preset: 'well', scenario: 'carbon', lang: 'en', focus: 'pfoa', ...overrides },
  comparator: buildDatasets(null),
  matrix: scenarioMatrix(base({ lead: '20', pfoa: '8' }), 'carbon'),
});

test('brief payload is deterministic and carries schema, ruleset, scope, origin', () => {
  const brief = labBrief(briefInput());
  assert.equal(brief.payload.schema, 'waterwatch-lab/v1');
  assert.equal(brief.payload.origin, 'synthetic');
  assert.match(brief.payload.scope, /educational screening/i);
  assert.match(brief.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(brief.fingerprint, sha256Hex(canonicalJson(brief.payload)));
  assert.equal(brief.fingerprint, createHash('sha256').update(canonicalJson(brief.payload), 'utf8').digest('hex'));
});

test('one canonical brief is cached per state key and reused everywhere', () => {
  const input = briefInput();
  const a = labBrief(input);
  const b = labBrief({ ...input, state: { focus: 'pfoa', lang: 'en', scenario: 'carbon', preset: 'well' } });
  assert.equal(a, b);
  assert.ok(a.json.includes(a.fingerprint));
  assert.ok(a.csv.includes(a.fingerprint));
  assert.ok(a.markdown.includes(a.fingerprint));
  assert.equal(JSON.parse(a.json).fingerprint, a.fingerprint);
});

test('distinct states stamp distinct digests', () => {
  const a = labBrief(briefInput());
  const b = labBrief(briefInput({ scenario: 'ro' }));
  const c = labBrief(briefInput({ focus: 'lead' }));
  assert.notEqual(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
});

test('CSV provenance header stamps sha256, origin, scope, and state', () => {
  const brief = labBrief(briefInput());
  const lines = brief.csv.split('\r\n');
  assert.equal(lines[1], `"sha256","${brief.fingerprint}"`);
  assert.equal(lines[3], '"origin","synthetic"');
  assert.match(lines[4], /educational screening/i);
  assert.match(lines[5], /"state",/);
  assert.ok(brief.csv.endsWith('\r\n'));
});

test('Markdown footer carries the digest and the educational scope line', () => {
  const brief = labBrief(briefInput());
  assert.ok(brief.markdown.includes(`Digest: ${brief.fingerprint}`));
  assert.match(brief.markdown, /Educational screening only/);
  assert.ok(brief.markdown.includes('| school | synthetic |'));
});

test('comparator rows in the payload carry origin per dataset', () => {
  const brief = labBrief(briefInput());
  assert.ok(brief.payload.comparator.every(row => row.origin === 'synthetic'));
  const withImport = labBrief({
    state: { preset: 'imported' },
    comparator: buildDatasets({ origin: 'unverified-input',
      samples: [{ tap: 'T', advisory: 'none', ecoli: 'absent', values: {} }] }),
    matrix: null,
  });
  const imported = withImport.payload.comparator.find(row => row.source === 'imported');
  assert.equal(imported.origin, 'unverified-input');
  assert.equal(withImport.payload.origin, 'unverified-input');
});

test('verifyBrief recomputes parity and tamperBrief proves mismatch', () => {
  const brief = labBrief(briefInput());
  const good = verifyBrief(brief);
  assert.equal(good.ok, true);
  assert.equal(good.actual, brief.fingerprint);
  const bad = tamperBrief(brief);
  assert.equal(bad.ok, false);
  assert.notEqual(bad.actual, brief.fingerprint);
  const foreign = verifyBrief({ fingerprint: brief.fingerprint, payload: { different: true } });
  assert.equal(foreign.ok, false);
});

test('brief export rejects an unencodable state', () => {
  assert.throws(() => labBrief({ state: { preset: 'bogus' }, comparator: buildDatasets(null), matrix: null }), RangeError);
  assert.throws(() => labBriefPayload({ state: null, comparator: [], matrix: null }), RangeError);
});

test('formula-like tap names stay escaped inside the exported CSV', () => {
  const brief = labBrief({
    state: { preset: 'imported' },
    comparator: [{ id: 'imported', source: 'unverified-input',
      samples: [{ tap: '=CMD()', advisory: 'none', ecoli: 'absent', values: { lead: '1' } }] }],
    matrix: null,
  });
  assert.ok(brief.csv.includes('"\'=CMD()"'));
});

/* ---------- self tests ---------- */

test('in-page self tests all pass and number at least fourteen', () => {
  const tests = runSelfTests();
  assert.ok(tests.length >= 14, `only ${tests.length} self tests`);
  for (const item of tests) {
    assert.equal(item.ok, true, `${item.id}: ${item.detail}`);
  }
});

test('self tests cover the required invariants', () => {
  const ids = runSelfTests().map(item => item.id);
  for (const required of [
    'sha256-empty', 'sha256-abc', 'hi-exact-arithmetic', 'pfbs-single-constituent-guard',
    'nd-never-zero', 'lead-10-vs-15', 'advisory-blocks-claims', 'origin-tags',
    'csv-formula-escape', 'tamper-detect', 'hash-roundtrip', 'unreported-counted',
  ]) {
    assert.ok(ids.includes(required), `missing self test ${required}`);
  }
});

/* ---------- localization ---------- */

test('EN and ES string tables expose identical key trees', () => {
  const keys = obj => Object.keys(obj)
    .flatMap(key => (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])
      ? [`${key}`, ...keys(obj[key]).map(inner => `${key}.${inner}`)]
      : [key]))
    .sort();
  assert.deepEqual(keys(STRINGS.en), keys(STRINGS.es));
});

test('no shipped lab string uses a forbidden dash', () => {
  const forbidden = [0x2013, 0x2014].map(code => String.fromCodePoint(code));
  const leaves = obj => Object.values(obj)
    .flatMap(value => (value && typeof value === 'object' ? leaves(value)
      : typeof value === 'function' ? [] : [String(value)]));
  for (const text of [...leaves(STRINGS.en), ...leaves(STRINGS.es)]) {
    assert.equal(forbidden.some(dash => text.includes(dash)), false, text);
  }
});

test('lab headings are sentence case, never all-caps kickers', () => {
  for (const lang of ['en', 'es']) {
    for (const key of ['title', 'comparatorTitle', 'scenarioTitle', 'exportsTitle',
      'hiChartTitle', 'ratioChartTitle']) {
      assert.doesNotMatch(STRINGS[lang][key], /^[A-ZÁÉÍÓÚÑ ]{3,}$/, `${lang}.${key}`);
    }
  }
});

test('every preset and scenario and focus id has localized names', () => {
  for (const id of LAB_PRESETS) {
    assert.ok(STRINGS.en.sourceNames[id] && STRINGS.es.sourceNames[id], id);
  }
  for (const id of LAB_SCENARIOS) {
    assert.ok(STRINGS.en.scenario[id] && STRINGS.es.scenario[id], id);
  }
});
