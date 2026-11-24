// Mixture and benchmark-sensitivity lab. Pure, deterministic helpers sit on
// top of engine.js: the four synthetic presets plus the imported CSV are
// screened side by side, illustrative scenario matrices reuse the engine's
// own formulas, and a digest-stamped lab brief is exported in three formats.
// Nothing here claims compliance, potability, or a fix for an advisory.

import {
  CHEMICALS, normalizeSample, screenSample, flushLead, compareTreatment,
} from './engine.js';
import { PRESETS } from './presets.js';
import { parseCsv } from './import.js';
import { RULESET, canonicalJson, csvCell } from './exports.js';
import { sha256Bytes, sha256Hex } from './sha256.js';
export { sha256Bytes, sha256Hex };
import {
  SDG6_DEFAULT_STATE, SDG6_STRINGS, normalizeSdg6State,
  renderSdg6Section, sdg6Payload, sdg6SelfTests,
} from './sdg6-equity.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const has = (obj, key) => Object.hasOwn(obj, key);

/* ---------- base64url, strict ---------- */

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX = new Map([...B64_CHARS].map((ch, i) => [ch, i]));

function b64urlEncode(bytes) {
  let out = '';
  for (let i = 0; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + B64_CHARS[n & 63];
  }
  const left = bytes.length % 3;
  if (left === 1) {
    const n = bytes[bytes.length - 1] << 16;
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63];
  } else if (left === 2) {
    const n = (bytes[bytes.length - 2] << 16) | (bytes[bytes.length - 1] << 8);
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63];
  }
  return out;
}

function b64urlDecode(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length % 4 === 1) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const bytes = [];
  for (let i = 0; i + 4 <= text.length; i += 4) {
    const n = (B64_INDEX.get(text[i]) << 18) | (B64_INDEX.get(text[i + 1]) << 12)
      | (B64_INDEX.get(text[i + 2]) << 6) | B64_INDEX.get(text[i + 3]);
    bytes.push((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  }
  const left = text.length % 4;
  if (left === 2) {
    const n = (B64_INDEX.get(text[text.length - 2]) << 18) | (B64_INDEX.get(text[text.length - 1]) << 12);
    bytes.push((n >> 16) & 0xff);
  } else if (left === 3) {
    const n = (B64_INDEX.get(text[text.length - 3]) << 18)
      | (B64_INDEX.get(text[text.length - 2]) << 12) | (B64_INDEX.get(text[text.length - 1]) << 6);
    bytes.push((n >> 16) & 0xff, (n >> 8) & 0xff);
  }
  return new Uint8Array(bytes);
}

/* ---------- lab state and the #ww= bookmark codec ---------- */

export const LAB_PRESETS = Object.freeze(['school', 'well', 'storm', 'baseline', 'imported']);
export const LAB_SCENARIOS = Object.freeze(['baseline', 'flush', 'carbon', 'ro']);
export const LAB_LANGS = Object.freeze(['en', 'es']);
const STATE_KEYS = new Set(['preset', 'scenario', 'lang', 'focus', 'sdg']);
const DEFAULT_STATE = Object.freeze({ preset: 'school', scenario: 'baseline', lang: 'en', focus: null });
const FOCUS_IDS = new Set([...CHEMICALS.map(({ id }) => id), 'hazard-index']);

export function normalizeLabState(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const state = { ...DEFAULT_STATE };
  for (const key of Object.keys(input)) {
    if (!STATE_KEYS.has(key)) return null;
  }
  if (has(input, 'preset')) {
    if (typeof input.preset !== 'string' || !LAB_PRESETS.includes(input.preset)) return null;
    state.preset = input.preset;
  }
  if (has(input, 'scenario')) {
    if (typeof input.scenario !== 'string' || !LAB_SCENARIOS.includes(input.scenario)) return null;
    state.scenario = input.scenario;
  }
  if (has(input, 'lang')) {
    if (typeof input.lang !== 'string' || !LAB_LANGS.includes(input.lang)) return null;
    state.lang = input.lang;
  }
  if (has(input, 'focus')) {
    if (input.focus !== null && (typeof input.focus !== 'string' || !FOCUS_IDS.has(input.focus))) return null;
    state.focus = input.focus;
  }
  if (has(input, 'sdg')) {
    const sdg = normalizeSdg6State(input.sdg);
    if (sdg === null) return null;
    state.sdg = sdg;
  }
  return state;
}

export function encodeLabHash(state) {
  const normalized = normalizeLabState(state);
  if (!normalized) throw new TypeError('Lab state is not encodable.');
  return `ww=${b64urlEncode(new TextEncoder().encode(canonicalJson(normalized)))}`;
}

export function decodeLabHash(hash) {
  if (typeof hash !== 'string') return null;
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!text.startsWith('ww=')) return null;
  const body = text.slice(3);
  if (body.length === 0 || body.length > 4096) return null;
  const bytes = b64urlDecode(body);
  if (bytes === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return normalizeLabState(parsed);
  } catch {
    return null;
  }
}

/* ---------- datasets and comparator ---------- */

let presetCache = null;
function presetDatasets() {
  if (!presetCache) {
    presetCache = PRESETS.map(preset => ({
      id: preset.id,
      source: 'synthetic',
      samples: parseCsv(preset.csv),
    }));
  }
  return presetCache;
}

export function buildDatasets(imported) {
  const datasets = presetDatasets().map(set => ({ ...set }));
  if (imported && Array.isArray(imported.samples) && imported.samples.length) {
    datasets.push({
      id: 'imported',
      source: imported.origin === 'synthetic' ? 'synthetic' : 'unverified-input',
      samples: imported.samples,
    });
  }
  return datasets;
}

const RATIO_IDS = ['lead', 'copper', 'nitrate', 'arsenic', 'pfoa', 'pfos'];
const PFBS_REFERENCE = '2000';

// Advisory or E. coli states under which no modeled reduction may be shown.
export function advisoryBlocks(sample) {
  const normalized = normalizeSample(sample);
  return normalized.advisory === 'boil' || normalized.advisory === 'do-not-drink'
    || normalized.advisory === 'do-not-use' || normalized.ecoli === 'present';
}

export function summarizeSample(sample) {
  const normalized = normalizeSample(sample);
  const screen = screenSample(normalized);
  const ratios = {};
  for (const meta of CHEMICALS) {
    const value = normalized.values[meta.id];
    const denominator = meta.id === 'pfbs' ? PFBS_REFERENCE : meta.limit;
    ratios[meta.id] = {
      value,
      unit: meta.unit,
      benchmark: meta.limit,
      reference: denominator,
      mixtureInputOnly: meta.limit === null,
      ratio: value === null || denominator === null ? null : Number(value) / Number(denominator),
      status: screen.results.find(result => result.id === meta.id).status,
    };
  }
  return {
    tap: normalized.tap,
    advisory: normalized.advisory,
    ecoli: normalized.ecoli,
    action: screen.action,
    values: normalized.values,
    ratios,
    legacyLead: screen.legacyLead,
    mixture: screen.mixture,
    unreported: screen.results.filter(result => result.status === 'missing').length,
    unknowns: [...screen.unknowns],
    blocked: advisoryBlocks(normalized),
  };
}

export function buildComparator(datasets) {
  if (!Array.isArray(datasets)) throw new TypeError('buildComparator expects an array of datasets.');
  return datasets.map(dataset => {
    if (!dataset || typeof dataset !== 'object' || !Array.isArray(dataset.samples) || !dataset.samples.length) {
      throw new TypeError('Each dataset needs a non-empty samples array.');
    }
    const origin = dataset.source === 'synthetic' ? 'synthetic' : 'unverified-input';
    const summary = summarizeSample(dataset.samples[0]);
    return {
      id: dataset.id,
      source: origin,
      tapCount: dataset.samples.length,
      ...summary,
    };
  });
}

