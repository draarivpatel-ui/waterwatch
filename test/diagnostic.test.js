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
  assert.match(findings[0].evidence, /Lead falls from 24\.6 ppb in the first draw at East hall fountain \(first draw\) to 3\.1 ppb in the flushed draw at East hall fountain \(flushed\), 87% lower/);
  assert.equal(findings[0].cite, SOURCE_HINTS.lead);
});

test('school flushed draw keeps the same pair finding while the kitchen tap stays clear', () => {
  const { samples, screens } = preset('school');
  assert.deepEqual(ids(diagnose({ samples, screens, active: 1 })), ['lead-local']);
  assert.deepEqual(ids(diagnose({ samples, screens, active: 2 })), ['clear']);
  assert.equal(diagnose({ samples, screens, active: 0 })[0].evidence, diagnose({ samples, screens, active: 1 })[0].evidence);
});

test('industrial corridor flags the PFAS mixture with no single exceedance', () => {
  const { samples, screens } = preset('well');
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['pfas-mixture']);
  assert.match(findings[0].evidence, /^PFHxS, PFNA and PFBS are at or above their practical quantitation levels/);
  assert.match(findings[0].evidence, /Hazard Index is 1\.27, above 1\./);
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

test('boil notice plus E. coli at exactly 10 mg/L nitrate qualifies the advisory card in both languages', () => {
  const { samples, screens } = load(`${HEAD}\nT,boil,present,0,0,10.0,0,0,0,0,0,0,0`);
  assert.equal(screens[0].results.find(result => result.id === 'nitrate').status, 'at');
  assert.deepEqual(screens[0].chemicals, []);
  assert.equal(screens[0].action, 'co-occurrence');
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['advisory', 'fecal', 'nitrate']);
  const advisory = findings[0];
  assert.doesNotMatch(advisory.action, /before anything below/);
  assert.match(advisory.action, /Nitrate is at or above 10 mg\/L as N/);
  assert.match(advisory.action, /boiling does not make this tap water safe for infant formula/i);
  assert.match(advisory.action, /commercially bottled water or another approved source/);
  assert.doesNotMatch(advisory.actionEs, /antes que cualquier paso posterior/);
  assert.match(advisory.actionEs, /nitrato está en 10 mg\/L como N o por encima/);
  assert.match(advisory.actionEs, /hervir no hace que esta agua del grifo sea segura para preparar fórmula infantil/i);
  assert.match(advisory.actionEs, /agua embotellada comercial u otra fuente aprobada/);
});

test('municipal baseline shows no pattern for either tap', () => {
  const { samples, screens } = preset('baseline');
  for (const active of [0, 1]) assert.deepEqual(ids(diagnose({ samples, screens, active })), ['clear']);
});

/* ---------- lead pairing ---------- */

test('unrelated lead rows report contrast without inventing shared plumbing', () => {
  const { samples, screens } = load(`${HEAD}\nKitchen,none,absent,11,,,,,,,,,\nUnrelated well,none,absent,6,,,,,,,,,`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['lead-contrast']);
  assert.match(findings[0].evidence, /Unrelated well, reads 6 ppb/);
  assert.match(findings[0].evidence, /cannot separate local plumbing from source water/);
  assert.doesNotMatch(findings[0].evidence, /shared service line|shared plumbing|stays high/i);
});

