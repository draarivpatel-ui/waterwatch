// UN SDG 6 clean-water equity and community intervention lab. Deterministic
// teaching estimates built on the same screening engine as the tap report:
// an indicator engine for SDG 6.1 (service ladder and the boiling or
// filtration gap), SDG 6.3 (measured exceedance profile), and SDG 6.4
// (illustrative water-stress index), plus a planner that compares five
// low-cost interventions on cost per person-year of safe water, modeled
// contaminant fit, and people reached for a grant budget. Nothing here is
// JMP service data, an engineering design, or a compliance determination.

import { normalizeSample, screenSample } from './engine.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const has = (obj, key) => Object.hasOwn(obj, key);

/* ---------- intervention catalog ---------- */

export const REMOVAL_CLASSES = Object.freeze([
  'bacteria', 'protozoa', 'virus', 'turbidity', 'lead', 'copper', 'arsenic', 'nitrate', 'pfas',
]);

// Removal claims are tri-state teaching figures: yes, partial, or no. They
// reflect published performance ranges, not product certifications.
export const INTERVENTIONS = Object.freeze([
  Object.freeze({
    id: 'ceramic-pot', upfront: 30, annual: 5, people: 5, years: 3,
    removal: Object.freeze({
      bacteria: 'yes', protozoa: 'yes', virus: 'no', turbidity: 'yes',
      lead: 'no', copper: 'no', arsenic: 'no', nitrate: 'no', pfas: 'no',
    }),
  }),
  Object.freeze({
    id: 'biosand', upfront: 40, annual: 2, people: 8, years: 10,
    removal: Object.freeze({
      bacteria: 'yes', protozoa: 'yes', virus: 'partial', turbidity: 'yes',
      lead: 'no', copper: 'no', arsenic: 'partial', nitrate: 'no', pfas: 'no',
    }),
  }),
  Object.freeze({
    id: 'sodis', upfront: 2, annual: 2, people: 3, years: 1,
    removal: Object.freeze({
      bacteria: 'yes', protozoa: 'yes', virus: 'yes', turbidity: 'no',
      lead: 'no', copper: 'no', arsenic: 'no', nitrate: 'no', pfas: 'no',
    }),
  }),
  Object.freeze({
    id: 'borehole-repair', upfront: 400, annual: 30, people: 300, years: 5,
    removal: Object.freeze({
      bacteria: 'yes', protozoa: 'yes', virus: 'yes', turbidity: 'no',
      lead: 'no', copper: 'no', arsenic: 'no', nitrate: 'no', pfas: 'no',
    }),
  }),
  Object.freeze({
    id: 'pou-ro-gac', upfront: 120, annual: 60, people: 5, years: 3,
    removal: Object.freeze({
      bacteria: 'yes', protozoa: 'yes', virus: 'yes', turbidity: 'partial',
      lead: 'yes', copper: 'yes', arsenic: 'yes', nitrate: 'yes', pfas: 'yes',
    }),
  }),
]);

const INTERVENTION_IDS = new Set(INTERVENTIONS.map(({ id }) => id));

/* ---------- state vocabulary ---------- */

export const SDG6_SOURCES = Object.freeze(['piped', 'improved-30', 'improved-far', 'unimproved', 'surface']);
export const SDG6_AVAILABILITY = Object.freeze(['reliable', 'interrupted', 'unknown']);
export const SDG6_STRESS = Object.freeze(['low', 'low-medium', 'medium-high', 'high', 'extreme']);
export const SDG6_BUDGET_RANGE = Object.freeze({ min: 35, max: 10000 });
export const SDG6_PEOPLE_RANGE = Object.freeze({ min: 1, max: 50000 });
export const SDG6_STATE_KEYS = new Set(['source', 'availability', 'stress', 'budget', 'people', 'focus']);
export const SDG6_DEFAULT_STATE = Object.freeze({
  source: 'improved-30', availability: 'reliable', stress: 'medium-high',
  budget: 500, people: 300, focus: null,
});

export function normalizeSdg6State(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const state = { ...SDG6_DEFAULT_STATE };
  for (const key of Object.keys(input)) {
    if (!SDG6_STATE_KEYS.has(key)) return null;
  }
  if (has(input, 'source')) {
    if (typeof input.source !== 'string' || !SDG6_SOURCES.includes(input.source)) return null;
    state.source = input.source;
  }
  if (has(input, 'availability')) {
    if (typeof input.availability !== 'string' || !SDG6_AVAILABILITY.includes(input.availability)) return null;
    state.availability = input.availability;
  }
  if (has(input, 'stress')) {
    if (typeof input.stress !== 'string' || !SDG6_STRESS.includes(input.stress)) return null;
    state.stress = input.stress;
  }
  if (has(input, 'budget')) {
    if (typeof input.budget !== 'number' || !Number.isFinite(input.budget)
      || input.budget < SDG6_BUDGET_RANGE.min || input.budget > SDG6_BUDGET_RANGE.max) return null;
    state.budget = input.budget;
  }
  if (has(input, 'people')) {
    if (typeof input.people !== 'number' || !Number.isInteger(input.people)
      || input.people < SDG6_PEOPLE_RANGE.min || input.people > SDG6_PEOPLE_RANGE.max) return null;
    state.people = input.people;
  }
  if (has(input, 'focus')) {
    if (input.focus !== null && (typeof input.focus !== 'string' || !INTERVENTION_IDS.has(input.focus))) return null;
    state.focus = input.focus;
  }
  return state;
}

/* ---------- screening context ---------- */

export function screenContext(sample) {
  const normalized = normalizeSample(sample);
  return {
    tap: normalized.tap,
    advisory: normalized.advisory,
    ecoli: normalized.ecoli,
    values: normalized.values,
    screen: screenSample(normalized),
  };
}

function contaminationFree(ctx) {
  const chemical = ctx.screen.results.some(result => result.status === 'above')
    || ['above', 'above-lower-bound'].includes(ctx.screen.mixture.status);
  if (chemical || ctx.ecoli === 'present'
    || ['boil', 'do-not-drink', 'do-not-use'].includes(ctx.advisory)) return 'contaminated';
  if (ctx.ecoli === 'unknown' || ctx.advisory === 'unknown'
    || ctx.screen.results.some(result => result.status === 'missing')) return 'unknown';
  return 'free';
}

const NEED_FOR = {
  lead: 'lead', copper: 'copper', arsenic: 'arsenic', nitrate: 'nitrate',
  pfoa: 'pfas', pfos: 'pfas', pfhxs: 'pfas', pfna: 'pfas', genx: 'pfas',
};

