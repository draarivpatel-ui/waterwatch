import {
  CHEMICALS, screenSample, boilModel, flushLead, compareTreatment,
} from './engine.js';
import { PRESETS } from './presets.js';
import { auditCsv, buildBundle } from './exports.js';
import { parseCsv, decodeUpload } from './import.js';
import { shortcutAction } from './shortcuts.js';
import {
  WHO_GUIDELINES, whoStatus, diagnose, benchmarkRatio, summarizeScenario,
} from './diagnostic.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = id => document.getElementById(id);

const state = {
  samples: [],
  screens: [],
  active: 0,
  stale: false,
  shortcuts: false,
  synthetic: false,
  lang: 'en',
};
let importRequest = 0;
let labController = null;

const LABELS = Object.fromEntries(CHEMICALS.map(({ id, label }) => [id, label]));
const UNKNOWN_NAMES = { ...LABELS, advisory: 'advisory', ecoli: 'E. coli status' };

const SOURCES = [
  ['EPA, PFAS National Primary Drinking Water Regulation (final rule, 2024)',
    'https://www.federalregister.gov/documents/2024/04/26/2024-07773/pfas-national-primary-drinking-water-regulation'],
  ['EPA, significant-figure rounding for the PFAS rule (Dec 2024)',
    'https://www.epa.gov/system/files/documents/2024-12/pfas-sigfigs-rounding-dec24.pdf'],
  ['EPA, proposed PFAS rescission rule (proposed 2026)',
    'https://www.epa.gov/sdwa/proposed-pfas-rescission-rule'],
  ['EPA, Lead and Copper Rule Improvements',
    'https://www.epa.gov/ground-water-and-drinking-water/lead-and-copper-rule-improvements'],
  ['EPA, National Primary Drinking Water Regulations table',
    'https://www.epa.gov/ground-water-and-drinking-water/national-primary-drinking-water-regulations'],
  ['E. coli maximum contaminant level, 40 CFR 141.63',
    'https://www.ecfr.gov/current/title-40/part-141/section-141.63'],
  ['CDC, Drinking Water Advisories overview',
    'https://www.cdc.gov/water-emergency/about/drinking-water-advisories-an-overview.html'],
  ['CDC, feeding your child safely during a disaster',
    'https://www.cdc.gov/breastfeeding/php/guidelines-recommendations/feeding-your-child-safely-during-a-disaster.html'],
  ['EPA, identifying filters certified to reduce PFAS',
    'https://www.epa.gov/water-research/identifying-drinking-water-filters-certified-reduce-pfas'],
  ['WHO, Guidelines for drinking-water quality (4th edition with first, second and third addenda, 2026)',
    'https://www.who.int/publications/i/item/9789240121225'],
];

const ACTIONS = {
  'co-occurrence': {
    cls: 'urgent', icon: 'mark-above',
    en: {
      title: 'Do not boil this tap water for drinking or infant formula',
      body: 'Use commercially bottled water or another source approved by local health officials. If available, use ready-to-feed infant formula. Boiling kills germs but does not remove these chemicals; evaporation can raise their concentration. Do not rely on a household filter during this advisory unless local officials specifically approve it. Contact the water utility and the local health department now for instructions.',
    },
    es: {
      title: 'No hierva esta agua del grifo para beber ni para preparar fórmula infantil',
      body: 'Use agua embotellada comercial u otra fuente aprobada por las autoridades locales de salud. Si está disponible, use fórmula infantil lista para usar. Hervir mata los gérmenes pero no elimina estas sustancias químicas; la evaporación puede aumentar su concentración. No confíe en un filtro doméstico durante este aviso a menos que las autoridades locales lo aprueben específicamente. Comuníquese ahora con la empresa de agua y el departamento de salud local para recibir instrucciones.',
    },
  },
  'do-not-use': {
    cls: 'urgent', icon: 'mark-above',
    en: {
      title: 'Reported do-not-use advisory',
      body: 'Do not use this tap water for any purpose unless local health officials specifically say a use is permitted. Follow the instructions issued by the water system or local health officials and use bottled water or another approved source. This advisory was entered by the user; WaterWatch does not verify notices live, and this screen never replaces the official notice.',
    },
    es: {
      title: 'Aviso reportado de no usar el agua',
      body: 'No use esta agua del grifo para ningún fin a menos que las autoridades locales de salud indiquen específicamente que un uso está permitido. Siga las instrucciones del sistema de agua o de las autoridades locales de salud y use agua embotellada u otra fuente aprobada. Este aviso fue ingresado por el usuario; WaterWatch no verifica avisos en vivo y esta evaluación nunca reemplaza el aviso oficial.',
    },
  },
  'do-not-drink': {
    cls: 'urgent', icon: 'mark-above',
    en: {
      title: 'Reported do-not-drink advisory',
      body: 'Do not drink this tap water or use it for cooking or infant formula. Follow the instructions issued by the water system or local health officials and use commercially bottled water or another approved source. Boiling is not a fix for chemical contamination, and a household filter is not a substitute for the official notice. This advisory was entered by the user; WaterWatch does not verify notices live.',
    },
    es: {
      title: 'Aviso reportado de no beber el agua',
      body: 'No beba esta agua del grifo ni la use para cocinar o preparar fórmula infantil. Siga las instrucciones del sistema de agua o de las autoridades locales de salud y use agua embotellada comercial u otra fuente aprobada. Hervir no corrige la contaminación química y un filtro doméstico no sustituye el aviso oficial. Este aviso fue ingresado por el usuario; WaterWatch no verifica avisos en vivo.',
    },
  },
  boil: {
    cls: 'caution', icon: 'mark-above',
    en: {
      title: 'Reported boil advisory',
      body: 'Use commercially bottled water first if it is available. Otherwise follow the boil notice exactly as issued by the water system or health officials: bring water to a rolling boil for the instructed time before drinking, cooking, or brushing teeth. If chemical contamination is suspected, use bottled water and ask local officials before relying on boiled water. This advisory was entered by the user; WaterWatch does not verify notices live.',
    },
    es: {
      title: 'Aviso reportado de hervir el agua',
      body: 'Use agua embotellada comercial primero si está disponible. De lo contrario, siga el aviso de hervir exactamente como lo emitió el sistema de agua o las autoridades de salud: lleve el agua a hervor continuo por el tiempo indicado antes de beberla, cocinar o cepillarse los dientes. Si se sospecha contaminación química, use agua embotellada y consulte a las autoridades locales antes de confiar en el agua hervida. Este aviso fue ingresado por el usuario; WaterWatch no verifica avisos en vivo.',
    },
  },
  microbial: {
    cls: 'caution', icon: 'mark-above',
    en: {
      title: 'E. coli reported present in this sample',
      body: 'A positive E. coli result means the water may contain harmful germs. Contact the water system and local health officials urgently and use bottled water for drinking and formula until officials say otherwise. A rule violation depends on routine and repeat samples, but a single positive still warrants urgent contact.',
    },
    es: {
      title: 'Se reportó E. coli en esta muestra',
      body: 'Un resultado positivo de E. coli significa que el agua puede contener gérmenes dañinos. Comuníquese con urgencia con el sistema de agua y las autoridades locales de salud, y use agua embotellada para beber y preparar fórmula hasta que las autoridades indiquen lo contrario.',
    },
  },
  chemical: {
    cls: 'caution', icon: 'mark-at',
    en: {
      title: 'One or more measurements above the screened benchmark',
      body: 'Share these results with the water utility or local health department for guidance. This screen compares single readings to federal reference levels; it is not a potability determination and does not clear or condemn the tap.',
    },
    es: {
      title: 'Una o más mediciones superan el nivel de referencia',
      body: 'Comparta estos resultados con la empresa de agua o el departamento de salud local para recibir orientación. Esta evaluación compara lecturas individuales con niveles de referencia federales; no es una determinación de potabilidad.',
    },
  },
  incomplete: {
    cls: 'pending', icon: 'mark-missing',
    en: {
      title: 'Screen incomplete: unreported fields',
      body: 'Some advisory or measurement fields are unreported, so this tap cannot be treated as screened. The unknowns are listed below; do not read this report as an all-clear.',
    },
    es: {
      title: 'Evaluación incompleta: faltan datos',
      body: 'Algunos campos del aviso o de las mediciones no fueron reportados, por lo que este grifo no puede considerarse evaluado. No lea este informe como un visto bueno.',
    },
  },
  review: {
    cls: 'clear', icon: 'mark-below',
    en: {
      title: 'Within the screened benchmarks for this sample',
      body: 'Every reported measurement is below or at its reference level for this single tap sample. That is not compliance and not clearance: it is one tap, one moment, and only the fields shown.',
    },
    es: {
      title: 'Dentro de los niveles de referencia para esta muestra',
      body: 'Cada medición reportada está por debajo o en su nivel de referencia para esta única muestra del grifo. Eso no es cumplimiento ni una autorización: es un solo grifo, en un solo momento, y solo los campos mostrados.',
    },
  },
};

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