/* ---------- illustrative scenario matrix ---------- */

export const SCENARIO_PARAMS = Object.freeze({
  flush: Object.freeze({ background: '0', volumeLiters: '1', flowLitersPerMinute: '4', minutes: '2' }),
  cost: Object.freeze({ litersPerDay: '2', bottledPerLiter: '1.50', waterPerLiter: '0.005' }),
});

const FILTER_IDS = { carbon: 0, ro: 1 };

function modeledStatus(value, meta) {
  if (meta.limit === null) return 'no-limit';
  const limit = Number(meta.limit);
  return value > limit ? 'above' : value === limit ? 'at' : 'below';
}

export function scenarioMatrix(sample, scenario) {
  const normalized = normalizeSample(sample);
  if (!LAB_SCENARIOS.includes(scenario)) throw new RangeError('Unknown scenario.');
  const blocked = advisoryBlocks(normalized);
  const baseline = screenSample(normalized);
  const modeled = { ...normalized.values };
  let filter = null;
  if (!blocked && scenario === 'flush') {
    const params = SCENARIO_PARAMS.flush;
    if (normalized.values.lead !== null) {
      modeled.lead = flushLead({ initial: normalized.values.lead, ...params });
    }
  } else if (!blocked && has(FILTER_IDS, scenario)) {
    const result = compareTreatment(normalized, SCENARIO_PARAMS.cost);
    filter = result.filters[FILTER_IDS[scenario]];
  }
  const rows = CHEMICALS.map(meta => {
    const value = normalized.values[meta.id];
    const row = {
      id: meta.id,
      label: meta.label,
      unit: meta.unit,
      benchmark: meta.limit,
      baseline: { value, status: baseline.results.find(r => r.id === meta.id).status },
      cell: null,
    };
    if (blocked) {
      row.cell = { kind: 'blocked', value: null, status: null };
      return row;
    }
    if (value === null) {
      row.cell = { kind: 'unreported', value: null, status: null };
      return row;
    }
    if (scenario === 'baseline') {
      row.cell = { kind: 'measured', value, status: row.baseline.status };
      return row;
    }
    if (scenario === 'flush') {
      if (meta.id === 'lead') {
        const next = modeled.lead;
        row.cell = { kind: 'modeled', value: next, status: modeledStatus(next, meta) };
      } else {
        row.cell = { kind: 'unmodeled', value, status: row.baseline.status };
      }
      return row;
    }
    if (!has(filter.removal, meta.id)) {
      row.cell = { kind: 'uncovered', value: null, status: null };
      return row;
    }
    const next = filter.values[meta.id];
    row.cell = { kind: 'modeled', value: next, status: modeledStatus(next, meta) };
    return row;
  });
  const hiRow = { id: 'hazard-index', baseline: { value: baseline.mixture.raw, status: baseline.mixture.status }, cell: null };
  if (blocked) {
    hiRow.cell = { kind: 'blocked', value: null, status: null };
  } else {
    const terms = baseline.mixture.terms.map(term => {
      if (term.quotient === null) return null;
      const changed = modeled[term.id];
      if (scenario !== 'baseline' && changed !== null && changed !== normalized.values[term.id]) {
        return Number(changed) / Number(term.denominator);
      }
      return Number(term.quotient);
    });
    hiRow.cell = terms.every(term => term === null)
      ? { kind: 'unreported', value: null, status: null }
      : {
        kind: 'modeled',
        value: terms.reduce((sum, term) => sum + (term ?? 0), 0),
        lowerBound: terms.some(term => term === null),
        missing: terms.filter(term => term === null).length,
      };
  }
  return { scenario, blocked, rows, hazardIndex: hiRow };
}

/* ---------- digest-stamped lab brief ---------- */

export function labBriefPayload({ state, comparator, matrix, sdg6 }) {
  const normalized = normalizeLabState(state);
  if (!normalized) throw new RangeError('Lab state is not exportable.');
  const rows = buildComparator(comparator).map(row => ({
    source: row.id,
    origin: row.source,
    tap: row.tap,
    taps: row.tapCount,
    advisory: row.advisory,
    ecoli: row.ecoli,
    action: row.action,
    hazardIndex: row.mixture.raw,
    hazardIndexStatus: row.mixture.status,
    positiveTerms: row.mixture.positives,
    hazardTerms: Object.fromEntries(row.mixture.terms.map(term => [term.id, term.quotient])),
    unreportedCells: row.unreported,
    leadVs10: row.ratios.lead.status,
    leadVs15: row.legacyLead,
    ratios: Object.fromEntries(RATIO_IDS.map(id => [id, row.ratios[id].ratio])),
    pfbsMixtureInput: row.ratios.pfbs.ratio,
  }));
  const origin = rows.find(row => row.source === normalized.preset)?.origin
    ?? (normalized.preset === 'imported' ? 'unverified-input' : 'synthetic');
  return {
    schema: 'waterwatch-lab/v1',
    ruleset: RULESET,
    scope: 'Single-sample educational screening only. Not a regulatory compliance or potability determination.',
    origin,
    state: normalized,
    comparator: rows,
    matrix: matrix ? {
      scenario: matrix.scenario,
      blocked: matrix.blocked,
      rows: matrix.rows.map(row => ({
        contaminant: row.id,
        baselineValue: row.baseline.value,
        baselineStatus: row.baseline.status,
        cell: row.cell,
      })),
      hazardIndex: matrix.hazardIndex,
    } : null,
    ...(sdg6 ? { sdg6 } : {}),
  };
}

const briefCache = new Map();

export function labBrief(input) {
  const key = canonicalJson(input);
  const cached = briefCache.get(key);
  if (cached) return cached;
  const payload = labBriefPayload(input);
  const fingerprint = sha256Hex(canonicalJson(payload));
  const stamped = {
    fingerprint,
    payload,
    json: `${JSON.stringify({ fingerprint, payload }, null, 2)}\n`,
    csv: briefCsv(fingerprint, payload),
    markdown: briefMarkdown(fingerprint, payload),
  };
  briefCache.set(key, stamped);
  return stamped;
}