export function sdg6Needs(ctx) {
  if (!ctx) return [];
  const needs = new Set();
  if (ctx.ecoli === 'present' || ctx.advisory === 'boil') needs.add('bacteria');
  for (const result of ctx.screen.results) {
    if (result.status === 'above' && has(NEED_FOR, result.id)) needs.add(NEED_FOR[result.id]);
  }
  if (['above', 'above-lower-bound'].includes(ctx.screen.mixture.status)) needs.add('pfas');
  return [...needs];
}

export function advisoryWithholds(ctx) {
  return Boolean(ctx) && (['boil', 'do-not-drink', 'do-not-use'].includes(ctx.advisory)
    || ctx.ecoli === 'present');
}

/* ---------- SDG 6.1 service ladder ---------- */

const LADDER = new Set(['safely-managed', 'basic', 'limited', 'unimproved', 'surface-water']);
export const SDG6_LEVELS = Object.freeze([...LADDER]);

export function indicator61(state, ctx) {
  const free = contaminationFree(ctx);
  let level;
  if (state.source === 'surface') level = 'surface-water';
  else if (state.source === 'unimproved') level = 'unimproved';
  else if (state.source === 'improved-far') level = 'limited';
  else if (state.source === 'piped' && state.availability === 'reliable' && free === 'free') {
    level = 'safely-managed';
  } else level = 'basic';
  const gap = [];
  if (level !== 'safely-managed') {
    if (free === 'contaminated') gap.push('quality');
    else if (free === 'unknown') gap.push('quality-unverified');
    if (state.source !== 'piped') gap.push('access');
    if (state.availability !== 'reliable') gap.push('availability');
  }
  const needs = sdg6Needs(ctx);
  return { level, free, gap, needs, needsTreatment: free !== 'free' && needs.length > 0 };
}

/* ---------- SDG 6.3 exceedance profile ---------- */

export function indicator63(ctx) {
  const exceedances = ctx.screen.results
    .filter(result => result.status === 'above')
    .map(result => ({
      id: result.id, value: result.value, limit: result.limit,
      ratio: Number(result.value) / Number(result.limit),
    }));
  if (['above', 'above-lower-bound'].includes(ctx.screen.mixture.status)) {
    exceedances.push({
      id: 'hazard-index', value: ctx.screen.mixture.raw, limit: '1',
      ratio: Number(ctx.screen.mixture.raw),
    });
  }
  const worst = exceedances.reduce((top, entry) => (top === null || entry.ratio > top.ratio ? entry : top), null);
  const severe = ctx.ecoli === 'present' || ['do-not-drink', 'do-not-use'].includes(ctx.advisory)
    || ctx.screen.action === 'co-occurrence' || exceedances.some(entry => entry.ratio >= 10);
  const band = severe ? 'severe'
    : exceedances.length >= 2 ? 'multiple'
    : exceedances.length === 1 ? 'single' : 'none';
  return {
    band,
    count: exceedances.length,
    exceedances,
    worst,
    hazardIndex: { raw: ctx.screen.mixture.raw, status: ctx.screen.mixture.status },
    microbial: ctx.ecoli === 'present' || ctx.advisory === 'boil',
  };
}

/* ---------- SDG 6.4 water-stress index ---------- */

const STRESS_BASE = Object.freeze({ low: 5, 'low-medium': 15, 'medium-high': 30, high: 60, extreme: 90 });

export function indicator64(state) {
  const adjust = state.availability === 'interrupted' ? 10
    : state.availability === 'unknown' ? 5 : 0;
  const index = Math.min(100, STRESS_BASE[state.stress] + adjust);
  const band = index >= 80 ? 'extreme'
    : index >= 40 ? 'high'
    : index >= 20 ? 'medium-high'
    : index >= 10 ? 'low-medium' : 'low';
  return { index, band, base: STRESS_BASE[state.stress], reliabilityAdjust: adjust };
}

/* ---------- community intervention planner ---------- */

function contaminantFit(needs, removal, blocked) {
  if (blocked) return 'withheld';
  if (needs.length === 0) return 'no-need';
  if (needs.every(need => removal[need] === 'yes')) return 'yes';
  if (needs.some(need => removal[need] === 'no')) return 'no';
  return 'partial';
}

export function planInterventions(state, ctx) {
  const blocked = advisoryWithholds(ctx);
  const needs = sdg6Needs(ctx);
  const rows = INTERVENTIONS.map(item => {
    const firstYearCost = item.upfront + item.annual;
    const units = Math.floor(state.budget / firstYearCost);
    const peopleReached = Math.min(units * item.people, state.people);
    const personYears = peopleReached * item.years;
    const spent = units * firstYearCost;
    return {
      id: item.id,
      units,
      peopleReached,
      personYears,
      spent,
      leftover: state.budget - spent,
      firstYearCost,
      costPerPersonYear: (item.upfront + item.annual * item.years) / (item.people * item.years),
      fit: contaminantFit(needs, item.removal, blocked),
    };
  });
  const byReach = list => list.reduce((best, row) => (
    best === null || row.personYears > best.personYears
      || (row.personYears === best.personYears && row.costPerPersonYear < best.costPerPersonYear)
      ? row : best), null);
  let pick = null;
  let pickKind = null;
  for (const [kind, fit] of [['fit', 'yes'], ['partial', 'partial'], ['economics', null]]) {
    const pool = fit === null ? rows : rows.filter(row => row.fit === fit);
    pick = byReach(pool.filter(row => row.personYears > 0));
    if (pick) { pickKind = kind; break; }
  }
  return {
    budget: state.budget,
    people: state.people,
    needs,
    blocked,
    rows,
    recommended: pick ? { id: pick.id, kind: pickKind, peopleReached: pick.peopleReached, personYears: pick.personYears } : null,
    uncovered: pick ? Math.max(0, state.people - pick.peopleReached) : state.people,
  };
}

/* ---------- auditable payload ---------- */

export function sdg6Payload({ state, sample }) {
  const normalized = normalizeSdg6State(state);
  if (!normalized) throw new RangeError('SDG 6 state is not exportable.');
  const ctx = screenContext(sample);
  return {
    schema: 'waterwatch-sdg6/v1',
    scope: 'Illustrative planning estimates. Not JMP service data, engineering designs, or compliance determinations.',
    state: normalized,
    indicators: {
      'sdg-6-1': indicator61(normalized, ctx),
      'sdg-6-3': indicator63(ctx),
      'sdg-6-4': indicator64(normalized),
    },
    plan: planInterventions(normalized, ctx),
  };
}

/* ---------- localized strings ---------- */