test('explicit paired metadata high in both draws supports a shared pattern', () => {
  const { samples, screens } = load(`tap,lead_ppb,pair_id,draw_type\nA,20,pair1,first-draw\nB,15,pair1,flushed`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['lead-shared']);
  assert.match(findings[0].evidence, /first draw at A and 15 ppb in the flushed draw at B/);
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

test('lead at exactly half with the flushed draw still at the benchmark combines local and shared hints', () => {
  const { samples, screens } = load(`tap,lead_ppb,pair_id,draw_type\nA,20,pair1,first-draw\nB,10,pair1,flushed`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['lead-local-shared']);
  assert.match(findings[0].evidence, /50% lower/);
  assert.match(findings[0].evidence, /near the tap or fixture/);
  assert.match(findings[0].evidence, /upstream or shared plumbing or corrosive water/);
});

test('lead at the action level is treated like above without overstating it', () => {
  const { samples, screens } = load(`${HEAD}\nA,none,absent,10,,,,,,,,,`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['lead-unpaired']);
  assert.match(findings[0].title, /^Lead at or above/);
  assert.doesNotMatch(findings[0].title, /^Lead above/);
});

test('lead pairing picks the highest paired draw of each type and notes repeats', () => {
  const { samples, screens } = load(`tap,lead_ppb,pair_id,draw_type\nA,30,pair1,first-draw\nB,12,pair1,flushed\nC,3,pair1,flushed`);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.match(findings[0].evidence, /to 12 ppb in the flushed draw at B, 60% lower/);
  assert.match(findings[0].evidence, /1 first-draw row and 2 flushed rows/);
  assert.match(findings[0].evidence, /highest reported result for each draw type/);
  assert.match(findings[0].evidenceEs, /1 fila de primera extracción y 2 filas de purga/);
});

test('30 first draw with 3 and 12 ppb repeated flushed rows gives one identical pair reading', () => {
  const { samples, screens } = load(`tap,lead_ppb,pair_id,draw_type\nA,30,pair-repeat,first-draw\nB,3,pair-repeat,flushed\nC,12,pair-repeat,flushed`);
  const leads = [0, 1, 2].map(active =>
    diagnose({ samples, screens, active }).find(finding => finding.id.startsWith('lead-')));
  assert.deepEqual(leads.map(finding => finding.id), ['lead-local-shared', 'lead-local-shared', 'lead-local-shared']);
  for (const finding of leads) {
    assert.match(finding.evidence, /to 12 ppb in the flushed draw at C, 60% lower/);
    assert.match(finding.evidence, /1 first-draw row and 2 flushed rows/);
    assert.match(finding.evidenceEs, /resultado más alto de cada tipo de extracción/);
    assert.equal(finding.compactEn, 'Paired lead 30 -> 12 ppb: check fixture plus upstream/shared plumbing; resample.');
    assert.equal(finding.compactEs, 'Plomo pareado 30 -> 12 ppb: revise grifo y plomería aguas arriba/compartida; repita.');
  }
  for (const key of ['title', 'titleEs', 'evidence', 'evidenceEs', 'action', 'actionEs', 'compactEn', 'compactEs']) {
    assert.equal(leads[0][key], leads[1][key], `${key} first vs 3 ppb flush`);
    assert.equal(leads[0][key], leads[2][key], `${key} first vs 12 ppb flush`);
  }
  assert.equal(screens[0].results.find(result => result.id === 'lead').status, 'above');
  assert.equal(screens[1].results.find(result => result.id === 'lead').status, 'below');
  assert.equal(screens[2].results.find(result => result.id === 'lead').status, 'above');
});

test('a 2 to 24 ppb pair reports the flushed rise and never claims near-tap plumbing', () => {
  const { samples, screens } = load(`tap,lead_ppb,pair_id,draw_type\nA,2,pair1,first-draw\nB,24,pair1,flushed`);
  const findings = diagnose({ samples, screens, active: 1 });
  const lead = findings.find(finding => finding.id.startsWith('lead-'));
  assert.equal(lead.id, 'lead-rises');
  assert.match(lead.title, /rises in the flushed draw/i);
  assert.match(lead.evidence, /flushed draw rose above the first draw/i);
  assert.match(lead.evidence, /away from fixture-only stagnation/i);
  assert.match(lead.evidence, /upstream supply or the service line/i);
  assert.doesNotMatch(`${lead.title} ${lead.evidence}`, /near this tap|stays high|fixture-only stagnation fits/i);
  assert.match(lead.evidenceEs, /extracción de purga aumentó por encima de la primera extracción/);
  assert.match(lead.evidenceEs, /suministro aguas arriba o la línea de servicio/);
});

test('a 10 to 6 ppb pair reports that the flushed sample dropped below the benchmark', () => {
  const { samples, screens } = load(`tap,lead_ppb,pair_id,draw_type\nA,10,pair1,first-draw\nB,6,pair1,flushed`);
  const findings = diagnose({ samples, screens, active: 0 });
  const lead = findings.find(finding => finding.id.startsWith('lead-'));
  assert.equal(lead.id, 'lead-drops-below');
  assert.match(lead.evidence, /first draw at A, at or above the 10 ppb benchmark/);
  assert.match(lead.evidence, /flushed sample dropped below the benchmark/);
  assert.doesNotMatch(`${lead.title} ${lead.evidence}`, /stays high|shared plumbing|near this tap/i);
  assert.match(lead.evidenceEs, /muestra de purga bajó por debajo del nivel de referencia/);
});


test('a 30 to 12 ppb pair gives the same combined local and upstream interpretation on both draws', () => {
  const { samples, screens } = load(`tap,lead_ppb,pair_id,draw_type\nA,30,pair1,first-draw\nB,12,pair1,flushed`);
  const first = diagnose({ samples, screens, active: 0 }).find(finding => finding.id.startsWith('lead-'));
  const flushed = diagnose({ samples, screens, active: 1 }).find(finding => finding.id.startsWith('lead-'));
  for (const lead of [first, flushed]) {
    assert.equal(lead.id, 'lead-local-shared');
    assert.match(lead.evidence, /large drop points strongly to plumbing near the tap or fixture/);
    assert.match(lead.evidence, /flushed draw remains at or above 10 ppb/);
    assert.match(lead.evidence, /upstream or shared plumbing or corrosive water/);
    assert.doesNotMatch(`${lead.title} ${lead.evidence}`, /one fixture is unlikely/);
    assert.match(lead.evidenceEs, /plomería cercana al grifo o al accesorio/);
    assert.match(lead.evidenceEs, /plomería aguas arriba o compartida o el agua corrosiva/);
  }
  for (const key of ['title', 'titleEs', 'evidence', 'evidenceEs', 'action', 'actionEs']) assert.equal(first[key], flushed[key]);
  assert.equal(screens[0].results.find(result => result.id === 'lead').status, 'above');
  assert.equal(screens[1].results.find(result => result.id === 'lead').status, 'above');
});

test('a 2 to 24 ppb pair keeps the same rise finding when the low first draw is selected', () => {
  const { samples, screens } = load(`tap,lead_ppb,pair_id,draw_type\nA,2,pair1,first-draw\nB,24,pair1,flushed`);
  const first = diagnose({ samples, screens, active: 0 }).find(finding => finding.id.startsWith('lead-'));
  const flushed = diagnose({ samples, screens, active: 1 }).find(finding => finding.id.startsWith('lead-'));
  assert.equal(first?.id, 'lead-rises');
  assert.equal(flushed?.id, 'lead-rises');
  for (const key of ['title', 'titleEs', 'evidence', 'evidenceEs', 'action', 'actionEs']) assert.equal(first[key], flushed[key]);
  assert.equal(screens[0].results.find(result => result.id === 'lead').status, 'below');
  assert.equal(screens[1].results.find(result => result.id === 'lead').status, 'above');
});

test('a 10 to 6 ppb pair keeps the same drop-below finding on both draws', () => {
  const { samples, screens } = load(`tap,lead_ppb,pair_id,draw_type\nA,10,pair1,first-draw\nB,6,pair1,flushed`);
  const first = diagnose({ samples, screens, active: 0 }).find(finding => finding.id.startsWith('lead-'));
  const flushed = diagnose({ samples, screens, active: 1 }).find(finding => finding.id.startsWith('lead-'));
  assert.equal(first?.id, 'lead-drops-below');
  assert.equal(flushed?.id, 'lead-drops-below');
  for (const key of ['title', 'titleEs', 'evidence', 'evidenceEs', 'action', 'actionEs']) assert.equal(first[key], flushed[key]);
  assert.match(first.evidenceEs, /muestra de purga bajó por debajo del nivel de referencia/);
  assert.equal(screens[0].results.find(result => result.id === 'lead').status, 'at');
  assert.equal(screens[1].results.find(result => result.id === 'lead').status, 'below');
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
  assert.match(findings[0].evidence, /partial sum and a lower bound/);
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

test('PFBS-only high reading is a single-compound screening signal, never a mixture claim', () => {
  const { samples, screens } = load(`tap,pfhxs_ppt,pfna_ppt,genx_ppt,pfbs_ppt\nT,0,0,0,5000`);
  assert.equal(screens[0].mixture.raw, '2.5');
  assert.equal(screens[0].mixture.status, 'above');
  assert.equal(screens[0].mixture.epaMixture, false);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['pfas-mixture']);
  assert.match(findings[0].title, /One PFAS drives the screening sum/);
  assert.match(findings[0].evidence, /single-compound screening signal/);
  assert.doesNotMatch(`${findings[0].title} ${findings[0].evidence}`, /Several PFAS add up/i);
});

test('nonzero inputs below quantitation levels do not count as an EPA mixture', () => {
  const { screens } = load(`tap,pfhxs_ppt,pfna_ppt,genx_ppt,pfbs_ppt\nT,0,2,2,5000`);
  assert.equal(screens[0].mixture.quantified, 1);
  assert.equal(screens[0].mixture.epaMixture, false);
});

test('zero quantified PFAS constituents never invent a quantified driver for the 1.197 screening sum', () => {
  const { samples, screens } = load(`tap,pfhxs_ppt,pfna_ppt,genx_ppt,pfbs_ppt\nT,2.99,3.99,4.99,0`);
  assert.equal(screens[0].mixture.raw, '1.197');
  assert.equal(screens[0].mixture.quantified, 0);
  assert.equal(screens[0].mixture.epaMixture, false);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['pfas-mixture']);
  const mixture = findings[0];
  assert.match(mixture.title, /Below-quantitation PFAS sum/);
  assert.match(mixture.evidence, /None of the reported mixture constituents reached their EPA practical quantitation levels/);
  assert.match(mixture.evidence, /below-quantitation screening signal only/);
  assert.doesNotMatch(`${mixture.title} ${mixture.evidence}`, /only mixture constituent|PFHxS is the only|single-compound screening signal/i);
  assert.match(mixture.evidenceEs, /Ninguno de los constituyentes reportados de la mezcla alcanzó sus niveles prácticos de cuantificación de la EPA/);
  assert.match(mixture.evidenceEs, /solo una señal de evaluación por debajo del nivel de cuantificación/);
});

test('one quantified constituent below 1 plus below-quantitation terms is a combined signal', () => {
  const { samples, screens } = load(`tap,pfhxs_ppt,pfna_ppt,genx_ppt,pfbs_ppt\nT,3.00,3.99,4.99,0`);
  assert.equal(screens[0].mixture.raw, '1.198');
  assert.equal(screens[0].mixture.quantified, 1);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.deepEqual(ids(findings), ['pfas-mixture']);
  const mixture = findings[0];
  assert.match(mixture.title, /Combined PFAS terms/);
  assert.match(mixture.evidence, /own quotient is 0\.3, below 1/);
  assert.match(mixture.evidence, /combined screening signal \(one quantified constituent plus below-quantitation terms\)/);
  assert.doesNotMatch(`${mixture.title} ${mixture.evidence}`, /single-compound screening signal|drives the screening sum/i);
  assert.match(mixture.evidenceEs, /señal de evaluación combinada \(un constituyente cuantificado más términos por debajo del nivel de cuantificación\)/);
});

test('PFHxS 3 ppt with the other mixture terms unreported never claims combined terms', () => {
  const { samples, screens } = load(`tap,pfhxs_ppt,pfna_ppt,genx_ppt,pfbs_ppt\nT,3,,,`);
  assert.equal(screens[0].mixture.raw, '0.3');
  assert.equal(screens[0].mixture.quantified, 1);
  assert.equal(screens[0].mixture.status, 'incomplete');
  const findings = diagnose({ samples, screens, active: 0 });
  assert.equal(findings.some(finding => finding.id === 'pfas-mixture'), false);
  const text = findings.map(finding => `${finding.title} ${finding.evidence} ${finding.titleEs} ${finding.evidenceEs}`).join(' ');
  assert.doesNotMatch(text, /combined screening signal|below-quantitation terms|señal de evaluación combinada/i);
});

test('two quantified mixture constituents make the EPA multi-constituent mixture explicit', () => {
  const { samples, screens } = load(`tap,pfhxs_ppt,pfna_ppt,genx_ppt,pfbs_ppt\nT,0,6,5,0`);
  assert.equal(screens[0].mixture.epaMixture, true);
  const findings = diagnose({ samples, screens, active: 0 });
  assert.match(findings[0].title, /Quantified PFAS mixture/);
  assert.match(findings[0].evidence, /multi-constituent Hazard Index/);
});

test('partial PFAS sum is labeled as a lower bound distinct from a complete mixture', () => {
  const { samples, screens } = load(`tap,pfhxs_ppt,pfna_ppt,genx_ppt,pfbs_ppt\nT,6,5,,`);
  assert.equal(screens[0].mixture.status, 'above-lower-bound');
  const findings = diagnose({ samples, screens, active: 0 });
  assert.match(findings[0].title, /lower-bound screen/);
  assert.match(findings[0].evidence, /partial sum and a lower bound/);
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
        for (const key of ['title', 'titleEs', 'evidence', 'evidenceEs', 'action', 'actionEs']) {
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