function briefCsv(fingerprint, payload) {
  const rows = [
    ['waterwatch-lab-brief', 'schema', payload.schema],
    ['sha256', fingerprint],
    ['ruleset', payload.ruleset],
    ['origin', payload.origin],
    ['scope', payload.scope],
    ['state', canonicalJson(payload.state)],
    [],
    ['comparator', 'source', 'origin', 'tap', 'advisory', 'ecoli', 'action', 'hazard_index',
      'hazard_index_status', 'positive_terms', 'unreported_cells', 'lead_vs_10_ppb', 'lead_vs_15_ppb',
      'pfoa_ratio', 'pfos_ratio', 'lead_ratio', 'copper_ratio', 'nitrate_ratio', 'arsenic_ratio',
      'pfbs_mixture_input_ratio'],
    ...payload.comparator.map(row => [
      '', row.source, row.origin, row.tap, row.advisory, row.ecoli, row.action,
      row.hazardIndex, row.hazardIndexStatus, row.positiveTerms, row.unreportedCells,
      row.leadVs10, row.leadVs15,
      row.ratios.pfoa, row.ratios.pfos, row.ratios.lead, row.ratios.copper,
      row.ratios.nitrate, row.ratios.arsenic, row.pfbsMixtureInput,
    ]),
  ];
  if (payload.matrix) {
    rows.push(
      [],
      ['matrix', 'scenario', payload.matrix.scenario, 'blocked', String(payload.matrix.blocked)],
      ['matrix', 'contaminant', 'baseline_value', 'baseline_status', 'cell_kind', 'cell_value', 'cell_status'],
      ...payload.matrix.rows.map(row => [
        'matrix', row.contaminant, row.baselineValue, row.baselineStatus,
        row.cell.kind, row.cell.value, row.cell.status ?? '',
      ]),
      ['matrix', 'hazard-index', payload.matrix.hazardIndex.baseline.value,
        payload.matrix.hazardIndex.baseline.status, payload.matrix.hazardIndex.cell.kind,
        payload.matrix.hazardIndex.cell.value, ''],
    );
  }
  if (payload.sdg6) {
    const sdg = payload.sdg6;
    rows.push(
      [],
      ['sdg6', 'schema', sdg.schema],
      ['sdg6', 'state', canonicalJson(sdg.state)],
      ['sdg6', 'indicator', 'level_6_1_1', sdg.indicators['sdg-6-1'].level],
      ['sdg6', 'indicator', 'contamination_6_1_1', sdg.indicators['sdg-6-1'].free],
      ['sdg6', 'indicator', 'band_6_3_2', sdg.indicators['sdg-6-3'].band],
      ['sdg6', 'indicator', 'exceedances_6_3_2', sdg.indicators['sdg-6-3'].count],
      ['sdg6', 'indicator', 'stress_index_6_4_2', sdg.indicators['sdg-6-4'].index],
      ['sdg6', 'plan', 'budget', sdg.plan.budget, 'people', sdg.plan.people,
        'recommended', sdg.plan.recommended?.id ?? 'none',
        'pick_kind', sdg.plan.recommended?.kind ?? 'none'],
      ['sdg6', 'intervention', 'units', 'people_reached', 'person_years',
        'cost_per_person_year', 'contaminant_fit'],
      ...sdg.plan.rows.map(row => [
        'sdg6', row.id, row.units, row.peopleReached, row.personYears,
        row.costPerPersonYear, row.fit,
      ]),
    );
  }
  return `${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function briefMarkdown(fingerprint, payload) {
  const lines = [
    '## WaterWatch lab brief',
    '',
    `- SHA-256: \`${fingerprint}\``,
    `- Origin: \`${payload.origin}\``,
    `- Scope: ${payload.scope}`,
    `- State: \`${canonicalJson(payload.state)}\``,
    '',
    '| Source | Origin | Tap | Advisory | E. coli | Action | Hazard Index | Positive terms | Unreported cells |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...payload.comparator.map(row =>
      `| ${row.source} | ${row.origin} | ${row.tap} | ${row.advisory} | ${row.ecoli} | ${row.action} | ${row.hazardIndex ?? 'n/a'} (${row.hazardIndexStatus}) | ${row.positiveTerms} | ${row.unreportedCells} |`),
  ];
  if (payload.matrix) {
    lines.push(
      '',
      `Scenario matrix: ${payload.matrix.scenario}${payload.matrix.blocked ? ' (withheld during active advisory or E. coli)' : ''}`,
      '',
      '| Contaminant | Baseline | Baseline status | Cell | Modeled | Modeled status |',
      '| --- | --- | --- | --- | --- | --- |',
      ...payload.matrix.rows.map(row =>
        `| ${row.contaminant} | ${row.baselineValue ?? 'not reported'} | ${row.baselineStatus} | ${row.cell.kind} | ${row.cell.value ?? ''} | ${row.cell.status ?? ''} |`),
    );
  }
  if (payload.sdg6) {
    const sdg = payload.sdg6;
    lines.push(
      '',
      `SDG 6 module state: \`${canonicalJson(sdg.state)}\``,
      '',
      '| Indicator | Result |',
      '| --- | --- |',
      `| SDG 6.1.1 service level | ${sdg.indicators['sdg-6-1'].level} |`,
      `| SDG 6.1.1 contamination status | ${sdg.indicators['sdg-6-1'].free} |`,
      `| SDG 6.3.2 exceedance band | ${sdg.indicators['sdg-6-3'].band} (${sdg.indicators['sdg-6-3'].count} exceedances) |`,
      `| SDG 6.4.2 stress index | ${sdg.indicators['sdg-6-4'].index}/100 (${sdg.indicators['sdg-6-4'].band}) |`,
      '',
      `Intervention plan for a ${sdg.plan.budget} USD budget and ${sdg.plan.people} people:`,
      '',
      '| Intervention | Units | People reached | Person-years | Cost per person-year | Fit |',
      '| --- | --- | --- | --- | --- | --- |',
      ...sdg.plan.rows.map(row =>
        `| ${row.id} | ${row.units} | ${row.peopleReached} | ${row.personYears} | ${row.costPerPersonYear.toFixed(4)} | ${row.fit} |`),
    );
  }
  lines.push(
    '',
    `Digest: ${fingerprint}`,
    'Educational screening only. Readings are never rounded or discarded, unreported cells are never treated as zero, and no modeled reduction is a fix for an advisory.',
    '',
  );
  return lines.join('\n');
}

export function verifyBrief(stamped) {
  if (!stamped || typeof stamped !== 'object') throw new TypeError('verifyBrief expects a stamped brief.');
  const actual = sha256Hex(canonicalJson(stamped.payload));
  return { ok: actual === stamped.fingerprint, expected: stamped.fingerprint, actual };
}

export function tamperBrief(stamped) {
  if (!stamped || typeof stamped !== 'object') throw new TypeError('tamperBrief expects a stamped brief.');
  const altered = JSON.parse(JSON.stringify(stamped.payload));
  altered.state = { ...altered.state, focus: 'lead' };
  altered.scope = `${altered.scope} (altered copy)`;
  const actual = sha256Hex(canonicalJson(altered));
  return { ok: actual === stamped.fingerprint, expected: stamped.fingerprint, actual };
}

/* ---------- deterministic in-page self-tests ---------- */

function expect(condition, detail) {
  if (!condition) throw new Error(detail);
  return detail;
}