export const SDG6_STRINGS = {
  en: {
    title: 'SDG 6 clean-water equity lab',
    sourceLine: label => `Service context analyzed for ${label}.`,
    indicatorTitle: 'SDG 6 indicator engine',
    indicatorNote: 'Deterministic teaching estimates built on the same screening engine as the tap report. They are not JMP service data, engineering designs, or compliance determinations.',
    noSource: 'Pick a synthetic preset or apply a CSV in the lab above to activate the indicators and the contaminant fit check.',
    card61: '6.1.1 Safely managed drinking water',
    card63: '6.3.2 Contaminant exceedance profile',
    card64: '6.4.2 Water stress index',
    level: {
      'safely-managed': 'Safely managed', basic: 'Basic', limited: 'Limited',
      unimproved: 'Unimproved', 'surface-water': 'Surface water',
    },
    free: {
      free: 'free from measured contamination',
      contaminated: 'contamination detected',
      unknown: 'quality unverified',
    },
    gapLabel: 'Gaps to safely managed',
    gap: {
      quality: 'reported contaminants need treatment',
      'quality-unverified': 'quality cannot be fully verified',
      access: 'source is not on premises',
      availability: 'supply is not confirmed available when needed',
    },
    needsLine: names => `Reported gaps: ${names.join(', ')}.`,
    noNeeds: 'No contaminant gaps were reported in this sample.',
    needNames: {
      bacteria: 'microbial', protozoa: 'protozoa', virus: 'viral', turbidity: 'turbidity',
      lead: 'lead', copper: 'copper', arsenic: 'arsenic', nitrate: 'nitrate', pfas: 'PFAS class',
    },
    band63: {
      none: 'no measured exceedance', single: 'single exceedance',
      multiple: 'multiple exceedances', severe: 'severe profile',
    },
    worst63: (name, ratio) => `Largest ratio: ${name} at ${ratio}x its benchmark.`,
    none63: 'No reported measurement exceeds its benchmark in this sample.',
    hiLine: (raw, status) => `PFAS Hazard Index ${raw ?? 'n/a'} (${status}).`,
    status: {
      below: 'below', at: 'at', above: 'above',
      'above-lower-bound': 'above (lower bound)', incomplete: 'incomplete',
      'not-applicable': 'not applicable',
    },
    index64: 'Adjusted stress index',
    adjust64: adjust => (adjust > 0 ? `includes a ${adjust} point reliability penalty` : 'no reliability penalty'),
    serviceTitle: 'Service context',
    sourceLabel: 'Drinking-water source',
    source: {
      piped: 'Piped on premises',
      'improved-30': 'Improved, 30 min or less',
      'improved-far': 'Improved, over 30 min',
      unimproved: 'Unimproved source',
      surface: 'Surface water',
    },
    availabilityLabel: 'Available when needed',
    availability: {
      reliable: 'Reliable', interrupted: 'Interrupted', unknown: 'Not known',
    },
    stressLabel: 'Baseline water stress',
    stress: {
      low: 'Low', 'low-medium': 'Low-medium', 'medium-high': 'Medium-high',
      high: 'High', extreme: 'Extremely high',
    },
    planTitle: 'Community intervention planner',
    planNote: 'Five low-cost clean-water interventions compared on cost per person-year of safe water, modeled contaminant fit, and people reached for the grant budget. Costs are illustrative mid-range field figures, not quotes, and contaminant fit uses the tri-state removal claims below; certification is per product and standard.',
    budgetLabel: 'Grant budget (USD)',
    peopleLabel: 'Community size (people)',
    colName: 'Intervention', colUnits: 'Units', colReached: 'People reached',
    colYears: 'Person-years', colCost: 'Cost per person-year', colFit: 'Contaminant fit',
    fit: {
      yes: 'covers the reported gaps', partial: 'partial cover only', no: 'does not cover',
      withheld: 'withheld', 'no-need': 'none needed',
    },
    recommended: name => `Best modeled reach for this budget: ${name}.`,
    reachShare: (reached, people) => `${reached} of ${people} people reached`,
    recPartial: 'partial cover only; some reported contaminants are not fully treated',
    recEconomics: 'economics only; no listed option covers the reported contaminants',
    coverage: (reached, people, pct) => `${reached} of ${people} people reached; ${pct}% of the community is still uncovered.`,
    blockedNote: 'This source has an active advisory or a positive E. coli result, so contaminant-fit claims are withheld. Official instructions come first; the economics below are long-term planning figures, not a fix for this advisory.',
    chartTitle: 'Cost per person-year vs safe-water impact',
    chartNote: 'Each marker is one intervention at the current budget: horizontal position is its unit cost per person-year, vertical position is the person-years of safe water it can deliver, and marker size follows people reached. Focus a marker for details.',
    xLabel: 'cost per person-year (USD, log scale)',
    yLabel: 'person-years of safe water',
    focusDetail: (name, cost, years) => `${name}: ${cost} per person-year, delivering up to ${years} person-years at this budget.`,
    interventions: {
      'ceramic-pot': 'Ceramic pot filter',
      biosand: 'Biosand filter',
      sodis: 'Solar disinfection (SODIS)',
      'borehole-repair': 'Community borehole repair',
      'pou-ro-gac': 'Point-of-use RO and carbon',
    },
    blurbs: {
      'ceramic-pot': 'household element for bacteria and protozoa',
      biosand: 'household sand biolayer; partial virus, conditional arsenic',
      sodis: 'sunlight inactivation in clear bottles; needs low turbidity',
      'borehole-repair': 'restores an improved source; chemistry depends on the aquifer',
      'pou-ro-gac': 'broad dissolved-chemical removal; per-product certification',
    },
  },
  es: {
    title: 'Laboratorio de equidad de agua potable ODS 6',
    sourceLine: label => `Contexto de servicio analizado para ${label}.`,
    indicatorTitle: 'Motor de indicadores ODS 6',
    indicatorNote: 'Estimaciones didácticas deterministas construidas sobre el mismo motor de evaluación que el informe del grifo. No son datos de servicio del JMP, diseños de ingeniería ni determinaciones de cumplimiento.',
    noSource: 'Elija un ejemplo sintético o aplique un CSV en el laboratorio de arriba para activar los indicadores y la verificación de ajuste por contaminante.',
    card61: '6.1.1 Agua potable gestionada de forma segura',
    card63: '6.3.2 Perfil de excedencia de contaminantes',
    card64: '6.4.2 Índice de estrés hídrico',
    level: {
      'safely-managed': 'Gestionada de forma segura', basic: 'Básico', limited: 'Limitado',
      unimproved: 'No mejorado', 'surface-water': 'Agua superficial',
    },
    free: {
      free: 'libre de contaminación medida',
      contaminated: 'contaminación detectada',
      unknown: 'calidad no verificada',
    },
    gapLabel: 'Brechas hacia la gestión segura',
    gap: {
      quality: 'los contaminantes reportados necesitan tratamiento',
      'quality-unverified': 'la calidad no puede verificarse por completo',
      access: 'la fuente no está en el domicilio',
      availability: 'no se confirma el suministro cuando se necesita',
    },
    needsLine: names => `Brechas reportadas: ${names.join(', ')}.`,
    noNeeds: 'No se reportaron brechas de contaminantes en esta muestra.',
    needNames: {
      bacteria: 'microbiano', protozoa: 'protozoos', virus: 'viral', turbidity: 'turbidez',
      lead: 'plomo', copper: 'cobre', arsenic: 'arsénico', nitrate: 'nitrato', pfas: 'clase PFAS',
    },
    band63: {
      none: 'sin excedencia medida', single: 'una excedencia',
      multiple: 'múltiples excedencias', severe: 'perfil severo',
    },
    worst63: (name, ratio) => `Mayor proporción: ${name} a ${ratio}x su nivel de referencia.`,
    none63: 'Ninguna medición reportada excede su nivel de referencia en esta muestra.',
    hiLine: (raw, status) => `Índice de Peligro de PFAS ${raw ?? 'n/a'} (${status}).`,
    status: {
      below: 'debajo', at: 'en el nivel', above: 'arriba',
      'above-lower-bound': 'arriba (límite inferior)', incomplete: 'incompleto',
      'not-applicable': 'no aplica',
    },
    index64: 'Índice de estrés ajustado',
    adjust64: adjust => (adjust > 0 ? `incluye una penalización de ${adjust} puntos por confiabilidad` : 'sin penalización por confiabilidad'),
    serviceTitle: 'Contexto del servicio',
    sourceLabel: 'Fuente de agua potable',
    source: {
      piped: 'Tubería en el domicilio',
      'improved-30': 'Mejorada, 30 min o menos',
      'improved-far': 'Mejorada, más de 30 min',
      unimproved: 'Fuente no mejorada',
      surface: 'Agua superficial',
    },
    availabilityLabel: 'Disponible cuando se necesita',
    availability: {
      reliable: 'Confiable', interrupted: 'Interrumpido', unknown: 'No se sabe',
    },
    stressLabel: 'Estrés hídrico de base',
    stress: {
      low: 'Bajo', 'low-medium': 'Bajo-medio', 'medium-high': 'Medio-alto',
      high: 'Alto', extreme: 'Extremadamente alto',
    },
    planTitle: 'Planificador de intervenciones comunitarias',
    planNote: 'Cinco intervenciones de agua potable de bajo costo comparadas por costo por persona-año de agua segura, ajuste modelado por contaminante y personas alcanzadas para el presupuesto de la subvención. Los costos son cifras ilustrativas de rango medio de campo, no cotizaciones, y el ajuste por contaminante usa las afirmaciones triestado de remoción de abajo; la certificación es por producto y norma.',
    budgetLabel: 'Presupuesto de la subvención (USD)',
    peopleLabel: 'Tamaño de la comunidad (personas)',
    colName: 'Intervención', colUnits: 'Unidades', colReached: 'Personas alcanzadas',
    colYears: 'Persona-años', colCost: 'Costo por persona-año', colFit: 'Ajuste por contaminante',
    fit: {
      yes: 'cubre las brechas reportadas', partial: 'cobertura parcial', no: 'no cubre',
      withheld: 'retenido', 'no-need': 'ninguna necesaria',
    },
    recommended: name => `Mejor alcance modelado para este presupuesto: ${name}.`,
    reachShare: (reached, people) => `${reached} de ${people} personas alcanzadas`,
    recPartial: 'cobertura parcial; algunos contaminantes reportados no se tratan por completo',
    recEconomics: 'solo economía; ninguna opción listada cubre los contaminantes reportados',
    coverage: (reached, people, pct) => `${reached} de ${people} personas alcanzadas; ${pct}% de la comunidad sigue sin cobertura.`,
    blockedNote: 'Esta fuente tiene un aviso activo o un resultado positivo de E. coli, por lo que las afirmaciones de ajuste por contaminante se retienen. Las instrucciones oficiales van primero; la economía de abajo son cifras de planificación a largo plazo, no una solución a este aviso.',
    chartTitle: 'Costo por persona-año vs impacto de agua segura',
    chartNote: 'Cada marcador es una intervención con el presupuesto actual: la posición horizontal es su costo unitario por persona-año, la vertical son las persona-años de agua segura que puede entregar, y el tamaño del marcador sigue a las personas alcanzadas. Enfoque un marcador para ver detalles.',
    xLabel: 'costo por persona-año (USD, escala log)',
    yLabel: 'persona-años de agua segura',
    focusDetail: (name, cost, years) => `${name}: ${cost} por persona-año, entregando hasta ${years} persona-años con este presupuesto.`,
    interventions: {
      'ceramic-pot': 'Filtro de cerámica tipo olla',
      biosand: 'Filtro de bioarena',
      sodis: 'Desinfección solar (SODIS)',
      'borehole-repair': 'Reparación de pozo comunitario',
      'pou-ro-gac': 'Ósmosis inversa y carbón en punto de uso',
    },
    blurbs: {
      'ceramic-pot': 'elemento doméstico para bacterias y protozoos',
      biosand: 'unidad doméstica de biocapa de arena; virus parcial, arsénico condicional',
      sodis: 'inactivación solar en botellas transparentes; requiere baja turbidez',
      'borehole-repair': 'restaura una fuente mejorada; la química depende del acuífero',
      'pou-ro-gac': 'amplia remoción de químicos disueltos; certificación por producto',
    },
  },
};

