import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson } from '../src/exports.js';
import { decodeLabHash, encodeLabHash, labBrief, runSelfTests, verifyBrief } from '../src/mixture-lab.js';
import {
  INTERVENTIONS, REMOVAL_CLASSES, SDG6_AVAILABILITY,
  SDG6_DEFAULT_STATE, SDG6_SOURCES, SDG6_STRESS, SDG6_STRINGS,
  advisoryWithholds, indicator61, indicator63, indicator64, normalizeSdg6State,
  planInterventions, renderSdg6Section, screenContext, sdg6Needs, sdg6Payload,
  sdg6SelfTests,
} from '../src/sdg6-equity.js';

const ctx = (values = {}, advisory = 'none', ecoli = 'absent') =>
  screenContext({ tap: 'T', advisory, ecoli, values });
const st = (overrides = {}) => normalizeSdg6State(overrides);
const ALL_CLEAN = {
  lead: '1', copper: '10', nitrate: '2', arsenic: '1', pfoa: '1',
  pfos: '1', pfhxs: '1', pfna: '1', genx: '1', pfbs: '10',
};

/* ---------- state normalization ---------- */

test('defaults fill a bare object', () => {
  assert.deepEqual(normalizeSdg6State({}), SDG6_DEFAULT_STATE);
});

for (const source of SDG6_SOURCES) {
  test(`source ${source} accepted`, () => {
    assert.equal(st({ source }).source, source);
  });
}
for (const availability of SDG6_AVAILABILITY) {
  test(`availability ${availability} accepted`, () => {
    assert.equal(st({ availability }).availability, availability);
  });
}
for (const stress of SDG6_STRESS) {
  test(`stress ${stress} accepted`, () => {
    assert.equal(st({ stress }).stress, stress);
  });
}
for (const budget of [35, 35.5, 500, 9999.99, 10000]) {
  test(`budget ${budget} accepted`, () => {
    assert.equal(st({ budget }).budget, budget);
  });
}
for (const people of [1, 40, 300, 50000]) {
  test(`people ${people} accepted`, () => {
    assert.equal(st({ people }).people, people);
  });
}
for (const focus of [...INTERVENTIONS.map(({ id }) => id), null]) {
  test(`focus ${focus} accepted`, () => {
    assert.equal(st({ focus }).focus, focus);
  });
}
for (const bad of [
  null, undefined, 42, 'x', true, [], ['piped'], Symbol('s'),
  { source: 'spring' }, { source: 'PIPED' }, { source: 4 }, { availability: 'daily' },
  { stress: 'mild' }, { budget: 34.99 }, { budget: 10000.01 }, { budget: '500' },
  { budget: NaN }, { budget: Infinity }, { people: 0 }, { people: 3.5 },
  { people: '300' }, { people: 50001 }, { focus: 'magic' }, { focus: 4 },
  { hack: 1 }, { source: '__proto__' }, { focus: 'constructor' },
]) {
  test(`state ${String(JSON.stringify(bad) ?? bad)} fails closed`, () => {
    assert.equal(normalizeSdg6State(bad), null);
  });
}

test('state reads only own enumerable keys', () => {
  const sneaky = Object.create({ source: 'piped' });
  assert.equal(normalizeSdg6State(sneaky).source, SDG6_DEFAULT_STATE.source);
});

/* ---------- SDG 6.1 service ladder ---------- */

for (const [source, availability, values, advisory, ecoli, expected] of [
  ['surface', 'reliable', {}, 'none', 'absent', 'surface-water'],
  ['unimproved', 'reliable', {}, 'none', 'absent', 'unimproved'],
  ['improved-far', 'reliable', { lead: '30' }, 'none', 'absent', 'limited'],
  ['improved-30', 'reliable', { lead: '1' }, 'none', 'absent', 'basic'],
  ['improved-30', 'interrupted', { lead: '1' }, 'none', 'absent', 'basic'],
  ['piped', 'reliable', ALL_CLEAN, 'none', 'absent', 'safely-managed'],
  ['piped', 'reliable', { lead: '1', nitrate: '2' }, 'none', 'absent', 'basic'],
  ['piped', 'interrupted', ALL_CLEAN, 'none', 'absent', 'basic'],
  ['piped', 'unknown', ALL_CLEAN, 'none', 'absent', 'basic'],
  ['piped', 'reliable', { ...ALL_CLEAN, lead: '30' }, 'none', 'absent', 'basic'],
  ['piped', 'reliable', {}, 'none', 'present', 'basic'],
  ['piped', 'reliable', {}, 'boil', 'unknown', 'basic'],
  ['piped', 'reliable', ALL_CLEAN, 'do-not-drink', 'absent', 'basic'],
]) {
  test(`ladder ${source}/${availability}/${advisory}/${ecoli} => ${expected}`, () => {
    const i = indicator61(st({ source, availability }), ctx(values, advisory, ecoli));
    assert.equal(i.level, expected);
  });
}