function mark(id) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'mark');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

const STATUS_UI = {
  above: ['mark-above', 'status-above', 'Above benchmark'],
  at: ['mark-at', 'status-at', 'At benchmark'],
  below: ['mark-below', 'status-below', 'Below benchmark'],
  missing: ['mark-missing', 'status-missing', 'Not reported'],
  'no-limit': ['mark-scope', 'status-no-limit', 'Mixture screen only'],
};

function fmt(value, digits = 6) {
  if (value === null || value === undefined) return 'not reported';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(Number(n.toPrecision(digits)));
}

function money(value) {
  return `$${Number(value).toFixed(2)}`;
}

function current() {
  if (state.stale || !state.samples.length || !state.screens[state.active]) return null;
  return { sample: state.samples[state.active], screen: state.screens[state.active] };
}

/* ---------- presets, import, and sample state ---------- */

function renderPresets() {
  const strip = $('preset-strip');
  strip.replaceChildren();
  for (const preset of PRESETS) {
    const samples = parseCsv(preset.csv);
    const summary = summarizeScenario({ samples, screens: samples.map(sample => screenSample(sample)) });
    const button = el('button', { type: 'button', 'aria-pressed': 'false', class: `scenario tone-${summary.tone}` }, [
      mark(summary.icon),
      el('span', { class: 'scenario-title', text: preset.title }),
      el('span', { class: 'scenario-status', text: summary.text }),
    ]);
    button.addEventListener('click', () => {
      $('csv-input').value = preset.csv;
      applyText(preset.csv, `${preset.title} preset. ${preset.description} Synthetic data, not measurements from a real system.`, true);
      button.setAttribute('aria-pressed', 'true');
    });
    strip.append(button);
  }
}

function setSourceNote(text) {
  $('source-note').textContent = text;
}

function clearReport(errors) {
  state.samples = [];
  state.screens = [];
  state.active = 0;
  state.stale = false;
  state.synthetic = false;
  clearPresetSelection();
  $('fingerprint').hidden = true;
  $('fingerprint').textContent = '';
  $('export-error').hidden = true;
  showImportErrors(errors);
  renderAll();
}

function clearPresetSelection() {
  for (const button of document.querySelectorAll('#preset-strip button')) {
    button.setAttribute('aria-pressed', 'false');
  }
}

function applyText(text, note, synthetic = false) {
  importRequest += 1;
  clearPresetSelection();
  $('fingerprint').hidden = true;
  $('fingerprint').textContent = '';
  $('export-error').hidden = true;
  let samples;
  try {
    samples = parseCsv(text);
  } catch (error) {
    clearReport(error.errors ?? [{ row: 1, field: null, message: error.message }]);
    return;
  }
  $('import-errors').hidden = true;
  $('import-errors').replaceChildren();
  state.samples = samples;
  state.screens = samples.map(sample => screenSample(sample));
  state.active = 0;
  state.stale = false;
  state.synthetic = synthetic;
  setSourceNote(note);
  labController?.setSource(PRESETS.find(preset => preset.csv === text)?.id ?? 'imported');
  renderAll();
}

function showImportErrors(errors) {
  const box = $('import-errors');
  box.replaceChildren();
  box.hidden = false;
  box.append(el('strong', {
    text: `${errors.length} problem${errors.length === 1 ? '' : 's'} stopped the import. Nothing was applied; fix the CSV and apply again.`,
  }));
  const list = el('ul');
  for (const { row, field, message } of errors) {
    list.append(el('li', {
      text: `Row ${row}${field ? `, ${field}` : ''}: ${message}`,
    }));
  }
  box.append(list);
  setSourceNote('The last import failed. Results, models, and exports are cleared until a valid CSV is applied.');
}

function markStale() {
  importRequest += 1;
  clearPresetSelection();
  $('fingerprint').hidden = true;
  $('fingerprint').textContent = '';
  $('export-error').hidden = true;
  state.stale = true;
  renderAll();
}

function updateStale() {
  $('stale-note').hidden = !state.stale;
  const blocked = state.stale || !state.samples.length;
  $('print-sheet-btn').disabled = blocked;
  $('download-csv').disabled = blocked;
  $('download-bundle').disabled = blocked;
}

/* ---------- report ---------- */

const TAP_ACTION_SHORT = {
  'do-not-use': 'do not use',
  'do-not-drink': 'do not drink',
  'co-occurrence': 'urgent',
  boil: 'boil notice',
  microbial: 'microbial',
  chemical: 'flagged',
  incomplete: 'incomplete',
  review: 'within',
};

function renderTapList() {
  const list = $('tap-list');
  list.replaceChildren();
  const empty = $('taps-empty');
  if (state.stale) {
    empty.hidden = false;
    empty.textContent = 'Tap list hidden until the edited CSV is applied.';
    return;
  }
  empty.textContent = 'No valid samples loaded.';
  empty.hidden = state.samples.length > 0;
  state.samples.forEach((sample, index) => {
    const button = el('button', { type: 'button' }, [
      el('span', { text: sample.tap }),
      el('span', { class: 'tap-status', text: TAP_ACTION_SHORT[state.screens[index].action] }),
    ]);
    if (index === state.active) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => {
      state.active = index;
      renderAll();
      list.querySelectorAll('button')[index]?.focus({ preventScroll: true });
    });
    list.append(el('li', {}, button));
  });
}

function renderAction(screen) {
  const box = $('action');
  const spec = ACTIONS[screen.action];
  box.className = `action ${spec.cls}`;
  box.replaceChildren();
  const body = el('div', {}, [
    el('h3', { text: spec.en.title }),
    el('p', { text: spec.en.body }),
  ]);
  box.append(mark(spec.icon), body);
}