const NEED_DISPLAY = {
  lead: { en: 'Lead', es: 'Plomo' }, copper: { en: 'Copper', es: 'Cobre' },
  arsenic: { en: 'Arsenic', es: 'Arsénico' }, nitrate: { en: 'Nitrate', es: 'Nitrato' },
  'hazard-index': { en: 'Hazard Index', es: 'Índice de Peligro' },
};

/* ---------- browser render ---------- */

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

function fmtMoney(value, digits = 2) {
  return `$${Number(value).toFixed(digits)}`;
}

function fmtInt(value) {
  return Number(value).toLocaleString('en-US');
}

function fmtRatio4(value) {
  return Number(value.toPrecision(4)).toString();
}

// Inline mark from the page's own symbol sheet (index.html), never a fetched asset.
function markIcon(id, cls = '') {
  const svg = svgEl('svg', { class: `mark${cls ? ` ${cls}` : ''}`, 'aria-hidden': 'true', focusable: 'false' });
  svg.append(svgEl('use', { href: `#${id}` }));
  return svg;
}

const TONE_MARK = { good: 'mark-below', warn: 'mark-at', bad: 'mark-above', muted: 'mark-missing' };
const FIT_MARK = { yes: 'mark-below', partial: 'mark-at', no: 'mark-above', withheld: 'mark-above', 'no-need': 'mark-missing' };