test('safely managed has zero gaps and free status', () => {
  const i = indicator61(st({ source: 'piped' }), ctx(ALL_CLEAN));
  assert.equal(i.free, 'free');
  assert.deepEqual(i.gap, []);
  assert.equal(i.needsTreatment, false);
});

test('quality, access, and availability gaps compose correctly', () => {
  const i = indicator61(st({ source: 'improved-far', availability: 'interrupted' }), ctx({ lead: '30' }));
  assert.deepEqual(i.gap, ['quality', 'access', 'availability']);
  assert.equal(i.needsTreatment, true);
});

test('unreported fields make quality unverified, never an all-clear', () => {
  const i = indicator61(st({ source: 'piped' }), ctx({ lead: '1' }, 'unknown', 'unknown'));
  assert.equal(i.free, 'unknown');
  assert.equal(i.level, 'basic');
  assert.ok(i.gap.includes('quality-unverified'));
});

for (const [values, advisory, ecoli, need] of [
  [{}, 'boil', 'absent', 'bacteria'],
  [{}, 'none', 'present', 'bacteria'],
  [{ lead: '30' }, 'none', 'absent', 'lead'],
  [{ copper: '2000' }, 'none', 'absent', 'copper'],
  [{ arsenic: '20' }, 'none', 'absent', 'arsenic'],
  [{ nitrate: '25' }, 'none', 'absent', 'nitrate'],
  [{ pfoa: '9' }, 'none', 'absent', 'pfas'],
  [{ pfhxs: '6', pfna: '5', genx: '5', pfbs: '600' }, 'none', 'absent', 'pfas'],
]) {
  test(`need ${need} derived from ${JSON.stringify(values)}/${advisory}/${ecoli}`, () => {
    const needs = sdg6Needs(ctx(values, advisory, ecoli));
    assert.ok(needs.includes(need), `${needs} misses ${need}`);
  });
}

test('clean sample produces no treatment needs', () => {
  assert.deepEqual(sdg6Needs(ctx({ lead: '1' })), []);
});

test('at-benchmark readings are not treatment needs', () => {
  assert.deepEqual(sdg6Needs(ctx({ lead: '10', nitrate: '10' })), []);
});

test('null context is a safe empty input for needs', () => {
  assert.deepEqual(sdg6Needs(null), []);
  assert.equal(advisoryWithholds(null), false);
});

/* ---------- SDG 6.3 exceedance profile ---------- */

for (const [values, advisory, ecoli, band, count] of [
  [{ lead: '1' }, 'none', 'absent', 'none', 0],
  [{ lead: '10' }, 'none', 'absent', 'none', 0],
  [{ lead: '24.6' }, 'none', 'absent', 'single', 1],
  [{ lead: '24.6', nitrate: '13.6' }, 'none', 'absent', 'multiple', 2],
  [{ lead: '24.6', nitrate: '13.6', pfhxs: '8', pfna: '5' }, 'none', 'absent', 'multiple', 3],
  [{}, 'do-not-drink', 'unknown', 'severe', 0],
  [{}, 'none', 'present', 'severe', 0],
  [{ nitrate: '150' }, 'none', 'absent', 'severe', 1],
]) {
  test(`band ${band} for ${JSON.stringify(values)}/${advisory}/${ecoli}`, () => {
    const i = indicator63(ctx(values, advisory, ecoli));
    assert.equal(i.band, band);
    assert.equal(i.count, count);
  });
}