const REFERENCE_TEXT = {
  lead: '10 ppb LCRI action level from November 1, 2027; 15 ppb current system action level; neither is a safe-exposure threshold',
  copper: '1300 ppb action level',
  nitrate: '10 mg/L as N MCL',
  arsenic: '10 ppb MCL',
  pfoa: '4.0 ppt MCL',
  pfos: '4.0 ppt MCL',
  pfhxs: '10 ppt MCL',
  pfna: '10 ppt MCL',
  genx: '10 ppt MCL',
  pfbs: 'No individual benchmark',
};

const SVG_GAUGE_MAX = 3;

function svgNode(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

// A benchmark gauge: the bar runs from 0 to 3x the benchmark, the tick marks 1x.
function gauge(ratio, cls) {
  const svg = svgNode('svg', {
    class: `gauge ${cls}`, viewBox: '0 0 120 10', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false',
  });
  const width = (Math.min(Math.max(ratio, 0), SVG_GAUGE_MAX) / SVG_GAUGE_MAX) * 120;
  svg.append(
    svgNode('rect', { x: 0, y: 2, width: 120, height: 6, class: 'gauge-track' }),
    svgNode('rect', { x: 0, y: 2, width: Math.max(width, ratio > 0 ? 1.2 : 0).toFixed(2), height: 6, class: 'gauge-fill' }),
    svgNode('line', { x1: 40, y1: 0, x2: 40, y2: 10, class: 'gauge-tick' }),
  );
  return svg;
}

function ratioText(ratio) {
  return `${String(Number(ratio.toPrecision(3)))}\u00d7`;
}

const WHO_WORD = { above: 'above', at: 'at', below: 'below' };

function epaReference(id) {
  return id === 'pfbs' ? 'No individual EPA benchmark' : `EPA ${REFERENCE_TEXT[id]}`;
}

function renderTable(sample, screen) {
  $('results-caption').textContent =
    `Single-sample screen for ${sample.tap}. Advisory: ${sample.advisory}. E. coli: ${sample.ecoli}.`;
  const body = $('results-body');
  body.replaceChildren();
  for (const result of screen.results) {
    const [icon, cls, word] = STATUS_UI[result.status];
    const measured = result.value === null
      ? el('span', { class: 'not-reported', text: 'not reported' })
      : el('span', {}, [
        document.createTextNode(result.value),
        el('span', { class: 'unit', text: result.unit }),
      ]);
    const finding = el('span', { class: `finding ${cls}` }, [
      mark(icon),
      el('span', { class: 'status' }, [
        document.createTextNode(word),
        result.rounded ? el('span', {
          class: 'context',
          text: `Rule rounding ${result.rounded} ${result.unit} (${result.roundedStatus})`,
        }) : null,
        result.status === 'no-limit' ? el('span', {
          class: 'context',
          text: 'Counted in the Hazard Index',
        }) : null,
      ]),
    ]);
    const who = WHO_GUIDELINES[result.id];
    const whoState = who ? whoStatus(result.id, result.value) : null;
    const reference = el('td', { 'data-label': 'Benchmark' }, [
      el('span', { class: 'ref-epa', text: epaReference(result.id) }),
      who ? el('span', { class: 'ref-who' }, [
        document.createTextNode(who.text),
        WHO_WORD[whoState] ? el('span', { class: `who-status status-${whoState}`, text: ` ${WHO_WORD[whoState]}` }) : null,
      ]) : null,
    ]);
    const ratio = benchmarkRatio(result);
    const ratioCell = el('td', { class: 'num ratio', 'data-label': 'Ratio' }, ratio === null
      ? el('span', { class: 'not-reported', text: result.status === 'no-limit' ? 'in index' : 'n/r' })
      : [el('span', { class: 'ratio-n', text: ratioText(ratio) }), gauge(ratio, cls)]);
    body.append(el('tr', { class: `row-${result.status}` }, [
      el('th', { scope: 'row' }, el('span', { class: 'chem-name', text: result.label })),
      el('td', { class: 'num', 'data-label': 'Measured' }, measured),
      reference,
      ratioCell,
      el('td', { class: 'wide', 'data-label': 'Finding' }, finding),
    ]));
  }
}

const READOUT_TONE = {
  above: ['mark-above', 'status-above', 'Above'],
  at: ['mark-at', 'status-at', 'At'],
  below: ['mark-below', 'status-below', 'Below'],
  missing: ['mark-missing', 'status-missing', 'Not reported'],
  scope: ['mark-scope', 'status-no-limit', 'Not applicable'],
};

function readoutCell(label, value, toneKey, detail, word) {
  const [icon, cls, defaultWord] = READOUT_TONE[toneKey];
  return el('div', { class: `readout-cell ${cls}` }, [
    el('p', { class: 'readout-label', text: label }),
    el('p', { class: 'readout-value' }, [
      el('span', { class: 'readout-n', text: value }),
      el('span', { class: 'readout-status' }, [mark(icon), document.createTextNode(word ?? defaultWord)]),
    ]),
    detail ? el('p', { class: 'readout-detail', text: detail }) : null,
  ]);
}

const HI_TONE = { above: 'above', 'above-lower-bound': 'above', at: 'at', below: 'below', incomplete: 'missing', 'not-applicable': 'scope' };
const ADVISORY_READOUT = { none: 'None', boil: 'Boil', 'do-not-drink': 'Do not drink', 'do-not-use': 'Do not use', unknown: 'Unknown' };

function renderReadout(view) {
  const box = $('readout');
  box.replaceChildren();
  box.hidden = !view;
  if (!view) return;
  const { sample, screen } = view;
  const rated = screen.results
    .map(result => ({ result, ratio: benchmarkRatio(result) }))
    .filter(item => item.ratio !== null);
  const top = rated.reduce((best, item) => (best === null || item.ratio > best.ratio ? item : best), null);
  box.append(top
    ? readoutCell('Highest benchmark ratio', ratioText(top.ratio), top.result.status,
      `${top.result.label} ${top.result.value} \u00f7 ${top.result.limit} ${top.result.unit}`)
    : readoutCell('Highest benchmark ratio', 'n/r', 'missing', 'No benchmarked field reported'));
  const hi = screen.mixture;
  box.append(readoutCell('PFAS Hazard Index', hi.raw ?? 'n/r', HI_TONE[hi.status],
    'Benchmark 1, sum of four ratios',
    hi.status === 'above-lower-bound' ? 'Above, partial' : hi.status === 'incomplete' ? 'Incomplete' : undefined));
  const ecoli = { present: ['above', 'Detected'], absent: ['below', 'Absent'], unknown: ['missing', 'Not reported'] }[sample.ecoli];
  box.append(readoutCell('E. coli', sample.ecoli === 'present' ? 'Present' : sample.ecoli === 'absent' ? 'Absent' : 'n/r',
    ecoli[0], 'Health goal is zero', ecoli[1]));
  const advisoryTone = sample.advisory === 'none' ? 'below' : sample.advisory === 'unknown' ? 'missing' : 'above';
  box.append(readoutCell('Reported advisory', ADVISORY_READOUT[sample.advisory] ?? sample.advisory, advisoryTone,
    null, advisoryTone === 'below' ? 'None active' : advisoryTone === 'missing' ? 'Not reported' : 'Active'));
}

const DIAG_ICON = { urgent: 'mark-above', caution: 'mark-at', info: 'mark-missing', clear: 'mark-below' };

function renderDiagnostic(view) {
  const box = $('diagnostic');
  box.replaceChildren();
  if (!view) return;
  const es = state.lang === 'es';
  const findings = diagnose({ samples: state.samples, screens: state.screens, active: state.active });
  box.append(el('h3', {
    lang: state.lang,
    text: es ? 'Fuentes probables y pasos de campo' : 'Likely sources and field steps',
  }));
  const list = el('ol', { class: 'diag-list' });
  for (const finding of findings) {
    list.append(el('li', { class: `diag diag-${finding.tone}`, 'data-diag': finding.id, lang: state.lang }, [
      mark(DIAG_ICON[finding.tone]),
      el('div', { class: 'diag-body' }, [
        el('p', { class: 'diag-title', text: es ? finding.titleEs : finding.title }),
        el('p', { class: 'diag-evidence', text: es ? finding.evidenceEs : finding.evidence }),
        el('p', { class: 'diag-action', text: es ? finding.actionEs : finding.action }),
        finding.cite ? el('p', {
          class: 'diag-cite',
          text: es ? `Fuentes comunes (${finding.cite.citeEs}): ${finding.cite.textEs}` : `Common sources (${finding.cite.cite}): ${finding.cite.text}`,
        }) : null,
      ]),
    ]));
  }
  box.append(list);
}

function renderNotes(sample, screen) {
  const notes = $('report-notes');
  notes.replaceChildren();
  const parts = [];
  if (screen.legacyLead !== 'missing') {
    parts.push(`The current federal lead action level is 15 ppb for a public system's 90th percentile; EPA LCRI uses 10 ppb beginning November 1, 2027. This reading is ${screen.legacyLead} against 15 ppb. Neither action level is a safe-exposure threshold, and there is no known safe level of lead exposure.`);
  }
  if (screen.unknowns.length) {
    parts.push(`Unreported for this tap: ${screen.unknowns.map(id => UNKNOWN_NAMES[id] ?? id).join(', ')}.`);
  }
  parts.push('Findings compare the unrounded reading with the EPA benchmark. WHO guideline values are shown for comparison; WHO sets no final guideline value for these PFAS.');
  parts.push('E. coli\'s federal health goal is zero (absence); official compliance depends on routine and repeat tests, not this reading alone.');
  parts.push('One tap, one sample: this is a screening context, never a compliance determination or a potability clearance.');
  notes.append(...parts.map(text => el('p', { class: 'notes', text })));
}

function renderReport() {
  const view = current();
  if (!view) {
    const box = $('action');
    box.className = 'action pending';
    box.replaceChildren();
    box.append(mark('mark-info'), el('div', {}, state.stale
      ? [
        el('h3', { text: 'No applied report' }),
        el('p', { text: 'The CSV text was edited after the last apply. Nothing here is current; apply the CSV to produce a report.' }),
      ]
      : [
        el('h3', { text: 'No report yet' }),
        el('p', { text: 'Apply the CSV text or a file in the sample rail, or pick a synthetic preset above. Results appear here.' }),
      ]));
    $('results-caption').textContent = state.stale ? 'Report withheld: the applied data changed.' : 'No sample loaded.';
    $('results-body').replaceChildren();
    $('report-notes').replaceChildren();
    renderReadout(null);
    renderDiagnostic(null);
    renderPrintSheet(null);
    return;
  }
  const { sample, screen } = view;
  renderAction(screen);
  renderReadout(view);
  renderTable(sample, screen);
  renderDiagnostic(view);
  renderNotes(sample, screen);
  renderPrintSheet(view);
}

function renderMobileAction(view) {
  const box = $('mobile-action');
  if (!box) return;
  box.replaceChildren();
  box.hidden = !view;
  if (!view) return;
  // Narrow screens show the selected tap's verdict before the sample rail.
  // Urgent actions keep only their first instruction; every other verdict
  // keeps its whole body so its screening caveat is never cut.
  const spec = ACTIONS[view.screen.action];
  const urgent = ['co-occurrence', 'do-not-use', 'do-not-drink'].includes(view.screen.action);
  box.className = `mobile-action tone-${spec.cls}`;
  box.append(
    mark(spec.icon),
    el('span', { class: 'mobile-action-tap', text: view.sample.tap }),
    el('strong', { text: spec.en.title }),
    el('p', { text: urgent ? `${spec.en.body.split('. ')[0]}.` : spec.en.body }),
    el('a', { href: '#report', text: 'Read the tap report' }),
  );
}

/* ---------- mixture ---------- */

function renderMixture() {
  const body = $('mixture-body');
  body.replaceChildren();
  const view = current();
  if (!view) {
    body.append(el('p', { class: 'disabled-note', text: 'Load a valid sample to see the Hazard Index.' }));
    return;
  }
  const hi = view.screen.mixture;
  const names = { pfhxs: 'PFHxS', pfna: 'PFNA', genx: 'GenX', pfbs: 'PFBS' };
  const terms = el('div', { class: 'hi-terms' });
  hi.terms.forEach((term, index) => {
    if (index > 0) terms.append(el('span', { text: '+' }));
    terms.append(el('span', { class: term.quotient === null ? 'term-missing' : '' }, [
      document.createTextNode(`${names[term.id]}/${term.denominator}`),
      document.createTextNode(term.quotient === null ? ' not reported' : ` = ${term.quotient}`),
    ]));
  });
  body.append(terms);

  const status = el('p', { class: 'hi-total' });
  const markFor = s => mark(s === 'above' || s === 'above-lower-bound' ? 'mark-above' : s === 'at' ? 'mark-at' : 'mark-below');
  if (hi.status === 'not-applicable') {
    status.append(mark('mark-scope'), document.createTextNode(' Fewer than two constituents are at or above their practical quantitation levels, so the EPA multi-constituent mixture benchmark does not apply.'));
    status.classList.add('status-neutral');
  } else if (hi.status === 'incomplete') {
    status.append(mark('mark-missing'), document.createTextNode(hi.raw === null
      ? ' No mixture measurements reported; the index is incomplete.'
      : ` Partial sum ${hi.raw}; unreported constituents keep the index incomplete.`));
    status.classList.add('status-neutral');
  } else if (hi.status === 'above-lower-bound') {
    status.append(markFor(hi.status), document.createTextNode(hi.epaMixture
      ? ` Partial sum ${hi.raw} is already above 1 for the quantified multi-constituent mixture, and constituents are still unreported.`
      : ` Partial screening sum ${hi.raw} is already above 1, but fewer than two constituents are quantified, so this is not the EPA multi-constituent mixture.`));
    status.classList.add('status-above');
  } else {
    const singleScreen = hi.status === 'above' && !hi.epaMixture;
    status.append(markFor(hi.status), document.createTextNode(singleScreen
      ? ` Screening sum ${hi.raw} is above 1. Fewer than two constituents are at or above their practical quantitation levels, so this is a single-compound screening signal, not the EPA multi-constituent mixture.`
      : ` Hazard Index ${hi.raw} is ${hi.status} the benchmark of 1.`));
    status.classList.add(`status-${hi.status}`);
    if (hi.rounded) {
      status.append(el('span', {
        class: 'context',
        text: ` Rule rounding shows ${hi.rounded} (${hi.roundedStatus}); this screen uses the unrounded sum.`,
      }));
    }
  }
  body.append(status);
  if (hi.missing.length) {
    body.append(el('p', {
      class: 'notes',
      text: `Unreported constituents: ${hi.missing.map(id => names[id]).join(', ')}.`,
    }));
  }
  body.append(el('p', {
    class: 'notes',
    text: 'The index covers PFHxS, PFNA, GenX (HFPO-DA), and PFBS. EPA\'s multi-constituent mixture applies only when at least two are at or above their practical quantitation levels; this screen still flags any exact summed index above 1 as a screening signal. PFBS alone is not an MCL.',
  }));
}

/* ---------- evaporation ---------- */

function renderEvaporation() {
  const body = $('evap-body');
  body.replaceChildren();
  const view = current();
  if (!view) {
    body.append(el('p', { class: 'disabled-note', text: 'Load a valid sample to model boil-off.' }));
    return;
  }
  const reported = CHEMICALS.filter(({ id }) => view.sample.values[id] !== null);
  if (!reported.length) {
    body.append(el('p', { class: 'disabled-note', text: 'No measurements were reported, so there is nothing to concentrate.' }));
    return;
  }
  body.append(el('p', {
    class: 'notes',
    text: 'Boiling does not remove these chemicals. If water is boiled down, what stays behind is more concentrated, modeled as C after = C before / (1 - fraction lost). This panel is illustrative.',
  }));
  const slider = el('input', {
    type: 'range', min: '0', max: '95', step: '5', value: '25',
    'aria-label': 'Percentage of water boiled off',
  });
  const readout = el('p', { class: 'model-value' });
  const table = el('table', { class: 'evap-table stack stack-3' });
  const tbody = el('tbody');
  table.append(el('thead', {}, el('tr', {}, [
    el('th', { scope: 'col', text: 'Contaminant' }),
    el('th', { scope: 'col', class: 'num', text: 'Measured' }),
    el('th', { scope: 'col', class: 'num', text: 'Modeled' }),
    el('th', { scope: 'col', text: 'Benchmark' }),
  ])), tbody);
  const update = () => {
    const percent = Number(slider.value);
    const { factor, values } = boilModel(view.sample, percent);
    readout.textContent = `Boiling off ${percent}% multiplies each concentration by ${fmt(factor, 4)}.`;
    tbody.replaceChildren();
    for (const meta of reported) {
      const modeled = values[meta.id];
      const bench = meta.limit === null ? 'no individual benchmark' : `${meta.limit} ${meta.unit}`;
      tbody.append(el('tr', {}, [
        el('td', { text: meta.label }),
        el('td', { class: 'num', 'data-label': 'Measured' }, [
          document.createTextNode(view.sample.values[meta.id]),
          el('span', { class: 'unit', text: meta.unit }),
        ]),
        el('td', { class: 'num', 'data-label': 'Modeled' }, [
          document.createTextNode(fmt(modeled, 4)),
          el('span', { class: 'unit', text: meta.unit }),
        ]),
        el('td', { 'data-label': 'Benchmark', text: bench }),
      ]));
    }
  };
  slider.addEventListener('input', update);
  body.append(el('div', { class: 'model-field' }, [
    el('label', { for: 'evap-range', text: 'Share of water boiled off' }),
  ]));
  slider.id = 'evap-range';
  body.append(slider, readout, el('div', { class: 'table-wrap' }, table));
  update();
}

/* ---------- flush ---------- */

function renderFlush() {
  const body = $('flush-body');
  body.replaceChildren();
  const view = current();
  const measured = view && view.sample.values.lead !== null ? Number(view.sample.values.lead) : null;
  if (!view || measured === null) {
    body.append(el('p', {
      class: 'disabled-note',
      text: view
        ? 'Report a lead measurement to enable this model. It estimates how first-draw lead falls as a tap runs.'
        : 'Load a valid sample to enable this model. It estimates how first-draw lead falls as a tap runs.',
    }));
    return;
  }
  body.append(el('p', {
    class: 'notes',
    text: 'Idealized exponential model: the stagnant volume mixes down as the tap runs. It is illustrative and cannot guarantee that flushing clears lead.',
  }));

  const fields = [
    ['initial', 'Initial lead (ppb)', view.sample.values.lead],
    ['background', 'Background lead (ppb)', '0'],
    ['volume', 'Stagnant volume (L)', '1'],
    ['flow', 'Flow rate (L/min)', '4'],
  ];
  const inputs = {};
  const grid = el('div', { class: 'model-grid' });
  for (const [id, label, value] of fields) {
    const input = el('input', {
      type: 'number', min: '0', step: 'any', value, id: `flush-${id}`,
      'aria-label': label,
    });
    inputs[id] = input;
    grid.append(el('div', { class: 'model-field' }, [
      el('label', { for: `flush-${id}`, text: label }),
      input,
    ]));
  }
  const slider = el('input', {
    type: 'range', min: '0', max: '10', step: '0.5', value: '0', id: 'flush-minutes',
    'aria-label': 'Minutes of flushing shown on the chart',
  });
  const readout = el('p', { class: 'model-value', 'aria-live': 'polite' });
  const chartBox = el('div');
  const errorNote = el('p', { class: 'errors-inline', hidden: true });

  const draw = () => {
    const args = {
      initial: inputs.initial.value, background: inputs.background.value,
      volumeLiters: inputs.volume.value, flowLitersPerMinute: inputs.flow.value,
      minutes: 0,
    };
    let ymax;
    try {
      flushLead({ ...args });
      const c0 = Number(args.initial);
      const bg = Number(args.background);
      ymax = Math.max(c0, bg) * 1.08;
      errorNote.hidden = true;
    } catch (error) {
      errorNote.hidden = false;
      errorNote.textContent = error.message;
      chartBox.replaceChildren();
      readout.textContent = '';
      return;
    }
    if (ymax <= 0) ymax = 1;
    const showLimit = ymax >= 8;
    const minutes = Number(slider.value);
    const at = flushLead({ ...args, minutes });
    chartBox.replaceChildren(buildFlushChart(args, ymax, showLimit, minutes));
    readout.textContent = `Modeled at ${fmt(minutes, 3)} min: ${fmt(at, 4)} ppb lead.`;
  };
  for (const input of Object.values(inputs)) input.addEventListener('input', draw);
  slider.addEventListener('input', draw);
  body.append(grid, el('div', { class: 'model-field' }, [
    el('label', { for: 'flush-minutes', text: 'Minutes of flushing' }),
  ]), slider, readout, chartBox, errorNote);
  draw();
}

function buildFlushChart(args, ymax, showLimit, minutes) {
  const W = 560; const H = 250; const ML = 46; const MR = 14; const MT = 12; const MB = 34;
  const plotW = W - ML - MR; const plotH = H - MT - MB;
  const scale = 10 ** Math.floor(Math.log10(ymax / 5));
  const step = ([1, 2, 5, 10].find(candidate => candidate * scale >= ymax / 5) ?? 10) * scale;
  const x = t => ML + (t / 10) * plotW;
  const y = v => MT + plotH - (v / ymax) * plotH;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'flush-chart');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label',
    `Modeled lead concentration falling from ${args.initial} ppb toward ${args.background} ppb over ten minutes of flushing.`);
  const line = (x1, y1, x2, y2, cls) => {
    const l = document.createElementNS(SVG_NS, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('class', cls);
    return l;
  };
  const text = (tx, ty, content, anchor = 'middle') => {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', tx); t.setAttribute('y', ty);
    t.setAttribute('text-anchor', anchor);
    t.textContent = content;
    return t;
  };
  for (let tick = 0; tick <= 6; tick += 1) {
    const v = tick * step;
    if (v > ymax) break;
    svg.append(line(ML, y(v), W - MR, y(v), 'grid-line'));
    svg.append(text(ML - 6, y(v) + 3, fmt(v, 4), 'end'));
  }
  for (let t = 0; t <= 10; t += 2) {
    svg.append(line(x(t), MT, x(t), MT + plotH, 'grid-line'));
    svg.append(text(x(t), H - 18, String(t)));
  }
  svg.append(line(ML, MT + plotH, W - MR, MT + plotH, 'axis'));
  svg.append(line(ML, MT, ML, MT + plotH, 'axis'));
  svg.append(text(ML + plotW / 2, H - 4, 'minutes of flushing'));
  const yLabel = text(12, MT + plotH / 2, 'lead (ppb)');
  yLabel.setAttribute('transform', `rotate(-90 12 ${MT + plotH / 2})`);
  svg.append(yLabel);
  if (showLimit && y(10) >= MT) {
    svg.append(line(ML, y(10), W - MR, y(10), 'limit-line'));
    svg.append(text(W - MR - 4, y(10) - 4, '10 ppb', 'end'));
  }
  const points = [];
  for (let i = 0; i <= 50; i += 1) {
    const t = i / 5;
    points.push(`${x(t).toFixed(2)},${y(flushLead({ ...args, minutes: t })).toFixed(2)}`);
  }
  const poly = document.createElementNS(SVG_NS, 'polyline');
  poly.setAttribute('points', points.join(' '));
  poly.setAttribute('class', 'curve');
  svg.append(poly);
  const cy = y(flushLead({ ...args, minutes }));
  svg.append(line(x(minutes), MT, x(minutes), MT + plotH, 'cursor-line'));
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', x(minutes)); dot.setAttribute('cy', cy);
  dot.setAttribute('r', 4); dot.setAttribute('class', 'cursor-dot');
  svg.append(dot);
  return svg;
}