// Legend swatch that reuses the chart's own dot classes.
const DOT_CLASS = { yes: 'sdg6-dot-yes', partial: 'sdg6-dot-partial', no: 'sdg6-dot-no', withheld: 'sdg6-dot-no', 'no-need': 'sdg6-dot-none' };

function svgDot(fit) {
  const svg = svgEl('svg', { class: 'sdg6-swatch', viewBox: '0 0 14 14', 'aria-hidden': 'true', focusable: 'false' });
  svg.append(svgEl('circle', { cx: 7, cy: 7, r: 5, class: `sdg6-dot ${DOT_CLASS[fit] ?? 'sdg6-dot-none'}` }));
  return svg;
}

// Horizontal share meter drawn with SVG geometry, so the page CSP needs no inline styles.
function shareMeter(share, label, cls) {
  const pct = Math.min(100, Math.max(0, Number.isFinite(share) ? share * 100 : 0));
  const svg = svgEl('svg', {
    class: `sdg6-meter ${cls}`, viewBox: '0 0 100 6', preserveAspectRatio: 'none', role: 'img', 'aria-label': label,
  });
  svg.append(svgEl('rect', { x: 0, y: 0, width: 100, height: 6, class: 'sdg6-meter-track' }));
  svg.append(svgEl('rect', { x: 0, y: 0, width: pct.toFixed(2), height: 6, class: 'sdg6-meter-fill' }));
  return svg;
}

function chipBar(label, names, options, current, onPick) {
  const bar = el('div', { class: 'lab-chipbar', role: 'group', 'aria-label': label });
  bar.append(el('span', { class: 'lab-lang-label sdg6-chip-label', text: `${label}:` }));
  for (const option of options) {
    const button = el('button', {
      type: 'button', class: 'lab-chip sdg6-chip', 'data-sdg6-value': option,
      'aria-pressed': String(current === option), text: names[option] ?? option,
    });
    button.addEventListener('click', () => onPick(option));
    bar.append(button);
  }
  return bar;
}

function indicatorCards(t, lang, i61, i63, i64) {
  const cards = el('div', { class: 'sdg6-cards' });
  const card = (title, tone, nodes) => el('div', { class: `sdg6-card sdg6-card-${tone}` }, [
    el('h4', { class: 'sdg6-card-h', text: title }),
    ...nodes,
  ]);
  const level = (tone, text) => el('p', { class: `sdg6-level sdg6-${tone}` }, [markIcon(TONE_MARK[tone], 'sdg6-level-mark'), text]);
  const tone61 = i61.level === 'safely-managed' ? 'good' : 'warn';
  const tone63 = i63.band === 'none' ? 'good' : i63.band === 'single' ? 'warn' : 'bad';
  const tone64 = ['high', 'extreme'].includes(i64.band) ? 'bad' : i64.band === 'medium-high' ? 'warn' : 'good';
  const freeCls = i61.free === 'free' ? 'sdg6-good' : i61.free === 'contaminated' ? 'sdg6-bad' : 'sdg6-muted';
  cards.append(card(t.card61, tone61, [
    level(tone61, t.level[i61.level]),
    el('p', { class: `sdg6-line ${freeCls}`, text: t.free[i61.free] }),
    i61.gap.length ? el('p', { class: 'sdg6-line sdg6-muted', text: `${t.gapLabel}: ${i61.gap.map(g => t.gap[g]).join('; ')}.` }) : null,
    el('p', {
      class: 'sdg6-line sdg6-muted',
      text: i61.needs.length ? t.needsLine(i61.needs.map(n => t.needNames[n])) : t.noNeeds,
    }),
  ]));
  cards.append(card(t.card63, tone63, [
    level(tone63, t.band63[i63.band]),
    el('p', {
      class: 'sdg6-line sdg6-muted',
      text: i63.worst ? t.worst63(NEED_DISPLAY[i63.worst.id]?.[lang] ?? i63.worst.id, fmtRatio4(i63.worst.ratio)) : t.none63,
    }),
    el('p', {
      class: 'sdg6-line sdg6-muted',
      text: t.hiLine(i63.hazardIndex.raw, t.status[i63.hazardIndex.status] ?? i63.hazardIndex.status),
    }),
  ]));
  cards.append(card(t.card64, tone64, [
    level(tone64, t.stress[i64.band]),
    el('p', { class: 'sdg6-line sdg6-muted', text: `${t.index64}: ${i64.index}/100 (${t.adjust64(i64.reliabilityAdjust)}).` }),
  ]));
  return cards;
}

function planTable(t, plan, state, choose) {
  const wrap = el('div', { class: 'table-wrap lab-table-wrap' });
  // Explicit roles keep table semantics when phones restack the rows as cards.
  const table = el('table', { class: 'lab-table sdg6-plan', role: 'table', 'aria-label': t.planTitle });
  const col = (text, cls) => el('th', { scope: 'col', role: 'columnheader', ...(cls ? { class: cls } : {}), text });
  table.append(el('thead', { role: 'rowgroup' }, el('tr', { role: 'row' }, [
    col(t.colName),
    col(t.colUnits, 'num'),
    col(t.colReached, 'num'),
    col(t.colYears, 'num'),
    col(t.colCost, 'num'),
    col(t.colFit),
  ])));
  const body = el('tbody', { role: 'rowgroup' });
  for (const row of plan.rows) {
    const pick = el('button', {
      type: 'button', class: 'lab-pick sdg6-pick',
      'aria-pressed': String(state.focus === row.id),
      text: t.interventions[row.id],
    });
    pick.addEventListener('click', () => choose({ focus: row.id }));
    body.append(el('tr', {
      class: `${plan.recommended?.id === row.id ? 'lab-active' : ''}${state.focus === row.id ? ' sdg6-row-focus' : ''}`,
      'data-sdg6-row': row.id, role: 'row',
    }, [
      el('th', { scope: 'row', role: 'rowheader' }, [pick, el('span', { class: 'lab-origin', text: t.blurbs[row.id] })]),
      el('td', { class: 'num', role: 'cell', 'data-label': t.colUnits, text: fmtInt(row.units) }),
      el('td', { class: 'num sdg6-reach', role: 'cell', 'data-label': t.colReached }, [
        el('span', { class: 'sdg6-reach-n', text: fmtInt(row.peopleReached) }),
        shareMeter(state.people > 0 ? row.peopleReached / state.people : 0,
          t.reachShare(fmtInt(row.peopleReached), fmtInt(state.people)), `sdg6-meter-row sdg6-meter-${row.fit}`),
      ]),
      el('td', { class: 'num', role: 'cell', 'data-label': t.colYears, text: fmtInt(row.personYears) }),
      el('td', { class: 'num sdg6-cost', role: 'cell', 'data-label': t.colCost, text: fmtMoney(row.costPerPersonYear) }),
      el('td', { class: `sdg6-fit-${row.fit}`, role: 'cell', 'data-label': t.colFit }, [
        el('span', { class: 'sdg6-badge' }, [markIcon(FIT_MARK[row.fit] ?? 'mark-missing'), t.fit[row.fit]]),
      ]),
    ]));
  }
  table.append(body);
  wrap.append(table);
  return wrap;
}