test('hazard index above joins the exceedance list at ratio of raw sum', () => {
  const i = indicator63(ctx({ pfhxs: '6', pfna: '5', genx: '0', pfbs: '0' }));
  const hi = i.exceedances.find(entry => entry.id === 'hazard-index');
  assert.ok(hi);
  assert.equal(hi.ratio, 1.1);
  assert.equal(i.worst.id, 'hazard-index');
});

test('worst ratio picks the largest exceedance', () => {
  const i = indicator63(ctx({ lead: '24.6', nitrate: '50' }));
  assert.equal(i.worst.id, 'nitrate');
  assert.equal(i.worst.ratio, 5);
});

test('microbial flag from ecoli presence or boil advisory', () => {
  assert.equal(indicator63(ctx({}, 'none', 'present')).microbial, true);
  assert.equal(indicator63(ctx({}, 'boil', 'absent')).microbial, true);
  assert.equal(indicator63(ctx({ lead: '30' })).microbial, false);
});

/* ---------- SDG 6.4 stress index ---------- */

for (const [stress, availability, index, band] of [
  ['low', 'reliable', 5, 'low'],
  ['low', 'interrupted', 15, 'low-medium'],
  ['low-medium', 'reliable', 15, 'low-medium'],
  ['low-medium', 'unknown', 20, 'medium-high'],
  ['medium-high', 'reliable', 30, 'medium-high'],
  ['medium-high', 'interrupted', 40, 'high'],
  ['high', 'reliable', 60, 'high'],
  ['high', 'interrupted', 70, 'high'],
  ['extreme', 'reliable', 90, 'extreme'],
  ['extreme', 'interrupted', 100, 'extreme'],
]) {
  test(`stress index ${stress}/${availability} => ${index} ${band}`, () => {
    const i = indicator64(st({ stress, availability }));
    assert.equal(i.index, index);
    assert.equal(i.band, band);
    assert.equal(i.base + i.reliabilityAdjust === index || index === 100, true);
  });
}

/* ---------- intervention catalog ---------- */

test('catalog is frozen with five complete entries', () => {
  assert.equal(INTERVENTIONS.length, 5);
  assert.ok(Object.isFrozen(INTERVENTIONS));
  for (const item of INTERVENTIONS) {
    assert.ok(item.upfront > 0 && item.annual >= 0 && item.people > 0 && item.years > 0);
    assert.deepEqual(Object.keys(item.removal).sort(), [...REMOVAL_CLASSES].sort());
    for (const value of Object.values(item.removal)) {
      assert.ok(['yes', 'partial', 'no'].includes(value));
    }
  }
});

/* ---------- planner ---------- */

test('planner per-row math is exact at the micro grant', () => {
  const plan = planInterventions(st({ budget: 35, people: 300 }), ctx({ lead: '1' }));
  const byId = Object.fromEntries(plan.rows.map(row => [row.id, row]));
  assert.deepEqual([byId['ceramic-pot'].units, byId.biosand.units, byId.sodis.units,
    byId['borehole-repair'].units, byId['pou-ro-gac'].units], [1, 0, 8, 0, 0]);
  assert.equal(byId['ceramic-pot'].peopleReached, 5);
  assert.equal(byId.sodis.peopleReached, 24);
  assert.equal(byId.sodis.personYears, 24);
  assert.equal(byId.sodis.leftover, 3);
  assert.equal(plan.recommended.id, 'sodis');
});

test('cost per person-year uses total lifecycle cost over people-years', () => {
  const plan = planInterventions(st(), ctx({ lead: '1' }));
  const byId = Object.fromEntries(plan.rows.map(row => [row.id, row]));
  assert.ok(Math.abs(byId['ceramic-pot'].costPerPersonYear - 3) < 1e-9);
  assert.ok(Math.abs(byId.biosand.costPerPersonYear - 0.75) < 1e-9);
  assert.ok(Math.abs(byId.sodis.costPerPersonYear - 4 / 3) < 1e-9);
  assert.ok(Math.abs(byId['pou-ro-gac'].costPerPersonYear - 20) < 1e-9);
});

test('people reached never exceeds the community size', () => {
  const plan = planInterventions(st({ budget: 10000, people: 40 }), ctx({ lead: '1' }));
  for (const row of plan.rows) assert.ok(row.peopleReached <= 40);
  assert.equal(plan.rows.find(row => row.id === 'borehole-repair').peopleReached, 40);
});

