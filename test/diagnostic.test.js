import assert from 'node:assert/strict';
import test from 'node:test';
import { screenSample } from '../src/engine.js';
import { parseCsv } from '../src/import.js';
import { PRESETS } from '../src/presets.js';
import {
  WHO_GUIDELINES, SOURCE_HINTS, whoStatus, diagnose, benchmarkRatio, summarizeScenario,
} from '../src/diagnostic.js';

const HEAD = 'tap,advisory,ecoli,lead_ppb,copper_ppb,nitrate_mg_l_as_n,arsenic_ppb,pfoa_ppt,pfos_ppt,pfhxs_ppt,pfna_ppt,genx_ppt,pfbs_ppt';

function load(csv) {
  const samples = parseCsv(csv);
  return { samples, screens: samples.map(sample => screenSample(sample)) };
}

function preset(id) {
  return load(PRESETS.find(item => item.id === id).csv);
}

const ids = findings => findings.map(finding => finding.id);

/* ---------- WHO reference comparison ---------- */

test('WHO guideline table covers only the four inorganic fields', () => {
  assert.deepEqual(Object.keys(WHO_GUIDELINES).sort(), ['arsenic', 'copper', 'lead', 'nitrate']);
  assert.ok(Object.isFrozen(WHO_GUIDELINES));
});

test('WHO lead comparison is exact at the 10 ppb boundary', () => {
  assert.equal(whoStatus('lead', '10'), 'at');
  assert.equal(whoStatus('lead', '10.000000000001'), 'above');
  assert.equal(whoStatus('lead', '9.999999999999'), 'below');
});

test('WHO arsenic and copper compare against 10 and 2000 ppb', () => {
  assert.equal(whoStatus('arsenic', '10.0'), 'at');
  assert.equal(whoStatus('arsenic', '11'), 'above');
  assert.equal(whoStatus('copper', '1999.9'), 'below');
  assert.equal(whoStatus('copper', '2000'), 'at');
  assert.equal(whoStatus('copper', '1300'), 'below');
});

test('WHO nitrate converts mg/L as N to the 50 mg/L nitrate-ion guideline', () => {
  // 11.29 as N is 49.98 as nitrate; 11.3 as N is 50.02.
  assert.equal(whoStatus('nitrate', '11.29'), 'below');
  assert.equal(whoStatus('nitrate', '11.3'), 'above');
  assert.equal(whoStatus('nitrate', '10'), 'below');
  assert.equal(whoStatus('nitrate', '13.6'), 'above');
  assert.equal(whoStatus('nitrate', '11.2'), 'below');
});

test('WHO nitrate boundary is exact in molar-mass units', () => {
  // 50 * 14.0067 / 62.0049 = 11.294833150283...; test both sides of the 12th decimal.
  assert.equal(whoStatus('nitrate', '11.294833150283'), 'below');
  assert.equal(whoStatus('nitrate', '11.294833150284'), 'above');
});

test('WHO comparison returns null for PFAS and missing for unreported', () => {
  for (const id of ['pfoa', 'pfos', 'pfhxs', 'pfna', 'genx', 'pfbs']) assert.equal(whoStatus(id, '1'), null);
  assert.equal(whoStatus('lead', null), 'missing');
  assert.equal(whoStatus('lead', ''), 'missing');
  assert.equal(whoStatus('lead', undefined), 'missing');
});

test('WHO comparison refuses non-decimal readings', () => {
  assert.throws(() => whoStatus('lead', 'ND'), RangeError);
  assert.throws(() => whoStatus('lead', '-1'), RangeError);
  assert.throws(() => whoStatus('lead', '1e3'), RangeError);
});

test('WHO reference text names provisional values', () => {
  assert.match(WHO_GUIDELINES.lead.text, /provisional/);
  assert.match(WHO_GUIDELINES.arsenic.text, /provisional/);
  assert.doesNotMatch(WHO_GUIDELINES.copper.text, /provisional/);
  assert.match(WHO_GUIDELINES.nitrate.text, /as nitrate/);
});

/* ---------- benchmark ratio ---------- */

test('benchmark ratio divides by the EPA limit and skips PFBS and unreported', () => {
  const { screens } = preset('school');
  const lead = screens[0].results.find(r => r.id === 'lead');
  assert.equal(benchmarkRatio(lead), 2.46);
  assert.equal(benchmarkRatio(screens[0].results.find(r => r.id === 'pfbs')), null);
  assert.equal(benchmarkRatio({ value: null, limit: '10' }), null);
  assert.equal(benchmarkRatio(null), null);
});

/* ---------- presets ---------- */

test('school first draw points lead to plumbing near the tap with the flushed pair', () => {
  const { samples, screens } = preset('school');
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['lead-local']);
  assert.match(findings[0].evidence, /24\.6 ppb here but 3\.1 ppb at East hall fountain \(flushed\), 87% lower/);
  assert.equal(findings[0].cite, SOURCE_HINTS.lead);
});