/* ---------- treatment ---------- */

function renderTreatment() {
  const body = $('treatment-body');
  body.replaceChildren();
  const view = current();
  if (!view) {
    body.append(el('p', { class: 'disabled-note', text: 'Load a valid sample to compare filter scenarios.' }));
    return;
  }
  body.append(el('p', {
    class: 'notes',
    text: 'Illustrative planning numbers, not certification. Removal fractions below are scenario assumptions; check a product\'s certification for the specific contaminant.',
  }));
  const fields = [
    ['use', 'Drinking liters per day', '2'],
    ['bottled', 'Bottled water $/L', '1.50'],
    ['tap', 'Tap water $/L', '0.005'],
  ];
  const inputs = {};
  const grid = el('div', { class: 'model-grid' });
  for (const [id, label, value] of fields) {
    const input = el('input', {
      type: 'number', min: '0', step: 'any', value, id: `treat-${id}`,
      'aria-label': label,
    });
    inputs[id] = input;
    grid.append(el('div', { class: 'model-field' }, [
      el('label', { for: `treat-${id}`, text: label }),
      input,
    ]));
  }
  const out = el('div');
  const errorNote = el('p', { class: 'errors-inline', hidden: true });
  const units = Object.fromEntries(CHEMICALS.map(({ id, unit }) => [id, unit]));

  const draw = () => {
    out.replaceChildren();
    let result;
    try {
      result = compareTreatment(view.sample, {
        litersPerDay: inputs.use.value,
        bottledPerLiter: inputs.bottled.value,
        waterPerLiter: inputs.tap.value,
      });
      errorNote.hidden = true;
    } catch (error) {
      errorNote.hidden = false;
      errorNote.textContent = error.message;
      return;
    }
    out.append(el('p', {
      class: 'model-value',
      text: `Bottled drinking water at ${inputs.use.value} L/day costs about ${money(result.annualBottled)} per year.`,
    }));
    const table = el('table', { class: 'treat-table stack stack-3' });
    const tbody = el('tbody');
    table.append(el('thead', {}, el('tr', {}, [
      el('th', { scope: 'col', text: 'Scenario' }),
      el('th', { scope: 'col', class: 'num', text: 'Upfront' }),
      el('th', { scope: 'col', class: 'num', text: 'Operating / yr' }),
      el('th', { scope: 'col', class: 'num', text: 'First year' }),
      el('th', { scope: 'col', text: 'Crossover' }),
      el('th', { scope: 'col', text: 'Modeled reductions' }),
    ])), tbody);
    for (const filter of result.filters) {
      const modeled = Object.keys(filter.removal)
        .filter(id => filter.values[id] !== null)
        .map(id => `${LABELS[id]} ${fmt(view.sample.values[id], 4)} to ${fmt(filter.values[id], 4)} ${units[id] ?? ''} (${Math.round(filter.removal[id] * 100)}% assumed)`);
      tbody.append(el('tr', {}, [
        el('td', { text: filter.label }),
        el('td', { class: 'num', 'data-label': 'Upfront', text: money(filter.upfront) }),
        el('td', { class: 'num', 'data-label': 'Operating / yr', text: money(filter.annualOperating) }),
        el('td', { class: 'num', 'data-label': 'First year', text: money(filter.annualFirstYear) }),
        el('td', { class: 'wide', 'data-label': 'Crossover', text: filter.paybackMonth === null ? 'never at these prices' : `month ${filter.paybackMonth}` }),
        el('td', { class: 'wide', 'data-label': 'Modeled reductions', text: modeled.length ? modeled.join('; ') : 'No reported readings covered by this scenario' }),
      ]));
    }
    out.append(el('div', { class: 'table-wrap' }, table), el('ul', { class: 'plain notes' }, [
      el('li', { text: 'No microbial improvement is modeled, and during an active advisory official instructions come first; a household filter is not an advisory fix.' }),
      el('li', { text: 'PFAS reduction applies only where the product\'s own certification test verifies it; a standard name alone does not guarantee these removals.' }),
      el('li', { text: 'For arsenic, the reverse-osmosis figure assumes the pentavalent (arsenate, As(V)) form; coverage is not implied where unverified.' }),
    ]));
  };
  for (const input of Object.values(inputs)) input.addEventListener('input', draw);
  body.append(grid, out, errorNote);
  draw();
}