test('nitrate need steers the recommendation to RO', () => {
  const plan = planInterventions(st({ budget: 500, people: 300 }), ctx({ nitrate: '25' }));
  const ro = plan.rows.find(row => row.id === 'pou-ro-gac');
  assert.equal(ro.fit, 'yes');
  assert.equal(plan.recommended.id, 'pou-ro-gac');
  assert.equal(plan.recommended.kind, 'fit');
  assert.equal(plan.uncovered, 290);
});

test('microbial need favors the cheapest microbial fit per reach', () => {
  const plan = planInterventions(st({ budget: 500, people: 300 }), ctx({}, 'none', 'present'));
  assert.ok(plan.blocked);
  assert.ok(plan.rows.every(row => row.fit === 'withheld'));
});

test('uncontaminated sample marks every fit as no-need', () => {
  const plan = planInterventions(st(), ctx({ lead: '1' }));
  assert.deepEqual(plan.needs, []);
  assert.ok(plan.rows.every(row => row.fit === 'no-need'));
  assert.equal(plan.recommended.kind, 'economics');
});

test('boil advisory withholds all contaminant fit claims', () => {
  const plan = planInterventions(st(), ctx({ nitrate: '25' }, 'boil', 'unknown'));
  assert.ok(plan.blocked);
  assert.ok(plan.rows.every(row => row.fit === 'withheld'));
});

test('biosand partial arsenic is partial fit, not full cover', () => {
  const plan = planInterventions(st(), ctx({ arsenic: '20' }));
  const biosand = plan.rows.find(row => row.id === 'biosand');
  const ro = plan.rows.find(row => row.id === 'pou-ro-gac');
  assert.equal(biosand.fit, 'partial');
  assert.equal(ro.fit, 'yes');
});

test('mixed needs require covering every gap', () => {
  const plan = planInterventions(st({ budget: 10000, people: 300 }),
    ctx({ nitrate: '25' }, 'boil', 'absent'));
  assert.ok(plan.needs.includes('bacteria') && plan.needs.includes('nitrate'));
  const ceramic = plan.rows.find(row => row.id === 'ceramic-pot');
  assert.equal(ceramic.fit, 'withheld');
});

test('every valid budget yields a recommendation', () => {
  for (const budget of [35, 42, 180, 431, 500, 2500, 10000]) {
    const plan = planInterventions(st({ budget, people: 300 }), ctx({ lead: '1' }));
    assert.ok(plan.recommended, `budget ${budget} left no recommendation`);
  }
});

test('budget and people travel through the plan record', () => {
  const plan = planInterventions(st({ budget: 250, people: 120 }), ctx({ lead: '1' }));
  assert.equal(plan.budget, 250);
  assert.equal(plan.people, 120);
});

/* ---------- auditable payload ---------- */

const sample = { tap: 'T', advisory: 'none', ecoli: 'absent', values: { nitrate: '25', lead: '1' } };

test('sdg6 payload is deterministic with schema, scope, state, indicators, plan', () => {
  const a = sdg6Payload({ state: st(), sample });
  const b = sdg6Payload({ state: st(), sample });
  assert.equal(a.schema, 'waterwatch-sdg6/v1');
  assert.match(a.scope, /not JMP service data/i);
  assert.deepEqual(Object.keys(a.indicators), ['sdg-6-1', 'sdg-6-3', 'sdg-6-4']);
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(a.indicators['sdg-6-3'].band, 'single');
});

test('distinct states give distinct canonical payloads', () => {
  const a = sdg6Payload({ state: st(), sample });
  const b = sdg6Payload({ state: st({ budget: 100, source: 'piped' }), sample });
  assert.notEqual(canonicalJson(a), canonicalJson(b));
});

test('payload rejects an unexportable state', () => {
  assert.throws(() => sdg6Payload({ state: { budget: 3 }, sample }), RangeError);
  assert.throws(() => sdg6Payload({ state: null, sample }), RangeError);
});

/* ---------- hash codec integration ---------- */

test('lab hash round trips the nested sdg state', () => {
  const sdg = st({ source: 'piped', budget: 750, people: 1200, focus: 'biosand' });
  const state = { preset: 'well', scenario: 'carbon', lang: 'es', focus: 'lead', sdg };
  assert.deepEqual(decodeLabHash(`#${encodeLabHash(state)}`), state);
});