test('school flushed and kitchen taps show no contamination pattern', () => {
  const { samples, screens } = preset('school');
  assert.deepEqual(ids(diagnose({ samples, screens, active: 1 })), ['clear']);
  assert.deepEqual(ids(diagnose({ samples, screens, active: 2 })), ['clear']);
});

test('industrial corridor flags the PFAS mixture with no single exceedance', () => {
  const { samples, screens } = preset('well');
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['pfas-mixture']);
  assert.match(findings[0].evidence, /^No single PFAS is above its own MCL/);
  assert.match(findings[0].evidence, /Hazard Index of 1\.27, above 1\./);
  assert.equal(findings[0].cite, SOURCE_HINTS.pfas);
});

test('storm north block orders advisory, fecal, then nitrate', () => {
  const { samples, screens } = preset('storm');
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['advisory', 'fecal', 'nitrate']);
  assert.equal(findings[0].tone, 'urgent');
  assert.equal(findings[1].tone, 'urgent');
  assert.match(findings[1].evidence, /runoff, septic, or sewage/);
  assert.match(findings[2].evidence, /13\.6 mg\/L as N, 1\.36x the MCL/);
  assert.match(findings[2].action, /infant formula/);
});

test('storm south block has no fecal finding when E. coli is unknown', () => {
  const { samples, screens } = preset('storm');
  const findings = diagnose({ samples, screens, active: 1 });
  assert.deepEqual(ids(findings), ['advisory', 'nitrate']);
  assert.match(findings[1].evidence, /11\.2 mg\/L as N, 1\.12x/);
});

test('municipal baseline shows no pattern for either tap', () => {
  const { samples, screens } = preset('baseline');
  for (const active of [0, 1]) assert.deepEqual(ids(diagnose({ samples, screens, active })), ['clear']);
});

/* ---------- lead pairing ---------- */

test('lead high at every tap points to a shared cause', () => {
  const { samples, screens } = load(`${HEAD}\nA,none,absent,20,,,,,,,,,\nB,none,absent,15,,,,,,,,,`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['lead-shared']);
  assert.match(findings[0].evidence, /B, still reads 15 ppb \(75% of this tap\)/);
});

test('a single lead tap asks for a first-draw and flushed pair', () => {
  const { samples, screens } = load(`${HEAD}\nOnly,none,absent,12,,,,,,,,,`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['lead-unpaired']);
  assert.match(findings[0].evidence, /12 ppb, 1\.2x the action level/);
  assert.match(findings[0].action, /first-draw and a flushed sample/);
});

test('lead pairing ignores taps with unreported lead', () => {
  const { samples, screens } = load(`${HEAD}\nOnly,none,absent,12,,,,,,,,,\nBlank,none,absent,,5,,,,,,,,`);
  assert.deepEqual(ids(diagnose({ samples, screens, active: 0 })), ['lead-unpaired']);
});

test('lead at exactly half of this tap counts as local plumbing', () => {
  const { samples, screens } = load(`${HEAD}\nA,none,absent,20,,,,,,,,,\nB,none,absent,10,,,,,,,,,`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['lead-local']);
  assert.match(findings[0].evidence, /50% lower/);
});

test('lead at the action level is treated like above without overstating it', () => {
  const { samples, screens } = load(`${HEAD}\nA,none,absent,10,,,,,,,,,`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['lead-unpaired']);
  assert.match(findings[0].title, /^Lead at or above/);
  assert.doesNotMatch(findings[0].title, /^Lead above/);
});