function planControls(t, state, choose) {
  const grid = el('div', { class: 'model-grid' });
  const budget = el('input', {
    type: 'number', min: String(SDG6_BUDGET_RANGE.min), max: String(SDG6_BUDGET_RANGE.max),
    step: '1', value: String(state.budget), id: 'sdg6-budget', 'aria-label': t.budgetLabel,
    'data-sdg6-control': 'budget',
  });
  const people = el('input', {
    type: 'number', min: String(SDG6_PEOPLE_RANGE.min), max: String(SDG6_PEOPLE_RANGE.max),
    step: '1', value: String(state.people), id: 'sdg6-people', 'aria-label': t.peopleLabel,
    'data-sdg6-control': 'people',
  });
  const clamp = (value, min, max, integer) => {
    const n = integer ? Math.round(Number(value)) : Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
  };
  budget.addEventListener('change', () => {
    const next = clamp(budget.value, SDG6_BUDGET_RANGE.min, SDG6_BUDGET_RANGE.max, false);
    if (next !== null && next !== state.budget) choose({ budget: next });
  });
  people.addEventListener('change', () => {
    const next = clamp(people.value, SDG6_PEOPLE_RANGE.min, SDG6_PEOPLE_RANGE.max, true);
    if (next !== null && next !== state.people) choose({ people: next });
  });
  grid.append(
    el('div', { class: 'model-field' }, [el('label', { for: 'sdg6-budget', text: t.budgetLabel }), budget]),
    el('div', { class: 'model-field' }, [el('label', { for: 'sdg6-people', text: t.peopleLabel }), people]),
  );
  const chips = el('div', { class: 'lab-chipbar sdg6-budget-chips', role: 'group', 'aria-label': t.budgetLabel });
  for (const amount of [35, 100, 500, 2500, 10000]) {
    const chip = el('button', {
      type: 'button', class: 'lab-chip sdg6-chip', 'data-sdg6-budget': String(amount),
      'aria-pressed': String(state.budget === amount), text: `$${fmtInt(amount)}`,
    });
    chip.addEventListener('click', () => choose({ budget: amount }));
    chips.append(chip);
  }
  return [grid, chips];
}

function sdg6Chart(t, plan, state, choose) {
  const W = 560; const H = 300; const ML = 52; const MR = 16; const MT = 16; const MB = 44;
  const plotW = W - ML - MR; const plotH = H - MT - MB;
  const LOG_MIN = -0.55; const LOG_MAX = 1.42;
  const maxYears = Math.max(1, ...plan.rows.map(row => row.personYears)) * 1.12;
  const x = cost => ML + ((Math.log10(cost) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * plotW;
  const y = years => MT + plotH - (years / maxYears) * plotH;
  const svg = svgEl('svg', {
    class: 'lab-chart sdg6-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t.chartTitle,
  });
  const line = (x1, y1, x2, y2, cls) => svgEl('line', { x1, y1, x2, y2, class: cls });
  const text = (tx, ty, content, anchor = 'middle') => {
    const node = svgEl('text', { x: tx, y: ty, 'text-anchor': anchor });
    node.textContent = content;
    return node;
  };
  for (const cost of [0.5, 1, 2, 5, 10, 20]) {
    svg.append(line(x(cost), MT, x(cost), MT + plotH, 'grid-line'));
    svg.append(text(x(cost), H - 24, fmtMoney(cost, cost < 1 ? 2 : 0)));
  }
  const step = 10 ** Math.floor(Math.log10(maxYears / 4));
  const ystep = ([1, 2, 5, 10].find(c => c * step >= maxYears / 4) ?? 10) * step;
  for (let v = 0; v <= maxYears; v += ystep) {
    svg.append(line(ML, y(v), W - MR, y(v), 'grid-line'));
    svg.append(text(ML - 6, y(v) + 3, fmtInt(Math.round(v)), 'end'));
  }
  svg.append(line(ML, MT + plotH, W - MR, MT + plotH, 'axis'));
  svg.append(line(ML, MT, ML, MT + plotH, 'axis'));
  svg.append(text(ML + plotW / 2, H - 6, t.xLabel));
  const yLab = text(12, MT + plotH / 2, t.yLabel);
  yLab.setAttribute('transform', `rotate(-90 12 ${MT + plotH / 2})`);
  yLab.setAttribute('class', 'sdg6-ylab');
  svg.append(yLab);

  const points = plan.rows.map(row => ({ row, cx: x(row.costPerPersonYear), cy: y(row.personYears) }));
  for (const point of points) {
    point.hitR = Math.min(30, Math.max(12, points.reduce((nearest, other) => {
      if (other === point) return nearest;
      const d = Math.hypot(other.cx - point.cx, other.cy - point.cy) / 2;
      return Math.min(nearest, d);
    }, 30)));
  }
  const fitCls = DOT_CLASS;
  for (const { row, cx, cy, hitR } of points) {
    // Key markers (the recommended and the focused option) keep their name on narrow screens.
    const key = row.id === plan.recommended?.id || row.id === state.focus;
    const g = svgEl('g', {
      tabindex: '0', role: 'listitem', class: `lab-bar sdg6-marker${key ? ' sdg6-marker-key' : ''}`, 'data-sdg6-marker': row.id,
    });
    g.setAttribute('aria-label', t.focusDetail(t.interventions[row.id], fmtMoney(row.costPerPersonYear), fmtInt(row.personYears)));
    const activate = () => choose({ focus: row.id });
    g.addEventListener('click', activate);
    g.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
    });
    g.append(svgEl('circle', { cx, cy, r: hitR, class: 'sdg6-hit' }));
    const radius = 4 + Math.min(9, Math.sqrt(Math.max(0, row.peopleReached)) / 4);
    g.append(svgEl('circle', {
      cx, cy, r: radius.toFixed(2),
      class: `sdg6-dot ${fitCls[row.fit]}${state.focus === row.id ? ' sdg6-dot-focus' : ''}`,
    }));
    // Markers in the right third label inward so long names never run past the frame.
    // Markers on the floor of the plot lift their label clear of the axis.
    const inward = cx > ML + plotW * 0.62;
    const ly = cy > MT + plotH - 16 ? cy - radius - 6 : cy + 3.5;
    const label = inward
      ? text(cx - radius - 2, ly, t.interventions[row.id], 'end')
      : text(cx + radius + 5, ly, t.interventions[row.id], 'start');
    label.setAttribute('class', 'seg-label');
    g.append(label);
    svg.append(g);
  }
  return svg;
}