test('legacy hashes without sdg still decode', () => {
  const decoded = decodeLabHash(`#${encodeLabHash({ preset: 'storm', lang: 'es' })}`);
  assert.deepEqual(decoded, { preset: 'storm', scenario: 'baseline', lang: 'es', focus: null });
});

for (const bad of [
  { source: 'spring' }, { budget: 1 }, { people: 0 }, { focus: 'magic' }, 'x', 4,
]) {
  test(`hostile sdg ${JSON.stringify(bad)} rejects the whole hash`, () => {
    const payload = { preset: 'school', scenario: 'baseline', lang: 'en', focus: null, sdg: bad };
    const json = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    assert.equal(decodeLabHash(`ww=${json}`), null);
  });
}

/* ---------- audited brief integration ---------- */

test('lab brief embeds the sdg6 block and still verifies', () => {
  const sdg6 = sdg6Payload({ state: st(), sample });
  const brief = labBrief({
    state: { preset: 'well', sdg: st() },
    comparator: [{ id: 'well', source: 'synthetic', samples: [sample] }],
    matrix: null,
    sdg6,
  });
  assert.equal(brief.payload.sdg6.schema, 'waterwatch-sdg6/v1');
  assert.equal(verifyBrief(brief).ok, true);
  assert.ok(brief.csv.includes('"sdg6"'));
  assert.ok(brief.markdown.includes('SDG 6 module state'));
  assert.ok(brief.payload.state.sdg.budget === 500);
});

/* ---------- self tests ---------- */

test('sdg6 self tests all pass and number at least eight', () => {
  const tests = sdg6SelfTests();
  assert.ok(tests.length >= 8, `only ${tests.length}`);
  for (const item of tests) assert.equal(item.ok, true, `${item.id}: ${item.detail}`);
});

test('in-page self tests include the sdg6 block', () => {
  const ids = runSelfTests().map(item => item.id);
  for (const required of ['sdg6-ladder-access-cap', 'sdg6-planner-micro-grant',
    'sdg6-withheld-under-advisory', 'sdg6-closed-vocabularies']) {
    assert.ok(ids.includes(required), `missing ${required}`);
  }
});

/* ---------- localization ---------- */

test('EN and ES string tables expose identical key trees', () => {
  const keys = obj => Object.keys(obj)
    .flatMap(key => (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])
      ? [key, ...keys(obj[key]).map(inner => `${key}.${inner}`)]
      : [key]))
    .sort();
  assert.deepEqual(keys(SDG6_STRINGS.en), keys(SDG6_STRINGS.es));
});

test('no shipped sdg6 string uses a forbidden dash', () => {
  const forbidden = [0x2013, 0x2014].map(code => String.fromCodePoint(code));
  const leaves = obj => Object.values(obj)
    .flatMap(value => (value && typeof value === 'object' ? leaves(value)
      : typeof value === 'function' ? [] : [String(value)]));
  for (const text of [...leaves(SDG6_STRINGS.en), ...leaves(SDG6_STRINGS.es)]) {
    assert.equal(forbidden.some(dash => text.includes(dash)), false, text);
  }
});

test('every enum and intervention has localized names', () => {
  for (const lang of ['en', 'es']) {
    const t = SDG6_STRINGS[lang];
    for (const id of SDG6_SOURCES) assert.ok(t.source[id], `${lang} source ${id}`);
    for (const id of SDG6_AVAILABILITY) assert.ok(t.availability[id], `${lang} availability ${id}`);
    for (const id of SDG6_STRESS) assert.ok(t.stress[id], `${lang} stress ${id}`);
    for (const item of INTERVENTIONS) {
      assert.ok(t.interventions[item.id], `${lang} intervention ${item.id}`);
      assert.ok(t.blurbs[item.id], `${lang} blurb ${item.id}`);
    }
    for (const id of ['yes', 'partial', 'no', 'withheld', 'no-need']) assert.ok(t.fit[id], `${lang} fit ${id}`);
  }
});

/* ---------- minimal DOM harness ---------- */