test('lead pairing picks the lowest other tap', () => {
  const { samples, screens } = load(`${HEAD}\nA,none,absent,30,,,,,,,,,\nB,none,absent,20,,,,,,,,,\nC,none,absent,3,,,,,,,,,`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.match(findings[0].evidence, /3 ppb at C, 90% lower/);
});

/* ---------- other contaminants ---------- */

test('copper and arsenic findings carry EPA source hints', () => {
  const { samples, screens } = load(`${HEAD}\nWell,none,absent,,1400,,12,,,,,,`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['copper', 'arsenic']);
  assert.equal(findings[0].cite, SOURCE_HINTS.copper);
  assert.equal(findings[1].cite, SOURCE_HINTS.arsenic);
  assert.match(findings[0].evidence, /1\.08x the 1300 ppb action level/);
  assert.match(findings[1].evidence, /1\.2x the MCL/);
});

test('individual PFAS exceedances list each compound and ratio', () => {
  const { samples, screens } = load(`${HEAD}\nT,none,absent,,,,,8,4.0,,,,`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['pfas-single']);
  assert.match(findings[0].evidence, /PFOA 8 ppt \(2x\), PFOS 4\.0 ppt \(1x\)/);
});

test('mixture above the index alongside a single exceedance drops the no-single claim', () => {
  const { samples, screens } = load(`${HEAD}\nT,none,absent,,,,,,,12,5,,10`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['pfas-single', 'pfas-mixture']);
  assert.doesNotMatch(findings[1].evidence, /No single PFAS/);
});

test('a lower-bound mixture says the unreported terms are still out', () => {
  const { samples, screens } = load(`${HEAD}\nT,none,absent,,,,,,,9,9,,`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['pfas-mixture']);
  assert.match(findings[0].evidence, /even before the unreported terms/);
});

test('E. coli alone gives a fecal finding without the nitrate clause', () => {
  const { samples, screens } = load(`${HEAD}\nT,none,present,1,1,1,1,1,1,1,1,1,1`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['fecal']);
  assert.doesNotMatch(findings[0].evidence, /nitrate/i);
});

test('do-not-drink and do-not-use advisories lead the list', () => {
  for (const advisory of ['do-not-drink', 'do-not-use']) {
    const { samples, screens } = load(`${HEAD}\nT,${advisory},absent,1,1,1,1,1,1,1,1,1,1`);
    const findings = diagnose({ samples, screens, active: 0 });
    assert.deepEqual(ids(findings), ['advisory']);
    assert.match(findings[0].evidence, new RegExp(`A ${advisory} advisory`));
  }
});

test('unreported fields limit the pattern check instead of clearing it', () => {
  const { samples, screens } = load(`${HEAD}\nT,unknown,unknown,1,,,,,,,,,`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['unknown']);
  assert.match(findings[0].evidence, /^11 fields are unreported/);
});

test('one unreported field uses the singular', () => {
  const { samples, screens } = load(`${HEAD}\nT,none,absent,1,1,1,1,1,1,1,1,1,`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.match(findings[0].evidence, /^1 field is unreported/);
});

/* ---------- contract ---------- */

test('diagnose tolerates bad input and out-of-range taps', () => {
  assert.deepEqual(diagnose({ samples: null, screens: [] }), []);
  const { samples, screens } = preset('school');
  assert.deepEqual(diagnose({ samples, screens, active: 9 }), []);
});

test('diagnose is deterministic and leaves its inputs untouched', () => {
  const { samples, screens } = preset('storm');
  const before = JSON.stringify({ samples, screens });
  const a = diagnose({ samples, screens, active: 0 });
  const b = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify({ samples, screens }), before);
  assert.ok(a.every(finding => Object.isFrozen(finding)));
});

test('every finding has a title in both languages, evidence, and an action', () => {
  for (const { csv } of PRESETS) {
    const { samples, screens } = load(csv);
    samples.forEach((_, active) => {
      for (const finding of diagnose({ samples, screens, active })) {
        for (const key of ['title', 'titleEs', 'evidence', 'action']) {
          assert.equal(typeof finding[key], 'string');
          assert.ok(finding[key].length > 8, `${finding.id}.${key}`);
        }
        assert.ok(['urgent', 'caution', 'info', 'clear'].includes(finding.tone));
      }
    });
  }
});

test('diagnostic wording hedges and never claims proof', () => {
  for (const { csv } of PRESETS) {
    const { samples, screens } = load(csv);
    samples.forEach((_, active) => {
      for (const finding of diagnose({ samples, screens, active })) {
        assert.doesNotMatch(`${finding.title} ${finding.evidence}`, /\b(proves?|confirm(?:s|ed)?|certainly|definitely)\b/i);
      }
    });
  }
});

/* ---------- scenario cards ---------- */

test('scenario cards state each preset result from the engine', () => {
  assert.deepEqual(summarizeScenario(preset('school')), {
    tone: 'caution', icon: 'mark-at', text: 'Lead above in 1 of 3 taps',
  });
  assert.deepEqual(summarizeScenario(preset('well')), {
    tone: 'caution', icon: 'mark-at', text: 'PFAS mixture above benchmark',
  });
  assert.deepEqual(summarizeScenario(preset('storm')), {
    tone: 'urgent', icon: 'mark-above', text: 'Boil notice, E. coli present',
  });
  assert.deepEqual(summarizeScenario(preset('baseline')), {
    tone: 'clear', icon: 'mark-below', text: 'Within screened benchmarks',
  });
});

test('scenario summary ranks do-not-use over boil and names at most two contaminants', () => {
  assert.equal(summarizeScenario(load(`${HEAD}\nA,boil,absent,1,,,,,,,,,\nB,do-not-use,absent,1,,,,,,,,,`)).text, 'Do-not-use notice');
  const many = summarizeScenario(load(`${HEAD}\nA,none,absent,20,1400,12,,,,,,,`));
  assert.equal(many.text, 'Lead and Copper above benchmark');
  assert.equal(summarizeScenario(load(`${HEAD}\nA,none,absent,1,,,,,,,,,`)).tone, 'pending');
});

test('boundary wording stays at or above for nitrate arsenic and PFAS', () => {
  const { samples, screens } = load(`${HEAD}\nT,none,absent,,,10,10,,4,,,,`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['nitrate', 'arsenic', 'pfas-single']);
  for (const finding of findings) assert.match(finding.title, /at or above/);
});

test('scenario summary marks E. coli without an advisory as urgent', () => {
  const summary = summarizeScenario(load(`${HEAD}\nA,none,present,1,1,1,1,1,1,1,1,1,1`));
  assert.deepEqual(summary, { tone: 'urgent', icon: 'mark-above', text: 'E. coli present' });
});