// After layout, move any visible marker label that covers another marker's dot, an
// earlier label, or the axes to the nearest clear spot beside its own dot, and draw a
// thin leader when it had to shift. Measured boxes hold at every CSS font size; no-op off-DOM.
function declutterLabels(svg) {
  if (!svg.isConnected || typeof svg.getBoundingClientRect !== 'function') return;
  const frame = svg.getBoundingClientRect();
  if (!frame.width) return;
  const scale = frame.width / 560;
  const plot = { left: frame.left + 52 * scale, right: frame.left + 544 * scale, top: frame.top + 2 * scale, bottom: frame.top + 254 * scale };
  const hits = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const markers = [...svg.querySelectorAll('.sdg6-marker')];
  const placed = [];
  for (const marker of markers) {
    const label = marker.querySelector('.seg-label');
    const dot = marker.querySelector('.sdg6-dot');
    if (!label || !dot || !label.getBoundingClientRect().width) continue;
    const others = markers.filter(m => m !== marker).map(m => m.querySelector('.sdg6-dot').getBoundingClientRect());
    const cx = Number(dot.getAttribute('cx'));
    const cy = Number(dot.getAttribute('cy'));
    const r = Number(dot.getAttribute('r'));
    const start = { x: label.getAttribute('x'), y: Number(label.getAttribute('y')), anchor: label.getAttribute('text-anchor') };
    const set = ({ x, y, anchor }) => {
      label.setAttribute('x', String(x));
      label.setAttribute('y', String(y));
      label.setAttribute('text-anchor', anchor);
    };
    const clear = () => {
      const box = label.getBoundingClientRect();
      return box.left >= plot.left && box.right <= plot.right && box.top >= plot.top && box.bottom <= plot.bottom
        && !others.some(other => hits(box, other)) && !placed.some(prev => hits(box, prev));
    };
    if (!clear()) {
      const step = label.getBoundingClientRect().height / scale + 1;
      const right = { x: cx + r + 5, anchor: 'start' };
      const left = { x: cx - r - 5, anchor: 'end' };
      const sides = start.anchor === 'end' ? [left, right] : [right, left];
      const candidates = [];
      for (const k of [0, -1, 1, -2, 2, -3]) {
        for (const side of sides) candidates.push({ ...side, y: cy + 3.5 + k * step, shifted: k !== 0 });
      }
      const found = candidates.find(c => { set(c); return clear(); });
      if (!found) set(start);
      else if (found.shifted) {
        const tip = found.anchor === 'start' ? found.x - 2 : found.x + 2;
        const leader = svgEl('line', { x1: cx, y1: cy, x2: tip, y2: found.y - 4, class: 'sdg6-leader' });
        marker.insertBefore(leader, dot);
      }
    }
    placed.push(label.getBoundingClientRect());
  }
}

export function renderSdg6Section(root, { lang = 'en', state, summary = null, tapLabel = null, choose }) {
  const t = SDG6_STRINGS[lang] ?? SDG6_STRINGS.en;
  const patch = update => {
    const next = normalizeSdg6State({ ...state, ...update });
    if (next) choose(next);
  };
  root.replaceChildren();
  if (tapLabel) root.append(el('p', { class: 'rail-note', text: t.sourceLine(tapLabel) }));
  if (!summary) {
    root.append(el('p', { class: 'disabled-note', text: t.noSource }));
    return;
  }
  const ctx = screenContext({ tap: summary.tap, advisory: summary.advisory, ecoli: summary.ecoli, values: summary.values });
  const i61 = indicator61(state, ctx);
  const i63 = indicator63(ctx);
  const i64 = indicator64(state);
  const plan = planInterventions(state, ctx);

  root.append(el('h3', { text: t.indicatorTitle }), el('p', { class: 'notes', text: t.indicatorNote }));
  root.append(indicatorCards(t, SDG6_STRINGS[lang] ? lang : 'en', i61, i63, i64));

  root.append(el('h3', { text: t.serviceTitle }));
  root.append(chipBar(t.sourceLabel, t.source, SDG6_SOURCES, state.source, source => patch({ source })));
  root.append(chipBar(t.availabilityLabel, t.availability, SDG6_AVAILABILITY, state.availability, availability => patch({ availability })));
  root.append(chipBar(t.stressLabel, t.stress, SDG6_STRESS, state.stress, stress => patch({ stress })));

  root.append(el('h3', { text: t.planTitle }), el('p', { class: 'notes', text: t.planNote }));
  for (const node of planControls(t, state, patch)) root.append(node);
  if (plan.blocked) root.append(el('p', { class: 'lab-guard', role: 'note', text: t.blockedNote }));
  root.append(planTable(t, plan, state, patch));

  if (plan.recommended) {
    const item = plan.rows.find(row => row.id === plan.recommended.id);
    const caveat = plan.recommended.kind === 'partial' ? ` (${t.recPartial})`
      : plan.recommended.kind === 'economics' ? ` (${t.recEconomics})` : '';
    const tone = plan.recommended.kind === 'partial' ? 'warn' : plan.recommended.kind === 'economics' ? 'bad' : 'good';
    const verdict = el('div', { class: `sdg6-verdict sdg6-verdict-${tone}` });
    verdict.append(el('p', {
      class: 'model-value sdg6-rec', 'data-sdg6-rec': item.id, 'aria-live': 'polite',
    }, [markIcon(TONE_MARK[tone], 'sdg6-rec-mark'), `${t.recommended(t.interventions[item.id])}${caveat}`]));
    const pct = state.people > 0 ? Math.round((item.peopleReached / state.people) * 100) : 0;
    const coverageText = t.coverage(fmtInt(item.peopleReached), fmtInt(state.people), Math.max(0, 100 - pct));
    verdict.append(
      shareMeter(state.people > 0 ? item.peopleReached / state.people : 0, coverageText, 'sdg6-meter-verdict'),
      el('p', { class: 'notes sdg6-coverage', 'data-sdg6-coverage': '', text: coverageText }),
    );
    root.append(verdict);
  } else {
    const coverageText = t.coverage(0, fmtInt(state.people), 100);
    const verdict = el('div', { class: 'sdg6-verdict sdg6-verdict-bad' });
    verdict.append(
      el('p', { class: 'model-value', text: coverageText }),
      shareMeter(0, coverageText, 'sdg6-meter-verdict'),
    );
    root.append(verdict);
  }

  root.append(el('h3', { text: t.chartTitle }), el('p', { class: 'notes', text: t.chartNote }));
  const legend = el('ul', { class: 'sdg6-legend', 'aria-label': t.colFit });
  // Legend lists only the fits on screen, so a withheld plan never reads as "does not cover".
  const shown = new Set(plan.rows.map(row => row.fit));
  for (const fit of ['yes', 'partial', 'no', 'withheld', 'no-need'].filter(f => shown.has(f))) {
    legend.append(el('li', {}, [svgDot(fit), t.fit[fit]]));
  }
  root.append(legend);
  const chart = sdg6Chart(t, plan, state, patch);
  root.append(chart);
  declutterLabels(chart);
  if (state.focus) {
    const row = plan.rows.find(entry => entry.id === state.focus);
    if (row) {
      root.append(el('p', {
        class: 'model-value lab-focus sdg6-focus', 'aria-live': 'polite', 'data-sdg6-focus': row.id,
        text: t.focusDetail(t.interventions[row.id], fmtMoney(row.costPerPersonYear), fmtInt(row.personYears)),
      }));
    }
  }
}