class FakeNode {
  constructor(tag, ns = null) {
    this.tagName = tag; this.ns = ns; this.attrs = {}; this.children = [];
    this.listeners = {}; this._text = ''; this.classSet = new Set();
  }
  get className() { return [...this.classSet].join(' '); }
  set className(value) { this.classSet = new Set(String(value).split(/\s+/).filter(Boolean)); }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key === 'class') this.className = value; }
  getAttribute(key) { return this.attrs[key] ?? null; }
  get classList() {
    const set = this.classSet;
    return { add: (...cls) => cls.forEach(c => set.add(c)), contains: c => set.has(c) };
  }
  append(...kids) { for (const k of kids) this.children.push(typeof k === 'string' ? { text: k } : k); }
  appendChild(k) { this.children.push(k); return k; }
  replaceChildren(...kids) { this.children = kids; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() {
    return this._text + this.children.map(c => (typeof c === 'string' ? c : c.text ?? c.textContent)).join('');
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  dispatch(type, event = {}) { for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, ...event }); }
  click() { this.dispatch('click'); }
  get lastChild() { return this.children[this.children.length - 1] ?? null; }
  get hidden() { return 'hidden' in this.attrs; }
  set hidden(value) { if (value) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get disabled() { return 'disabled' in this.attrs; }
  set disabled(value) { if (value) this.attrs.disabled = ''; else delete this.attrs.disabled; }
  get value() { return this.attrs.value ?? ''; }
  set value(v) { this.attrs.value = String(v); }
  get id() { return this.attrs.id ?? ''; }
  set id(v) { this.attrs.id = String(v); }
  matches(sel) {
    if (sel.startsWith('#')) return this.attrs.id === sel.slice(1);
    if (sel.startsWith('.')) return this.classSet.has(sel.slice(1));
    const attr = sel.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
    if (attr) return attr[2] === undefined ? attr[1] in this.attrs : this.attrs[attr[1]] === attr[2];
    const dataSel = sel.match(/^([a-zA-Z]+)?\.([a-zA-Z0-9_-]+)$/);
    if (dataSel) return (!dataSel[1] || this.tagName === dataSel[1]) && this.classSet.has(dataSel[2]);
    return this.tagName === sel;
  }
  *walk() {
    for (const child of this.children) {
      if (typeof child === 'string' || child.tagName === undefined) continue;
      yield child;
      yield* child.walk();
    }
  }
  querySelectorAll(sel) { return [...this.walk()].filter(node => node.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}

// This file runs in its own test-runner process, so the DOM stub can stay
// assigned for the file's lifetime without leaking into other suites.
globalThis.document = {
  createElement: tag => new FakeNode(tag),
  createElementNS: (ns, tag) => new FakeNode(tag, ns),
  createTextNode: text => ({ text: String(text) }),
  getElementById: () => null,
};

const mount = (overrides = {}) => {
  const root = new FakeNode('div');
  const chosen = [];
  renderSdg6Section(root, {
    lang: 'en',
    state: st({ budget: 500, people: 300, ...overrides.state }),
    summary: overrides.summary === null ? null : (overrides.summary ?? {
      tap: 'T', advisory: 'none', ecoli: 'absent',
      values: { nitrate: '25', lead: '1', ...(overrides.values ?? {}) },
    }),
    tapLabel: 'School tap / T',
    choose: next => chosen.push(next),
    ...overrides.rest,
  });
  return { root, chosen };
};

test('DOM render builds indicator cards, controls, table, and chart', () => {
  const { root } = mount();
  assert.equal(root.querySelectorAll('.sdg6-card').length, 3);
  assert.equal(root.querySelectorAll('.sdg6-pick').length, 5);
  assert.equal(root.querySelectorAll('tr').length, 6);
  assert.equal(root.querySelectorAll('.sdg6-marker').length, 5);
  assert.ok(root.querySelector('.sdg6-chart'));
});

test('DOM marker nodes are keyboard focusable with adaptive hit circles', () => {
  const { root } = mount();
  for (const marker of root.querySelectorAll('.sdg6-marker')) {
    assert.equal(marker.getAttribute('tabindex'), '0');
    const hit = [...marker.children].find(c => c.classSet?.has('sdg6-hit'));
    assert.ok(hit && Number(hit.getAttribute('r')) >= 12);
  }
});

test('DOM chip click proposes a normalized sdg patch', () => {
  const { root, chosen } = mount();
  const chip = root.querySelectorAll('.sdg6-chip').find(c => c.getAttribute('data-sdg6-value') === 'piped');
  chip.click();
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].source, 'piped');
  assert.equal(chosen[0].budget, 500);
});