export function runSelfTests() {
  const tests = [];
  const run = (id, fn) => {
    try {
      tests.push({ id, ok: true, detail: fn() ?? '' });
    } catch (error) {
      tests.push({ id, ok: false, detail: String(error?.message ?? error) });
    }
  };
  const base = values => ({ tap: 'Self-test tap', advisory: 'none', ecoli: 'absent', values });

  run('sha256-empty', () => expect(
    sha256Hex('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    sha256Hex('')));
  run('sha256-abc', () => expect(
    sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    sha256Hex('abc')));
  run('sha256-fox', () => expect(
    sha256Hex('The quick brown fox jumps over the lazy dog')
      === 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592', 'fox vector'));
  run('sha256-multiblock', () => expect(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')
      === '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1', 'multi-block vector'));
  run('sha256-million-a', () => expect(
    sha256Hex('a'.repeat(1000000)) === 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    'one million a vector'));
  run('hi-exact-arithmetic', () => {
    const hi = screenSample(base({ pfhxs: '3', pfna: '3', genx: '3', pfbs: '200' })).mixture;
    return expect(hi.raw === '1' && hi.status === 'at' && hi.positives === 4, `raw ${hi.raw}`);
  });
  run('hi-partial-lower-bound', () => {
    const hi = screenSample(base({ pfhxs: '6', pfna: '5' })).mixture;
    return expect(hi.status === 'above-lower-bound' && hi.raw === '1.1' && hi.missing.length === 2,
      `status ${hi.status}`);
  });
  run('pfbs-single-constituent-guard', () => {
    const screen = screenSample(base({ pfhxs: '0', pfna: '0', genx: '0', pfbs: '5000' }));
    const pfbs = screen.results.find(row => row.id === 'pfbs');
    return expect(pfbs.status === 'no-limit' && screen.mixture.status === 'above'
      && screen.mixture.positives === 1, 'lone PFBS flags the summed index without being an MCL');
  });
  run('nd-never-zero', () => {
    for (const bad of ['ND', '<2', 'nd', 'N.D.']) {
      let threw = false;
      try { normalizeSample(base({ lead: bad })); } catch { threw = true; }
      if (!threw) throw new Error(`${bad} was accepted`);
    }
    const blank = normalizeSample(base({ lead: '' }));
    return expect(blank.values.lead === null, 'unreported stays null, never zero');
  });
  run('lead-10-vs-15', () => {
    const at10 = screenSample(base({ lead: '10' }));
    const just10 = screenSample(base({ lead: '10.001' }));
    const legacy = screenSample(base({ lead: '15' }));
    return expect(at10.results[0].status === 'at' && at10.legacyLead === 'below'
      && just10.results[0].status === 'above' && just10.legacyLead === 'below'
      && legacy.results[0].status === 'above' && legacy.legacyLead === 'at',
      'lead flags 10 ppb while tracking the 15 ppb legacy level');
  });
  run('advisory-blocks-claims', () => {
    const boil = scenarioMatrix({ ...base({ lead: '30' }), advisory: 'boil' }, 'carbon');
    const present = scenarioMatrix({ ...base({ lead: '30' }), ecoli: 'present' }, 'ro');
    const clean = scenarioMatrix(base({ lead: '30' }), 'carbon');
    return expect(boil.blocked && present.blocked && !clean.blocked
      && boil.rows.every(row => row.cell.kind === 'blocked')
      && clean.rows.find(row => row.id === 'lead').cell.kind === 'modeled',
      'advisory or E. coli withholds every modeled reduction');
  });
  run('flush-uses-engine-formula', () => {
    const matrix = scenarioMatrix(base({ lead: '24' }), 'flush');
    const cell = matrix.rows.find(row => row.id === 'lead').cell;
    const expected = flushLead({ initial: '24', ...SCENARIO_PARAMS.flush });
    return expect(cell.kind === 'modeled' && cell.value === expected, `modeled ${cell.value}`);
  });
  run('origin-tags', () => {
    const datasets = buildDatasets(null);
    const brief = labBrief({ state: { preset: 'school' }, comparator: datasets, matrix: null });
    return expect(brief.payload.origin === 'synthetic'
      && brief.payload.comparator.every(row => row.origin === 'synthetic')
      && brief.csv.includes('"unverified-input"') === false,
      'synthetic origin tags the payload');
  });
  run('csv-formula-escape', () => {
    const datasets = [{
      id: 'imported', source: 'unverified-input',
      samples: [{ tap: '=CMD()', advisory: 'none', ecoli: 'absent', values: { lead: '1' } }],
    }];
    const brief = labBrief({ state: { preset: 'imported' }, comparator: datasets, matrix: null });
    return expect(csvCell('=CMD()') === '"\'=CMD()"'
      && brief.csv.includes('"\'=CMD()"'), 'formula-like cells are prefixed');
  });
  run('digest-parity', () => {
    const datasets = buildDatasets(null);
    const input = { state: { preset: 'well', scenario: 'carbon' }, comparator: datasets, matrix: null };
    const a = labBrief(input);
    const b = labBrief(input);
    return expect(a === b && a.json.includes(a.fingerprint) && a.csv.includes(a.fingerprint)
      && a.markdown.includes(a.fingerprint), 'one digest stamps every export');
  });
  run('tamper-detect', () => {
    const brief = labBrief({ state: { preset: 'baseline' }, comparator: buildDatasets(null), matrix: null });
    const tampered = tamperBrief(brief);
    return expect(verifyBrief(brief).ok && !tampered.ok && tampered.actual !== brief.fingerprint,
      'altered payload rehashes to a different digest');
  });
  run('hash-roundtrip', () => {
    const state = { preset: 'storm', scenario: 'ro', lang: 'es', focus: 'nitrate' };
    const decoded = decodeLabHash(`#${encodeLabHash(state)}`);
    if (JSON.stringify(decoded) !== JSON.stringify(state)) throw new Error('round trip changed state');
    for (const hostile of ['ww=', 'ww=!!!', 'ww=AAAA', '#other=1', 'ww=AAAAA',
      `ww=${b64urlEncode(new TextEncoder().encode('{"__proto__":{"x":1},"preset":"school"}'))}`,
      `ww=${b64urlEncode(new TextEncoder().encode('{"preset":"evil"}'))}`]) {
      if (decodeLabHash(hostile) !== null) throw new Error(`hostile hash accepted: ${hostile.slice(0, 24)}`);
    }
    return 'hostile and malformed hashes fail closed';
  });
  run('unreported-counted', () => {
    const summary = summarizeSample(base({ lead: '5', pfoa: '2' }));
    return expect(summary.unreported === 8 && summary.ratios.copper.value === null
      && summary.values.copper === null, `${summary.unreported} unreported cells counted, never zero`);
  });
  return [...tests, ...sdg6SelfTests()];
}

/* ---------- localized strings ---------- */

export const STRINGS = {
  en: {
    title: 'Mixture and sensitivity lab',
    langLabel: 'Language',
    comparatorTitle: 'Preset by contaminant comparator',
    comparatorNote: 'Each row screens the first tap of a synthetic preset or of the imported CSV against the 2024 screening benchmarks. Ratios are the measured value divided by its reference level; unreported cells are never treated as zero. Pick a row to make it the charted source.',
    sourceImported: 'Imported CSV',
    sourceMissing: 'No imported CSV applied yet',
    tapCount: count => (count === 1 ? '1 tap' : `${count} taps`),
    colSource: 'Source', colTap: 'Tap', colHI: 'Hazard Index', colPos: 'Positive terms', colContaminant: 'Contaminant',
    colPfoa: 'PFOA ratio', colPfos: 'PFOS ratio', colPb10: 'Lead vs 10 ppb', colPb15: 'Lead vs 15 ppb',
    colNitrate: 'Nitrate ratio', colArsenic: 'Arsenic ratio', colCopper: 'Copper ratio',
    colUnreported: 'Unreported', colFlags: 'Advisory / E. coli', colAction: 'Action',
    notReported: 'not reported',
    scenarioTitle: 'Illustrative scenario matrix',
    scenarioNote: 'Baseline readings against three teaching models. A modeled cell is illustrative only, never a clearance, and arsenic coverage is not implied where unverified.',
    scenario: { baseline: 'Baseline', flush: 'First-draw flush', carbon: 'Carbon, illustrative', ro: 'RO, illustrative' },
    colBaseline: 'Baseline', colCell: 'Scenario result', colStatus: 'Status',
    cell: {
      measured: 'measured', modeled: 'modeled', unmodeled: 'not modeled', uncovered: 'not covered',
      unreported: 'not reported', blocked: 'withheld',
    },
    guard: 'This source has an active advisory or a positive E. coli result, so every modeled reduction is withheld. Official instructions come first; no household filter or flush model is presented as an advisory fix.',
    guardShort: 'claims withheld',
    hiChartTitle: 'PFAS Hazard Index breakdown',
    ratioChartTitle: 'Benchmark ratio by contaminant',
    ratioChartNote: 'Bars compare each measured value with its reference level. PFBS is drawn against its 2000 ppt mixture input, not an MCL. Unreported fields stay hollow.',
    hiMissing: names => `Unreported constituents: ${names}.`,
    hiLine: 'HI = 1',
    exportsTitle: 'Audited lab brief',
    exportsNote: 'One digest stamps the on-page line, the JSON download, the CSV provenance header, and the Markdown footer.',
    btnJson: 'JSON', btnCsv: 'CSV', btnMd: 'Markdown', btnCopy: 'Copy share link',
    btnVerify: 'Verify digest', btnTamper: 'Tamper demo', btnTests: 'Run self-tests',
    digestLabel: 'SHA-256 digest',
    verifyOk: 'Recomputed digest matches the stamped digest.',
    verifyBad: 'Digest mismatch; the payload was altered.',
    tamperLine: actual => `Altered copy digests to ${actual.slice(0, 16)}... and does not match.`,
    copied: 'Share link copied to the clipboard.',
    copyFallback: 'Copy the link from the field.',
    testsPass: (ok, total) => `${ok}/${total} self-tests passing`,
    testsFailLine: item => `${item.id}: ${item.detail}`,
    focusLabel: 'Focused contaminant',
    detail: (label, base, modeled) => `${label}: baseline ${base}; scenario ${modeled}.`,
    tapLabel: 'Tap shown',
    status: {
      above: 'above', at: 'at', below: 'below', missing: 'not reported', 'no-limit': 'no individual benchmark',
      'above-lower-bound': 'above (lower bound)', incomplete: 'incomplete', 'not-applicable': 'not applicable',
      blocked: 'withheld', modeled: 'modeled', unmodeled: 'not modeled', uncovered: 'not covered',
      unreported: 'not reported', measured: 'measured',
    },
    advisory: {
      none: 'none', boil: 'boil', 'do-not-drink': 'do-not-drink', 'do-not-use': 'do-not-use', unknown: 'unknown',
    },
    ecoli: { present: 'present', absent: 'absent', unknown: 'unknown' },
    sourceNames: {
      school: 'School tap', well: 'Private well', storm: 'Post-storm', baseline: 'Municipal baseline',
      imported: 'Imported CSV',
    },
    action: {
      'co-occurrence': 'co-occurrence', 'do-not-use': 'do-not-use', 'do-not-drink': 'do-not-drink',
      boil: 'boil', microbial: 'microbial', chemical: 'chemical', incomplete: 'incomplete', review: 'within',
    },
    shareLabel: 'Bookmark link',
    matrixTap: 'matrix tap',
  },
  es: {
    title: 'Laboratorio de mezclas y sensibilidad',
    langLabel: 'Idioma',
    comparatorTitle: 'Comparador por contaminante',
    comparatorNote: 'Cada fila evalúa el primer grifo de un ejemplo sintético o del CSV importado contra los niveles de referencia de 2024. Las proporciones son el valor medido dividido entre su nivel de referencia; las celdas sin reportar nunca se tratan como cero. Elija una fila para graficarla.',
    sourceImported: 'CSV importado',
    sourceMissing: 'Aún no se aplicó un CSV importado',
    tapCount: count => (count === 1 ? '1 grifo' : `${count} grifos`),
    colSource: 'Fuente', colTap: 'Grifo', colHI: 'Índice de Peligro', colPos: 'Términos positivos', colContaminant: 'Contaminante',
    colPfoa: 'Proporción PFOA', colPfos: 'Proporción PFOS', colPb10: 'Plomo vs 10 ppb', colPb15: 'Plomo vs 15 ppb',
    colNitrate: 'Proporción nitrato', colArsenic: 'Proporción arsénico', colCopper: 'Proporción cobre',
    colUnreported: 'Sin reportar', colFlags: 'Aviso / E. coli', colAction: 'Acción',
    notReported: 'sin reportar',
    scenarioTitle: 'Matriz de escenarios ilustrativos',
    scenarioNote: 'Lecturas de referencia contra tres modelos didácticos. Una celda modelada es solo ilustrativa, nunca una autorización, y la cobertura de arsénico no se implica donde no está verificada.',
    scenario: { baseline: 'Referencia', flush: 'Purga de primera extracción', carbon: 'Carbón, ilustrativo', ro: 'Ósmosis inversa, ilustrativa' },
    colBaseline: 'Referencia', colCell: 'Resultado del escenario', colStatus: 'Estado',
    cell: {
      measured: 'medido', modeled: 'modelado', unmodeled: 'no modelado', uncovered: 'sin cobertura',
      unreported: 'sin reportar', blocked: 'retenido',
    },
    guard: 'Esta fuente tiene un aviso activo o un resultado positivo de E. coli, por lo que toda reducción modelada se retiene. Las instrucciones oficiales van primero; ningún filtro doméstico ni modelo de purga se presenta como solución al aviso.',
    guardShort: 'afirmaciones retenidas',
    hiChartTitle: 'Desglose del Índice de Peligro de PFAS',
    ratioChartTitle: 'Proporción respecto al nivel de referencia',
    ratioChartNote: 'Las barras comparan cada valor medido con su nivel de referencia. PFBS se dibuja contra su entrada de mezcla de 2000 ppt, no contra un MCL. Los campos sin reportar quedan huecos.',
    hiMissing: names => `Constituyentes sin reportar: ${names}.`,
    hiLine: 'HI = 1',
    exportsTitle: 'Informe auditado del laboratorio',
    exportsNote: 'Un solo resumen estampa la línea en pantalla, la descarga JSON, el encabezado de procedencia del CSV y el pie del Markdown.',
    btnJson: 'JSON', btnCsv: 'CSV', btnMd: 'Markdown', btnCopy: 'Copiar enlace',
    btnVerify: 'Verificar resumen', btnTamper: 'Demostración de alteración', btnTests: 'Ejecutar autopruebas',
    digestLabel: 'Resumen SHA-256',
    verifyOk: 'El resumen recalculado coincide con el resumen estampado.',
    verifyBad: 'El resumen no coincide; el contenido fue alterado.',
    tamperLine: actual => `La copia alterada resume a ${actual.slice(0, 16)}... y no coincide.`,
    copied: 'Enlace copiado al portapapeles.',
    copyFallback: 'Copie el enlace del campo.',
    testsPass: (ok, total) => `${ok}/${total} autopruebas aprobadas`,
    testsFailLine: item => `${item.id}: ${item.detail}`,
    focusLabel: 'Contaminante enfocado',
    detail: (label, base, modeled) => `${label}: referencia ${base}; escenario ${modeled}.`,
    tapLabel: 'Grifo mostrado',
    status: {
      above: 'por encima', at: 'en el nivel', below: 'por debajo', missing: 'sin reportar',
      'no-limit': 'sin nivel individual', 'above-lower-bound': 'por encima (cota inferior)',
      incomplete: 'incompleto', 'not-applicable': 'no aplica', blocked: 'retenido', modeled: 'modelado',
      unmodeled: 'no modelado', uncovered: 'sin cobertura', unreported: 'sin reportar', measured: 'medido',
    },
    advisory: {
      none: 'ninguno', boil: 'hervir', 'do-not-drink': 'no beber', 'do-not-use': 'no usar', unknown: 'desconocido',
    },
    ecoli: { present: 'presente', absent: 'ausente', unknown: 'desconocido' },
    sourceNames: {
      school: 'Grifo escolar', well: 'Pozo privado', storm: 'Post-tormenta', baseline: 'Base municipal',
      imported: 'CSV importado',
    },
    action: {
      'co-occurrence': 'co-ocurrencia', 'do-not-use': 'no usar', 'do-not-drink': 'no beber',
      boil: 'hervir', microbial: 'microbiano', chemical: 'químico', incomplete: 'incompleto', review: 'dentro',
    },
    shareLabel: 'Enlace de marcador',
    matrixTap: 'grifo de la matriz',
  },
};

const CHEM_SHORT = {
  lead: { en: 'Lead', es: 'Plomo' }, copper: { en: 'Copper', es: 'Cobre' },
  nitrate: { en: 'Nitrate', es: 'Nitrato' }, arsenic: { en: 'Arsenic', es: 'Arsénico' },
  pfoa: { en: 'PFOA', es: 'PFOA' }, pfos: { en: 'PFOS', es: 'PFOS' },
  pfhxs: { en: 'PFHxS', es: 'PFHxS' }, pfna: { en: 'PFNA', es: 'PFNA' },
  genx: { en: 'GenX', es: 'GenX' }, pfbs: { en: 'PFBS', es: 'PFBS' },
  'hazard-index': { en: 'Hazard Index', es: 'Índice de Peligro' },
};

/* ---------- browser mount ---------- */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child != null) node.append(child);
  }
  return node;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function fmtRatio(ratio) {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  return Number(ratio.toPrecision(4)).toString();
}

function fmtValue(value, digits = 4) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(Number(n.toPrecision(digits)));
}

function download(name, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountLab(root, hooks = {}) {
  const getImported = typeof hooks.getImported === 'function' ? hooks.getImported : () => null;
  const initial = decodeLabHash(globalThis.location?.hash ?? '') ?? { ...DEFAULT_STATE };
  const lab = {
    ...initial, tapIndex: 0, verifyNote: null, tests: null, link: '',
    sdg: initial.sdg ?? { ...SDG6_DEFAULT_STATE },
  };

  const tr = () => STRINGS[lab.lang];
  const chemName = id => CHEM_SHORT[id]?.[lab.lang] ?? id;
  const statusWord = status => tr().status[status] ?? status;

  const linkFor = () => {
    const href = globalThis.location?.href?.split('#')[0] ?? '';
    return `${href}#${encodeLabHash({
      preset: lab.preset, scenario: lab.scenario, lang: lab.lang, focus: lab.focus,
      sdg: lab.sdg,
    })}`;
  };

  const update = () => {
    try {
      globalThis.history?.replaceState?.(null, '', linkFor().slice(linkFor().indexOf('#')));
    } catch { /* replaceState can be unavailable on file URLs */ }
    render();
  };

  const choose = patch => {
    const next = { ...patch };
    if (has(next, 'sdg')) {
      const sdg = normalizeSdg6State(next.sdg);
      if (sdg === null) return;
      lab.sdg = sdg;
      delete next.sdg;
    }
    Object.assign(lab, next);
    update();
  };

  function datasets() {
    return buildDatasets(getImported());
  }

  function activeDataset() {
    const all = datasets();
    return all.find(set => set.id === lab.preset) ?? null;
  }

  function activeSummary() {
    const set = activeDataset();
    if (!set) return null;
    const index = Math.min(lab.tapIndex, set.samples.length - 1);
    return { dataset: set, summary: summarizeSample(set.samples[index]), index };
  }

  /* ----- comparator ----- */

  function comparatorTable(t) {
    const rows = buildComparator(datasets());
    const hasImported = datasets().some(set => set.id === 'imported');
    if (!hasImported) {
      rows.push({ id: 'imported', placeholder: true });
    }
    const wrap = el('div', { class: 'table-wrap lab-table-wrap' });
    const table = el('table', { class: 'lab-table' });
    table.append(el('thead', {}, el('tr', {}, [
      el('th', { scope: 'col', text: t.colSource }),
      el('th', { scope: 'col', text: t.colTap }),
      el('th', { scope: 'col', class: 'num', text: t.colHI }),
      el('th', { scope: 'col', class: 'num', text: t.colPos }),
      el('th', { scope: 'col', class: 'num', text: t.colPfoa }),
      el('th', { scope: 'col', class: 'num', text: t.colPfos }),
      el('th', { scope: 'col', class: 'num', text: t.colPb10 }),
      el('th', { scope: 'col', class: 'num', text: t.colPb15 }),
      el('th', { scope: 'col', class: 'num', text: t.colNitrate }),
      el('th', { scope: 'col', class: 'num', text: t.colArsenic }),
      el('th', { scope: 'col', class: 'num', text: t.colCopper }),
      el('th', { scope: 'col', class: 'num', text: t.colUnreported }),
      el('th', { scope: 'col', text: t.colFlags }),
      el('th', { scope: 'col', text: t.colAction }),
    ])));
    const body = el('tbody');
    const ratioCell = entry => {
      if (entry.value === null) return el('td', { class: 'num' }, el('span', { class: 'not-reported', text: 'n/r' }));
      const text = entry.ratio === null ? 'n/a' : `${fmtRatio(entry.ratio)}x`;
      return el('td', { class: `num lab-${entry.status}` }, [
        document.createTextNode(text),
        el('span', { class: 'unit', text: statusWord(entry.status) }),
      ]);
    };
    for (const row of rows) {
      if (row.placeholder) {
        body.append(el('tr', { class: 'lab-placeholder' }, [
          el('td', {}, el('span', { class: 'not-reported', text: t.sourceNames.imported })),
          el('td', { colspan: '13' }, el('span', { class: 'not-reported', text: t.sourceMissing })),
        ]));
        continue;
      }
      const pick = el('button', {
        type: 'button', class: 'lab-pick',
        'aria-pressed': String(lab.preset === row.id),
      }, [
        document.createTextNode(t.sourceNames[row.id] ?? row.id),
        el('span', { class: 'lab-origin', text: ` ${row.source}` }),
      ]);
      pick.addEventListener('click', () => choose({ preset: row.id, tapIndex: 0 }));
      const flags = `${t.advisory[row.advisory] ?? row.advisory} / ${t.ecoli[row.ecoli] ?? row.ecoli}${row.blocked ? ` (${t.guardShort})` : ''}`;
      body.append(el('tr', { class: lab.preset === row.id ? 'lab-active' : '' }, [
        el('th', { scope: 'row' }, pick),
        el('td', { text: row.tapCount > 1 ? `${row.tap} (${t.tapCount(row.tapCount)})` : row.tap }),
        el('td', { class: `num lab-${row.mixture.status}` }, [
          document.createTextNode(row.mixture.raw ?? 'n/a'),
          el('span', { class: 'unit', text: statusWord(row.mixture.status) }),
        ]),
        el('td', { class: 'num', text: String(row.mixture.positives) }),
        ratioCell(row.ratios.pfoa), ratioCell(row.ratios.pfos),
        el('td', { class: `num lab-${row.ratios.lead.status}` }, [
          document.createTextNode(row.ratios.lead.value ?? 'n/r'),
          row.ratios.lead.value === null ? null : el('span', { class: 'unit', text: statusWord(row.ratios.lead.status) }),
        ]),
        el('td', { class: `num lab-${row.legacyLead}` }, [
          document.createTextNode(row.legacyLead === 'missing' ? 'n/r' : statusWord(row.legacyLead)),
        ]),
        ratioCell(row.ratios.nitrate), ratioCell(row.ratios.arsenic), ratioCell(row.ratios.copper),
        el('td', { class: 'num', text: String(row.unreported) }),
        el('td', { class: row.blocked ? 'lab-blocked' : '', text: flags }),
        el('td', { text: t.action[row.action] ?? row.action }),
      ]));
    }
    table.append(body);
    wrap.append(table);
    return wrap;
  }

  /* ----- scenario matrix ----- */

  function scenarioButtons(t) {
    const bar = el('div', { class: 'lab-chipbar', role: 'group', 'aria-label': t.scenarioTitle });
    for (const scenario of LAB_SCENARIOS) {
      const button = el('button', {
        type: 'button', class: 'lab-chip', 'aria-pressed': String(lab.scenario === scenario),
        text: t.scenario[scenario],
      });
      button.addEventListener('click', () => choose({ scenario }));
      bar.append(button);
    }
    return bar;
  }

  function matrixTable(t, matrix) {
    const wrap = el('div', { class: 'table-wrap lab-table-wrap' });
    const table = el('table', { class: 'lab-table' });
    table.append(el('thead', {}, el('tr', {}, [
      el('th', { scope: 'col', text: t.colContaminant }),
      el('th', { scope: 'col', class: 'num', text: t.colBaseline }),
      el('th', { scope: 'col', class: 'num', text: t.colCell }),
      el('th', { scope: 'col', text: t.colStatus }),
    ])));
    const body = el('tbody');
    const cellText = cell => {
      if (cell.kind === 'modeled') return `${fmtValue(cell.value)} ${t.cell.modeled}`;
      if (cell.kind === 'measured') return `${cell.value}`;
      return t.cell[cell.kind] ?? cell.kind;
    };
    const cellStatus = cell => (cell.status ? statusWord(cell.status) : '');
    for (const row of matrix.rows) {
      body.append(el('tr', { class: lab.focus === row.id ? 'lab-active' : '' }, [
        el('th', { scope: 'row', text: chemName(row.id) }),
        el('td', { class: 'num' }, [
          document.createTextNode(row.baseline.value ?? 'n/r'),
          row.baseline.value === null ? null : el('span', { class: 'unit', text: row.unit }),
        ]),
        el('td', { class: `num lab-cell-${row.cell.kind}`, text: cellText(row.cell) }),
        el('td', { class: `lab-${row.cell.status ?? row.cell.kind}`, text: cellStatus(row.cell) }),
      ]));
    }
    const hi = matrix.hazardIndex;
    const hiCell = hi.cell.kind === 'modeled'
      ? `${fmtValue(hi.cell.value)}${hi.cell.lowerBound ? ' (lower bound)' : ''}`
      : (t.cell[hi.cell.kind] ?? hi.cell.kind);
    body.append(el('tr', { class: 'lab-hi-row' }, [
      el('th', { scope: 'row', text: chemName('hazard-index') }),
      el('td', { class: 'num', text: hi.baseline.value ?? 'n/a' }),
      el('td', { class: `num lab-cell-${hi.cell.kind}`, text: hiCell }),
      el('td', { text: statusWord(hi.baseline.status) }),
    ]));
    table.append(body);
    wrap.append(table);
    return wrap;
  }

  /* ----- charts ----- */

  function hiChart(t, summary) {
    const W = 560; const H = 96; const ML = 8; const MR = 8; const MT = 26; const BAR = 34;
    const span = Math.max(1.15, Number(summary.mixture.raw ?? 0) * 1.05);
    const x = q => ML + (q / span) * (W - ML - MR);
    const svg = svgEl('svg', {
      class: 'lab-chart', viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': t.hiChartTitle,
    });
    svg.append(svgEl('line', {
      x1: ML, y1: MT + BAR, x2: W - MR, y2: MT + BAR, class: 'axis',
    }));
    const names = { pfhxs: 'PFHxS', pfna: 'PFNA', genx: 'GenX', pfbs: 'PFBS' };
    let offset = 0;
    let missingOffset = 0;
    const classes = { pfhxs: 'seg-1', pfna: 'seg-2', genx: 'seg-3', pfbs: 'seg-4' };
    for (const term of summary.mixture.terms) {
      const q = term.quotient === null ? 0 : Number(term.quotient);
      const g = svgEl('g', { tabindex: '0', role: 'listitem', class: 'lab-bar' });
      g.setAttribute('aria-label', `${names[term.id]}: ${term.quotient === null ? t.notReported : `quotient ${term.quotient}`}`);
      g.addEventListener('click', () => choose({ focus: term.id }));
      g.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose({ focus: term.id }); }
      });
      if (term.quotient === null) {
        const mx = Math.min(x(offset) + missingOffset, W - MR - 34);
        missingOffset += 36;
        g.append(svgEl('rect', {
          x: mx, y: MT, width: 6, height: BAR, class: 'seg-missing',
        }));
        const mt = svgEl('text', { x: mx + 9, y: MT + BAR / 2 + 3.5, class: 'seg-label' });
        mt.textContent = `${names[term.id]} n/r`;
        g.append(mt);
        svg.append(g);
        continue;
      }
      const width = Math.max(1, x(offset + q) - x(offset));
      g.append(svgEl('rect', {
        x: x(offset), y: MT, width, height: BAR, class: `seg ${classes[term.id]}`,
      }));
      const label = svgEl('text', {
        x: x(offset) + width / 2, y: MT + BAR / 2 + 3.5, 'text-anchor': 'middle', class: 'seg-label',
      });
      label.textContent = width > 56 ? `${names[term.id]} ${term.quotient}` : '';
      g.append(label);
      offset += q;
      svg.append(g);
    }
    const lx = x(1);
    svg.append(svgEl('line', { x1: lx, y1: MT - 6, x2: lx, y2: MT + BAR + 10, class: 'limit-line' }));
    const lt = svgEl('text', { x: lx, y: MT - 12, 'text-anchor': 'middle' });
    lt.textContent = t.hiLine;
    svg.append(lt);
    const total = svgEl('text', { x: W - MR, y: MT + BAR + 24, 'text-anchor': 'end', class: 'seg-total' });
    total.textContent = `${t.colHI}: ${summary.mixture.raw ?? 'n/a'} (${statusWord(summary.mixture.status)})`;
    svg.append(total);
    return svg;
  }

  function ratioChart(t, summary) {
    const ids = CHEMICALS.map(({ id }) => id);
    const W = 560; const ROWH = 24; const ML = 118; const MR = 56; const MT = 16;
    const H = MT + ids.length * ROWH + 12;
    const MAXR = 3;
    const x = r => ML + (Math.min(r, MAXR) / MAXR) * (W - ML - MR);
    const svg = svgEl('svg', {
      class: 'lab-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t.ratioChartTitle,
    });
    const lx = x(1);
    svg.append(svgEl('line', { x1: lx, y1: MT - 8, x2: lx, y2: H - 10, class: 'limit-line' }));
    const lt = svgEl('text', { x: lx, y: MT - 10 + 4, 'text-anchor': 'middle', class: 'seg-label' });
    lt.textContent = '1x';
    svg.append(lt);
    ids.forEach((id, i) => {
      const entry = summary.ratios[id];
      const y = MT + i * ROWH;
      const g = svgEl('g', {
        tabindex: '0', role: 'listitem', class: `lab-bar${lab.focus === id ? ' lab-bar-focus' : ''}`,
      });
      const ratioText = entry.value === null ? t.notReported : `${fmtRatio(entry.ratio)}x`;
      g.setAttribute('aria-label', `${chemName(id)}: ${entry.value === null ? t.notReported : `${ratioText} (${statusWord(entry.status)})`}`);
      g.addEventListener('click', () => choose({ focus: id }));
      g.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose({ focus: id }); }
      });
      const label = svgEl('text', { x: ML - 8, y: y + 15, 'text-anchor': 'end', class: 'seg-label' });
      label.textContent = chemName(id);
      g.append(label);
      if (entry.value === null) {
        g.append(svgEl('rect', {
          x: ML, y: y + 4, width: x(0.5) - ML, height: ROWH - 10, class: 'bar-missing',
        }));
        const nrt = svgEl('text', { x: x(0.5) + 6, y: y + 15, class: 'seg-label' });
        nrt.textContent = 'n/r';
        g.append(nrt);
      } else {
        const r = Number(entry.value) / Number(entry.reference);
        const width = Math.max(1, x(Math.min(r, MAXR)) - ML);
        g.append(svgEl('rect', {
          x: ML, y: y + 4, width, height: ROWH - 10,
          class: `bar-rect lab-bar-${entry.status}`,
        }));
        const vt = svgEl('text', { x: ML + width + 6, y: y + 15, class: 'seg-label' });
        vt.textContent = r > MAXR ? `>${MAXR}x` : `${fmtRatio(r)}x`;
        g.append(vt);
      }
      svg.append(g);
    });
    return svg;
  }

  /* ----- exports and self tests ----- */

  function currentBrief(view, matrix) {
    return labBrief({
      state: { preset: lab.preset, scenario: lab.scenario, lang: lab.lang, focus: lab.focus, sdg: lab.sdg },
      comparator: datasets(),
      matrix,
      sdg6: view ? sdg6Payload({
        state: lab.sdg,
        sample: {
          tap: view.summary.tap, advisory: view.summary.advisory,
          ecoli: view.summary.ecoli, values: view.summary.values,
        },
      }) : null,
    });
  }

  function render() {
    const t = tr();
    lab.link = linkFor();
    root.setAttribute('lang', lab.lang);
    root.replaceChildren();
    const heading = document.getElementById('lab-h');
    if (heading) heading.textContent = t.title;

    const head = el('div', { class: 'lab-head' }, [
      el('div', { class: 'lab-lang', role: 'group', 'aria-label': t.langLabel }, [
        el('span', { class: 'lab-lang-label', text: `${t.langLabel}:` }),
        ...LAB_LANGS.map(lang => {
          const button = el('button', {
            type: 'button', class: 'lab-chip', 'aria-pressed': String(lab.lang === lang),
            text: lang === 'en' ? 'English' : 'Español', id: `lab-lang-${lang}`,
          });
          button.addEventListener('click', () => choose({ lang }));
          return button;
        }),
      ]),
    ]);
    root.append(head);

    const view = activeSummary();
    root.append(el('h3', { text: t.comparatorTitle }), el('p', { class: 'notes', text: t.comparatorNote }));
    root.append(comparatorTable(t));

    if (view && view.dataset.samples.length > 1) {
      const select = el('select', { id: 'lab-tap', 'aria-label': t.tapLabel });
      view.dataset.samples.forEach((sample, index) => {
        select.append(el('option', { value: String(index), text: sample.tap }));
      });
      select.value = String(view.index);
      select.addEventListener('change', () => { lab.tapIndex = Number(select.value); render(); });
      root.append(el('div', { class: 'model-field lab-tap-field' }, [
        el('label', { for: 'lab-tap', text: `${t.tapLabel} (${t.matrixTap})` }), select,
      ]));
    }

    const matrix = view ? scenarioMatrix({
      tap: view.summary.tap, advisory: view.summary.advisory,
      ecoli: view.summary.ecoli, values: view.summary.values,
    }, lab.scenario) : null;

    if (view) {
      root.append(el('h3', { text: t.scenarioTitle }),
        el('p', { class: 'notes', text: t.scenarioNote }),
        scenarioButtons(t));
      if (view.summary.blocked) {
        root.append(el('p', { class: 'lab-guard', role: 'note', text: t.guard }));
      }
      root.append(matrixTable(t, matrix));
    }

    if (view) {
      root.append(el('h3', { text: t.hiChartTitle }), hiChart(t, view.summary));
      if (view.summary.mixture.missing.length) {
        root.append(el('p', {
          class: 'notes',
          text: t.hiMissing(view.summary.mixture.missing.map(id => chemName(id)).join(', ')),
        }));
      }
      root.append(el('h3', { text: t.ratioChartTitle }),
        el('p', { class: 'notes', text: t.ratioChartNote }),
        ratioChart(t, view.summary));
      if (lab.focus) {
        const isHi = lab.focus === 'hazard-index';
        const entry = isHi ? null : view.summary.ratios[lab.focus];
        const cell = isHi ? matrix?.hazardIndex.cell
          : matrix?.rows.find(row => row.id === lab.focus)?.cell ?? null;
        const cellText = cell
          ? (cell.kind === 'modeled' && cell.value !== null
            ? `${fmtValue(cell.value)}${cell.status ? ` (${statusWord(cell.status)})` : ''}`
            : t.cell[cell.kind] ?? cell.kind)
          : t.scenario[lab.scenario];
        const baseText = isHi
          ? `${view.summary.mixture.raw ?? 'n/a'} (${statusWord(view.summary.mixture.status)})`
          : entry && entry.value !== null
            ? `${entry.value} ${entry.unit} (${statusWord(entry.status)})`
            : t.notReported;
        root.append(el('p', {
          class: 'model-value lab-focus', 'aria-live': 'polite',
          text: t.detail(chemName(lab.focus), baseText, cellText),
        }));
      }
    }

    root.append(el('h3', { text: t.exportsTitle }), el('p', { class: 'notes', text: t.exportsNote }));
    const brief = view ? currentBrief(view, matrix) : null;
    const bar = el('div', { class: 'rail-actions lab-exports' });
    const addButton = (label, fn) => {
      const button = el('button', { type: 'button', class: 'secondary', text: label });
      button.disabled = !brief;
      button.addEventListener('click', fn);
      bar.append(button);
      return button;
    };
    addButton(t.btnJson, () => download('waterwatch-lab-brief.json', 'application/json', brief.json));
    addButton(t.btnCsv, () => download('waterwatch-lab-brief.csv', 'text/csv', brief.csv));
    addButton(t.btnMd, () => download('waterwatch-lab-brief.md', 'text/markdown', brief.markdown));
    addButton(t.btnCopy, async () => {
      const input = root.querySelector('.lab-link');
      try {
        await globalThis.navigator?.clipboard?.writeText(lab.link);
        lab.verifyNote = t.copied;
      } catch {
        lab.verifyNote = t.copyFallback;
      }
      if (input) { input.value = lab.link; input.select?.(); }
      renderNote();
    });
    addButton(t.btnVerify, () => {
      const result = verifyBrief(brief);
      lab.verifyNote = result.ok ? t.verifyOk : t.verifyBad;
      renderNote();
    });
    addButton(t.btnTamper, () => {
      const result = tamperBrief(brief);
      lab.verifyNote = t.tamperLine(result.actual);
      renderNote();
    });
    addButton(t.btnTests, () => {
      lab.tests = runSelfTests();
      renderTests();
    });
    root.append(bar);

    root.append(el('p', {
      class: 'fingerprint lab-digest',
      text: brief ? `${t.digestLabel}: ${brief.fingerprint}` : `${t.digestLabel}: n/a`,
    }));
    root.append(el('input', {
      type: 'text', readonly: '', class: 'lab-link', 'aria-label': t.shareLabel,
      value: lab.link,
    }));
    root.append(el('p', { class: 'lab-verify', role: 'status', 'aria-live': 'polite' }));
    const testsBox = el('div', { class: 'lab-tests' });
    root.append(testsBox);
    renderNote();
    renderTests();

    const sdgSection = document.getElementById('sdg6');
    const sdgBody = document.getElementById('sdg6-body');
    const sdgHeading = document.getElementById('sdg6-h');
    if (sdgSection && sdgBody) {
      sdgSection.hidden = false;
      if (sdgHeading) sdgHeading.textContent = (SDG6_STRINGS[lab.lang] ?? SDG6_STRINGS.en).title;
      renderSdg6Section(sdgBody, {
        lang: lab.lang,
        state: lab.sdg,
        summary: view ? view.summary : null,
        tapLabel: view
          ? `${t.sourceNames[view.dataset.id] ?? view.dataset.id} / ${view.summary.tap}`
          : null,
        choose: next => choose({ sdg: next }),
      });
    }
  }

  function renderNote() {
    const note = root.querySelector('.lab-verify');
    if (note) note.textContent = lab.verifyNote ?? '';
  }

  function renderTests() {
    const box = root.querySelector('.lab-tests');
    if (!box) return;
    box.replaceChildren();
    if (!lab.tests) return;
    const ok = lab.tests.filter(item => item.ok).length;
    box.append(el('p', {
      class: `lab-test-count${ok === lab.tests.length ? ' ok' : ' bad'}`,
      text: tr().testsPass(ok, lab.tests.length),
    }));
    const list = el('ul', { class: 'plain notes' });
    for (const item of lab.tests) {
      list.append(el('li', {
        class: item.ok ? 'lab-test-ok' : 'lab-test-bad',
        text: item.ok ? item.id : tr().testsFailLine(item),
      }));
    }
    box.append(list);
  }

  render();

  return {
    refresh() { render(); },
    setSource(id) {
      if (LAB_PRESETS.includes(id)) choose({ preset: id, tapIndex: 0 });
    },
    get state() { return { ...lab }; },
  };
}