/* ---------- deterministic in-page self-tests ---------- */

function expect(condition, detail) {
  if (!condition) throw new Error(detail);
  return detail;
}

export function sdg6SelfTests() {
  const tests = [];
  const run = (id, fn) => {
    try {
      tests.push({ id, ok: true, detail: fn() ?? '' });
    } catch (error) {
      tests.push({ id, ok: false, detail: String(error?.message ?? error) });
    }
  };
  const base = (values = {}, advisory = 'none', ecoli = 'absent') =>
    screenContext({ tap: 'Self-test tap', advisory, ecoli, values });
  const st = (overrides = {}) => normalizeSdg6State(overrides);

  run('sdg6-ladder-access-cap', () => {
    const i = indicator61(st(), base({ lead: '1' }));
    return expect(i.level === 'basic' && i.gap.includes('access'),
      `improved-30 caps at basic, got ${i.level}`);
  });
  run('sdg6-ladder-piped-clean', () => {
    const allClean = {
      lead: '1', copper: '10', nitrate: '2', arsenic: '1', pfoa: '1',
      pfos: '1', pfhxs: '1', pfna: '1', genx: '1', pfbs: '10',
    };
    const i = indicator61(st({ source: 'piped' }), base(allClean));
    return expect(i.level === 'safely-managed' && i.gap.length === 0 && i.free === 'free',
      `piped reliable with all fields clean is safely managed, got ${i.level}`);
  });
  run('sdg6-unverified-caps-at-basic', () => {
    const i = indicator61(st({ source: 'piped' }), base({ lead: '1' }));
    return expect(i.level === 'basic' && i.free === 'unknown' && i.gap.includes('quality-unverified'),
      `unreported cells block the free claim, got ${i.level}/${i.free}`);
  });
  run('sdg6-ladder-surface-and-far', () => {
    const surface = indicator61(st({ source: 'surface' }), base({}));
    const far = indicator61(st({ source: 'improved-far' }), base({}));
    return expect(surface.level === 'surface-water' && far.level === 'limited',
      `${surface.level}/${far.level}`);
  });
  run('sdg6-quality-gap', () => {
    const i = indicator61(st({ source: 'piped' }), base({ lead: '30' }));
    return expect(i.level === 'basic' && i.free === 'contaminated'
      && i.gap.includes('quality') && i.needs.includes('lead'),
      `lead above blocks safely managed, needs ${i.needs}`);
  });
  run('sdg6-microbiological-need', () => {
    const i = indicator61(st(), base({}, 'boil', 'unknown'));
    return expect(i.needs.includes('bacteria') && i.free === 'contaminated',
      `boil advisory creates the microbial need`);
  });
  run('sdg6-exceedance-bands', () => {
    const clean = indicator63(base({ lead: '1' }));
    const single = indicator63(base({ lead: '24.6' }));
    const multiple = indicator63(base({ lead: '24.6', nitrate: '13.6' }));
    const severe = indicator63(base({}, 'do-not-drink', 'unknown'));
    return expect(clean.band === 'none' && single.band === 'single'
      && multiple.band === 'multiple' && severe.band === 'severe',
      `${clean.band}/${single.band}/${multiple.band}/${severe.band}`);
  });
  run('sdg6-stress-index', () => {
    const calm = indicator64(st({ stress: 'low', availability: 'reliable' }));
    const hard = indicator64(st({ stress: 'extreme', availability: 'interrupted' }));
    return expect(calm.index === 5 && calm.band === 'low' && hard.index === 100 && hard.band === 'extreme',
      `${calm.index}/${hard.index}`);
  });
  run('sdg6-planner-micro-grant', () => {
    const plan = planInterventions(st({ budget: 35, people: 300 }), base({ lead: '1' }));
    const sodis = plan.rows.find(row => row.id === 'sodis');
    const borehole = plan.rows.find(row => row.id === 'borehole-repair');
    return expect(sodis.units === 8 && sodis.peopleReached === 24 && borehole.units === 0
      && plan.recommended.id === 'sodis', `35 USD reaches ${sodis.peopleReached} via SODIS`);
  });
  run('sdg6-planner-respects-community-cap', () => {
    const plan = planInterventions(st({ budget: 10000, people: 40 }), base({ lead: '1' }));
    const borehole = plan.rows.find(row => row.id === 'borehole-repair');
    return expect(borehole.peopleReached === 40 && plan.rows.every(row => row.peopleReached <= 40),
      `reached is capped at the community size`);
  });
  run('sdg6-planner-fit-aware', () => {
    const plan = planInterventions(st({ budget: 500, people: 300 }), base({ nitrate: '25' }));
    const ro = plan.rows.find(row => row.id === 'pou-ro-gac');
    return expect(plan.needs.includes('nitrate') && ro.fit === 'yes'
      && plan.recommended.id === 'pou-ro-gac' && plan.recommended.kind === 'fit',
      `nitrate steer the pick to RO, got ${plan.recommended.id}`);
  });
  run('sdg6-withheld-under-advisory', () => {
    const plan = planInterventions(st(), base({ nitrate: '25' }, 'boil', 'unknown'));
    return expect(plan.blocked && plan.rows.every(row => row.fit === 'withheld'),
      'active advisory withholds every contaminant fit claim');
  });
  run('sdg6-state-roundtrip', () => {
    const state = st({ source: 'piped', budget: 750, people: 1200, focus: 'biosand' });
    const again = normalizeSdg6State(JSON.parse(JSON.stringify(state)));
    return expect(JSON.stringify(again) === JSON.stringify(state), 'state survives a JSON round trip');
  });
  run('sdg6-closed-vocabularies', () => {
    const bad = [null, [], 'x', { source: 'spring' }, { stress: 'mild' }, { budget: 10 },
      { people: 0 }, { focus: 'magic' }, { hack: 1 }];
    return expect(bad.every(entry => normalizeSdg6State(entry) === null), 'hostile states fail closed');
  });
  return tests;
}