/* ---------- exports ---------- */

function download(name, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportBundle() {
  const errorBox = $('export-error');
  errorBox.hidden = true;
  errorBox.textContent = '';
  if (state.stale || !state.samples.length) return;
  const request = importRequest;
  try {
    const bundle = await buildBundle(state.samples, {
      source: state.synthetic ? 'synthetic' : 'unverified-input',
    });
    if (request !== importRequest || state.stale) return;
    const fp = $('fingerprint');
    fp.hidden = false;
    fp.textContent = `SHA-256 of the canonical payload: ${bundle.fingerprint}`;
    download('waterwatch-bundle.json', 'application/json', JSON.stringify(bundle, null, 2));
  } catch (error) {
    if (request !== importRequest || state.stale) return;
    errorBox.hidden = false;
    errorBox.textContent = error.message;
  }
}

function exportCsv() {
  const errorBox = $('export-error');
  errorBox.hidden = true;
  errorBox.textContent = '';
  if (state.stale || !state.samples.length) return;
  try {
    download('waterwatch-audit.csv', 'text/csv', auditCsv(state.samples, {
      source: state.synthetic ? 'synthetic' : 'unverified-input',
    }));
  } catch (error) {
    errorBox.hidden = false;
    errorBox.textContent = error.message;
  }
}

/* ---------- sources ---------- */

function renderSources() {
  const list = $('source-list');
  list.replaceChildren();
  for (const [title, url] of SOURCES) {
    list.append(el('li', {}, el('a', {
      href: url, target: '_blank', rel: 'noopener noreferrer', class: 'src-title', text: title,
    })));
  }
}

/* ---------- print sheet ---------- */

function actionText(action) {
  return ACTIONS[action] ?? ACTIONS.review;
}

const ADVISORY_BI = {
  none: 'none / ninguno', boil: 'boil / hervir', 'do-not-drink': 'do-not-drink / no beber',
  'do-not-use': 'do-not-use / no usar', unknown: 'unknown / desconocido',
};
const ECOLI_BI = { present: 'present / presente', absent: 'absent / ausente', unknown: 'unknown / desconocido' };
const UNKNOWN_BI = { advisory: 'advisory / aviso', ecoli: 'E. coli / E. coli' };

const STATUS_BI = {
  above: 'above / por encima del nivel', at: 'at / en el nivel', below: 'below / por debajo del nivel',
  missing: 'not reported / sin reportar', 'no-limit': 'screening input only / solo entrada de evaluación',
};
const CHEM_ES = {
  lead: 'Plomo', copper: 'Cobre', nitrate: 'Nitrato', arsenic: 'Arsénico',
  pfoa: 'PFOA', pfos: 'PFOS', pfhxs: 'PFHxS', pfna: 'PFNA', genx: 'GenX', pfbs: 'PFBS',
};
const UNKNOWN_NAMES_ES = { ...CHEM_ES, advisory: 'aviso', ecoli: 'estado de E. coli' };
const REFERENCE_TEXT_ES = {
  lead: 'Nivel de acción LCRI de 10 ppb desde el 1 de noviembre de 2027; nivel actual del sistema de 15 ppb; ninguno es un umbral de exposición segura',
  copper: 'Nivel de acción de 1300 ppb',
  nitrate: 'MCL de 10 mg/L como N',
  arsenic: 'MCL de 10 ppb',
  pfoa: 'MCL de 4.0 ppt',
  pfos: 'MCL de 4.0 ppt',
  pfhxs: 'MCL de 10 ppt',
  pfna: 'MCL de 10 ppt',
  genx: 'MCL de 10 ppt',
  pfbs: 'Sin nivel individual',
};
const WHO_WORD_ES = { above: 'por encima', at: 'en el nivel', below: 'por debajo' };
const HI_STATUS_BI = {
  above: 'above / por encima', at: 'at / en el nivel', below: 'below / por debajo',
  'above-lower-bound': 'above, lower bound / por encima, cota inferior',
  incomplete: 'incomplete / incompleto', 'not-applicable': 'not applicable / no aplica',
};
function biSpans(en, es) {
  return [el('span', { lang: 'en', text: en }), document.createTextNode(' / '), el('span', { lang: 'es', text: es })];
}
function biHeading(tag, en, es) {
  return el(tag, {}, biSpans(en, es));
}

function fieldLine(label) {
  return el('div', { class: 'ps-field' }, [el('span', { text: label }), el('span', { class: 'ps-blank' })]);
}

function checkLine(label) {
  return el('li', {}, [el('span', { class: 'ps-box', 'aria-hidden': 'true' }), document.createTextNode(label)]);
}

function renderPrintSheet(view) {
  const sheet = $('print-sheet');
  sheet.replaceChildren();
  if (!view) {
    sheet.append(
      el('h1', { text: 'WaterWatch' }),
      el('p', { text: 'No applied tap report to print.' }),
    );
    return;
  }
  const { sample, screen } = view;
  const spec = actionText(screen.action);
  const findings = diagnose({ samples: state.samples, screens: state.screens, active: state.active });
  const unknownText = screen.unknowns.map(id => {
    const en = UNKNOWN_NAMES[id] ?? id;
    const es = UNKNOWN_NAMES_ES[id] ?? id;
    return `${en} / ${es}`;
  }).join(', ');

  sheet.append(
    el('header', { class: 'ps-head' }, [
      biHeading('h1', 'Community Water Field Audit Sheet', 'Hoja comunitaria de auditoría del agua'),
      el('p', { class: 'ps-brand', text: 'WaterWatch' }),
    ]),
    el('p', { class: 'ps-tap', text: `Tap / Grifo: ${sample.tap}` }),
    el('p', {
      text: `Advisory / Aviso: ${ADVISORY_BI[sample.advisory] ?? sample.advisory}   |   E. coli: ${ECOLI_BI[sample.ecoli] ?? sample.ecoli}   |   Screened / Evaluado: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    }),
    el('p', {
      class: 'ps-origin',
      text: `${state.synthetic
        ? 'Synthetic example / Ejemplo sintético'
        : 'CSV values entered by user / Datos ingresados por el usuario'}${screen.unknowns.length
        ? `   |   Unreported / Sin reportar: ${unknownText}`
        : ''}`,
    }),
  );
  sheet.append(el('div', { class: 'ps-cols' }, [
    el('div', { class: 'ps-lang', lang: 'en' }, [
      el('h2', { text: 'What to do' }),
      el('p', { class: 'ps-headline', text: spec.en.title }),
      el('p', { text: spec.en.body }),
    ]),
    el('div', { class: 'ps-lang', lang: 'es' }, [
      el('h2', { text: 'Qué hacer' }),
      el('p', { class: 'ps-headline', text: spec.es.title }),
      el('p', { text: spec.es.body }),
    ]),
  ]));

  const table = el('table', { class: 'ps-table' });
  const tbody = el('tbody');
  table.append(el('thead', {}, el('tr', {}, [
    el('th', { scope: 'col', text: 'Contaminant / Contaminante' }),
    el('th', { scope: 'col', class: 'num', text: 'Measured / Medido' }),
    el('th', { scope: 'col', text: 'EPA benchmark / Referencia EPA' }),
    el('th', { scope: 'col', class: 'num', text: 'Ratio' }),
    el('th', { scope: 'col', text: 'Status / Estado' }),
    el('th', { scope: 'col', text: 'WHO / OMS' }),
  ])), tbody);
  for (const r of screen.results) {
    const ratio = benchmarkRatio(r);
    const who = WHO_GUIDELINES[r.id];
    const whoState = who ? whoStatus(r.id, r.value) : null;
    const epaText = r.id === 'pfbs'
      ? 'none (index only) / sin nivel individual (solo índice)'
      : `${REFERENCE_TEXT[r.id]} / ${REFERENCE_TEXT_ES[r.id]}`;
    const whoText = who
      ? `${who.text} / ${who.textEs}${WHO_WORD[whoState] ? `, ${WHO_WORD[whoState]} / ${WHO_WORD_ES[whoState]}` : ''}`
      : 'no value / sin valor';
    tbody.append(el('tr', { class: ['above', 'at'].includes(r.status) ? 'ps-flag' : '' }, [
      el('td', { text: `${r.label} / ${CHEM_ES[r.id]}` }),
      el('td', { class: 'num', text: r.value === null ? 'n/r' : `${r.value} ${r.unit}` }),
      el('td', { text: epaText }),
      el('td', { class: 'num', text: ratio === null ? '' : ratioText(ratio) }),
      el('td', { text: STATUS_BI[r.status] ?? r.status }),
      el('td', { text: whoText }),
    ]));
  }
  const hi = screen.mixture;
  const names = { pfhxs: 'PFHxS', pfna: 'PFNA', genx: 'GenX', pfbs: 'PFBS' };
  const hiKind = hi.epaMixture
    ? 'multi-constituent mixture / mezcla multiconstituyente'
    : 'screening sum / suma de evaluación';
  const hiPartial = hi.partial ? '; partial lower bound / cota inferior parcial' : '';
  sheet.append(biHeading('h2', 'Readings', 'Lecturas'), table, el('p', {
    class: 'ps-math',
    text: `PFAS Hazard Index / Índice de Peligro de PFAS = ${hi.terms.map(term => `${names[term.id]}/${term.denominator}`).join(' + ')} = ${hi.terms.map(term => term.quotient ?? 'n/r').join(' + ')} = ${hi.raw ?? 'n/r'} (${HI_STATUS_BI[hi.status] ?? hi.status}; ${hiKind}${hiPartial}; benchmark 1 / nivel 1)`,
  }));

  sheet.append(el('section', { class: 'ps-diagnostic-section' }, [
    biHeading('h2', 'Likely sources and field steps', 'Fuentes probables y pasos de campo'),
    el('ol', { class: 'ps-diag' }, findings.slice(0, 3).map(finding => el('li', {}, [
      el('div', { class: 'ps-diag-lang', lang: 'en' }, [
        el('strong', { text: `${finding.title}. ` }),
        document.createTextNode(`${finding.evidence} ${finding.action}`),
        finding.cite ? el('em', { text: ` Common sources (${finding.cite.cite}): ${finding.cite.text}` }) : null,
      ]),
      el('div', { class: 'ps-diag-lang', lang: 'es' }, [
        el('strong', { text: `${finding.titleEs}. ` }),
        document.createTextNode(`${finding.evidenceEs} ${finding.actionEs}`),
        finding.cite ? el('em', { text: ` Fuentes comunes (${finding.cite.citeEs}): ${finding.cite.textEs}` }) : null,
      ]),
    ]))),
    findings.length > 3 ? el('p', {
      text: `${findings.length - 3} more pattern${findings.length - 3 === 1 ? '' : 's'} in the app / ${findings.length - 3} patrón${findings.length - 3 === 1 ? '' : 'es'} más en la aplicación.`,
    }) : null,
  ]));

  sheet.append(el('div', { class: 'ps-split ps-record-split' }, [
    el('div', {}, [
      biHeading('h2', 'Field record', 'Registro de campo'),
      fieldLine('Collected by / Recogido por'),
      fieldLine('Date and time / Fecha y hora'),
      fieldLine('Hours water sat unused / Horas sin uso'),
      fieldLine('Lab and sample ID / Laboratorio e ID'),
      el('ul', { class: 'ps-checks ps-inline' }, [
        checkLine('First draw / Primera extracción'),
        checkLine('Flushed / Purga'),
      ]),
    ]),
    el('div', {}, [
      biHeading('h2', 'Follow-up', 'Seguimiento'),
      el('ul', { class: 'ps-checks' }, [
        checkLine('Shared with the water system / Compartido con el sistema de agua'),
        checkLine('Shared with the health department / Compartido con salud pública'),
        checkLine('Notice posted for residents / Aviso publicado para residentes'),
        checkLine('Resample date / Fecha de nuevo muestreo'),
      ]),
    ]),
  ]));
  sheet.append(el('p', {
    class: 'ps-meta',
    lang: 'en',
    text: 'WaterWatch screens one tap sample against EPA reference levels, with WHO guideline values for comparison. It is not a compliance determination or a potability clearance, and likely sources are screening hints, not proof. The current federal lead action level is 15 ppb; EPA LCRI uses 10 ppb beginning November 1, 2027. Neither is a safe-exposure threshold. Sources: EPA PFAS rule (2024), EPA LCRI, EPA drinking water regulations table, 40 CFR 141.63, CDC drinking-water advisories, WHO drinking-water guidelines (2026). Generated offline; nothing was sent anywhere.',
  }));
  sheet.append(el('p', {
    class: 'ps-meta',
    lang: 'es',
    text: 'WaterWatch evalúa una sola muestra de grifo contra niveles de referencia de la EPA, con valores guía de la OMS para comparar. No es una determinación de cumplimiento ni una autorización de potabilidad, y las fuentes probables son indicios, no pruebas. El nivel de acción federal actual del plomo es 15 ppb; la LCRI de la EPA usa 10 ppb desde el 1 de noviembre de 2027. Ninguno es un umbral de exposición segura. Generado sin conexión; nada se envió a ninguna parte.',
  }));
}

/* ---------- wiring ---------- */

function renderAll() {
  renderTapList();
  renderReport();
  renderMobileAction(current());
  renderMixture();
  renderEvaporation();
  renderFlush();
  renderTreatment();
  updateStale();
  labController?.refresh();
}

function setupLab() {
  const section = $('lab');
  const body = $('lab-body');
  if (!section || !body) return;
  import('./mixture-lab.js').then(lab => {
    labController = lab.mountLab(body, {
      getImported: () => (state.stale || state.synthetic || !state.samples.length ? null : {
        origin: 'unverified-input',
        samples: state.samples,
      }),
      onLanguage: lang => {
        state.lang = lang;
        renderDiagnostic(current());
        renderPrintSheet(current());
      },
    });
    section.hidden = false;
    labController.refresh();
  }).catch(() => {});
}

function init() {
  renderPresets();
  renderSources();
  setupLab();

  $('csv-input').addEventListener('input', markStale);
  $('apply').addEventListener('click', () => {
    const text = $('csv-input').value;
    const preset = PRESETS.find(item => item.csv === text);
    applyText(text, preset
      ? `${preset.title} preset. ${preset.description} Synthetic data, not measurements from a real system.`
      : 'CSV pasted into the editor.', Boolean(preset));
    if (preset) $('preset-strip').children[PRESETS.indexOf(preset)]?.setAttribute('aria-pressed', 'true');
  });
  $('file-input').addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) {
      importRequest += 1;
      clearReport([{ row: 1, field: null, message: `The file "${file.name}" is larger than the 1 MB limit.` }]);
      return;
    }
    markStale();
    const request = ++importRequest;
    try {
      const buffer = await file.arrayBuffer();
      if (request !== importRequest) return;
      const text = decodeUpload(buffer);
      $('csv-input').value = text;
      applyText(text, `Uploaded file ${file.name}.`);
    } catch (error) {
      if (request !== importRequest) return;
      clearReport(error.errors ?? [{ row: 1, field: null, message: error.message }]);
    }
  });
  $('shortcut-toggle').addEventListener('change', event => {
    state.shortcuts = event.target.checked;
  });
  document.addEventListener('keydown', event => {
    const action = shortcutAction(event, state.shortcuts);
    if (!action) return;
    event.preventDefault();
    if (action === 'import') $('file-input').click();
    else if (!$('print-sheet-btn').disabled) window.print();
  });
  $('print-sheet-btn').addEventListener('click', () => window.print());
  window.addEventListener('beforeprint', () => renderPrintSheet(current()));
  $('download-csv').addEventListener('click', exportCsv);
  $('download-bundle').addEventListener('click', exportBundle);

  const school = PRESETS.find(p => p.id === 'school') ?? PRESETS[0];
  $('csv-input').value = school.csv;
  applyText(school.csv, `${school.title} preset. ${school.description} Synthetic data, not measurements from a real system.`, true);
  const strip = $('preset-strip');
  const schoolButton = [...strip.querySelectorAll('button')][PRESETS.indexOf(school)];
  schoolButton?.setAttribute('aria-pressed', 'true');
}

init();