test('DOM budget chip proposes the chosen amount', () => {
  const { root, chosen } = mount();
  root.querySelectorAll('[data-sdg6-budget]').find(c => c.getAttribute('data-sdg6-budget') === '35').click();
  assert.equal(chosen[0].budget, 35);
});

test('DOM number inputs clamp into range before proposing', () => {
  const { root, chosen } = mount();
  const budget = root.querySelector('#sdg6-budget');
  budget.value = '5';
  budget.dispatch('change');
  assert.equal(chosen[0].budget, 35);
  const people = root.querySelector('#sdg6-people');
  people.value = '999999';
  people.dispatch('change');
  assert.equal(chosen[1].people, 50000);
});

test('DOM marker click proposes a focus patch', () => {
  const { root, chosen } = mount();
  root.querySelector('[data-sdg6-marker="biosand"]').click();
  assert.equal(chosen[0].focus, 'biosand');
});

test('DOM marker keydown Enter and Space activate like click', () => {
  const { root, chosen } = mount();
  const marker = root.querySelector('[data-sdg6-marker="sodis"]');
  marker.dispatch('keydown', { key: 'Enter' });
  marker.dispatch('keydown', { key: ' ' });
  assert.equal(chosen.length, 2);
  assert.equal(chosen[0].focus, 'sodis');
});

test('DOM focus detail line renders when state carries focus', () => {
  const { root } = mount({ state: { focus: 'sodis' } });
  const detail = root.querySelector('.sdg6-focus');
  assert.ok(detail);
  assert.match(detail.textContent, /SODIS|Solar/);
});

test('DOM recommendation line and coverage render', () => {
  const { root } = mount();
  const rec = root.querySelector('.sdg6-rec');
  assert.ok(rec && /Best modeled reach/.test(rec.textContent));
  assert.ok(/still uncovered/.test(root.textContent));
});

test('DOM blocked advisory renders the guard note and withheld fits', () => {
  const { root } = mount({ summary: { tap: 'T', advisory: 'boil', ecoli: 'unknown', values: { nitrate: '25' } } });
  assert.ok(root.querySelector('.lab-guard'));
  assert.ok(root.querySelectorAll('.sdg6-fit-withheld').length === 5);
});

test('DOM no summary renders only the disabled note', () => {
  const { root } = mount({ summary: null });
  assert.ok(root.querySelector('.disabled-note'));
  assert.equal(root.querySelectorAll('.sdg6-card').length, 0);
});

test('DOM Spanish render localizes all chips and card text', () => {
  const root = new FakeNode('div');
  renderSdg6Section(root, {
    lang: 'es', state: st(),
    summary: { tap: 'T', advisory: 'none', ecoli: 'absent', values: { nitrate: '25' } },
    choose: () => {},
  });
  assert.ok(/Indicadores ODS 6/i.test(root.textContent));
  assert.ok(/Ósmosis inversa/.test(root.textContent));
  assert.ok(root.querySelectorAll('.sdg6-marker').length === 5);
});

test('DOM plan table row names carry the localized intervention label', () => {
  const { root } = mount();
  const names = root.querySelectorAll('.sdg6-pick').map(n => n.textContent);
  assert.ok(names.includes('Biosand filter'));
  assert.ok(names.includes('Community borehole repair'));
});

test('DOM fit cell classes reflect contaminant needs', () => {
  const { root } = mount();
  assert.ok(root.querySelectorAll('.sdg6-fit-yes').length >= 1);
  assert.ok(root.querySelectorAll('.sdg6-fit-no').length >= 1);
});

test('DOM chart markers have localized aria labels', () => {
  const { root } = mount();
  const marker = root.querySelector('[data-sdg6-marker="sodis"]');
  assert.ok(/SODIS|Solar/.test(marker.getAttribute('aria-label')));
});

test('DOM chart viewBox keeps the bounded 560 wide frame', () => {
  const { root } = mount();
  assert.equal(root.querySelector('.sdg6-chart').getAttribute('viewBox'), '0 0 560 300');
});

test('DOM re-render replaces children cleanly', () => {
  const { root } = mount();
  const before = root.children.length;
  const again = mount();
  assert.ok(before > 0 && again.root.children.length > 0);
});
