const definitions = [
  ['lead', 'Lead', 'ppb', '10', 'action level', null],
  ['copper', 'Copper', 'ppb', '1300', 'action level', null],
  ['nitrate', 'Nitrate', 'mg/L as N', '10', 'MCL', null],
  ['arsenic', 'Arsenic', 'ppb', '10', 'MCL', null],
  ['pfoa', 'PFOA', 'ppt', '4.0', 'MCL', 2],
  ['pfos', 'PFOS', 'ppt', '4.0', 'MCL', 2],
  ['pfhxs', 'PFHxS', 'ppt', '10', 'MCL', 1],
  ['pfna', 'PFNA', 'ppt', '10', 'MCL', 1],
  ['genx', 'HFPO-DA (GenX)', 'ppt', '10', 'MCL', 1],
  ['pfbs', 'PFBS', 'ppt', null, 'mixture only', null],
];

export const CHEMICALS = Object.freeze(definitions.map(([id, label, unit, limit, kind, sig]) =>
  Object.freeze({ id, label, unit, limit, kind, sig })));

const mixtureInputs = [['pfhxs', '10', '3.0'], ['pfna', '10', '4.0'], ['genx', '10', '5.0'], ['pfbs', '2000', '3.0']];
const advisories = new Set(['none', 'boil', 'do-not-drink', 'do-not-use', 'unknown']);
const bacteria = new Set(['present', 'absent', 'unknown']);
const drawTypes = new Set(['first-draw', 'flushed', 'other', 'unknown']);
const decimal = /^[0-9]{1,9}(?:\.[0-9]{1,12})?$/;
const scale = 16;
const one = 10n ** BigInt(scale);

// Every permitted reading and mixture quotient fits the same exact decimal scale.
function units(value) {
  const [whole, fractional = ''] = value.split('.');
  return BigInt(whole + fractional.padEnd(scale, '0'));
}

function fixed(value) {
  const digits = value.toString().padStart(scale + 1, '0');
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return `${digits.slice(0, -scale)}${fraction ? `.${fraction}` : ''}`;
}

function status(value, limit) {
  return value > limit ? 'above' : value === limit ? 'at' : 'below';
}

function roundSignificant(value, sig) {
  if (value === 0n) return { units: 0n, text: sig === 2 ? '0.0' : '0' };
  const step = 10n ** BigInt(Math.max(0, value.toString().length - sig));
  const rounded = (value + step / 2n) / step * step;
  const places = Math.min(12, Math.max(0, sig - (rounded.toString().length - scale)));
  const [whole, fraction = ''] = fixed(rounded).split('.');
  return {
    units: rounded,
    text: places ? `${whole}.${fraction.padEnd(places, '0')}` : whole,
  };
}

function reading(value, label) {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new TypeError(`${label} requires a decimal measurement.`);
  }
  const text = String(value).trim();
  if (!decimal.test(text)) {
    throw new RangeError(`${label} requires a nonnegative decimal in the stated unit (up to 9 whole and 12 fractional digits). Leave unreported values blank; never substitute zero for ND or < results.`);
  }
  return text;
}

export function normalizeSample(sample) {
  if (typeof sample !== 'object' || sample === null) {
    throw new TypeError('Each sample must be an object.');
  }
  const {
    tap, advisory = 'unknown', ecoli = 'unknown', values = {}, pairId = null, drawType = 'unknown',
  } = sample;
  const text = typeof tap === 'string' ? tap.trim() : '';
  if (!text || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(text)) {
    throw new RangeError('Tap name must contain 1 to 100 visible characters without controls.');
  }
  const name = text.replace(/[^\S ]+/g, ' ');
  if ([...name].length > 100) {
    throw new RangeError('Tap name must contain 1 to 100 visible characters without controls.');
  }
  let pair = null;
  if (pairId !== null && pairId !== undefined && pairId !== '') {
    if (typeof pairId !== 'string') throw new TypeError('Pair metadata must be text.');
    const rawPair = pairId.trim();
    if (!rawPair || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(rawPair)) {
      throw new RangeError('Pair metadata must contain 1 to 100 visible characters without controls.');
    }
    const pairText = rawPair.replace(/[^\S ]+/g, ' ');
    if ([...pairText].length > 100) {
      throw new RangeError('Pair metadata must contain 1 to 100 visible characters without controls.');
    }
    pair = pairText;
  }
  if (!drawTypes.has(drawType)) throw new RangeError('Draw type must be first-draw, flushed, other, or unknown.');
  if (!advisories.has(advisory)) throw new RangeError('Unknown advisory type.');
  if (!bacteria.has(ecoli)) throw new RangeError('E. coli must be present, absent, or unknown.');
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new TypeError('Measurements must be an object.');
  }
  for (const key of Object.keys(values)) {
    if (!CHEMICALS.some(({ id }) => id === key)) throw new RangeError('Unknown measurement field.');
  }
  return {
    tap: name,
    advisory,
    ecoli,
    pairId: pair,
    drawType,
    values: Object.fromEntries(CHEMICALS.map(({ id, label }) =>
      [id, reading(Object.hasOwn(values, id) ? values[id] : null, label)])),
  };
}

function hazardIndex(values) {
  let total = 0n;
  let positives = 0;
  let quantified = 0;
  const missing = [];
  const terms = mixtureInputs.map(([id, denominator, pql]) => {
    if (values[id] == null) {
      missing.push(id);
      return { id, denominator, pql, quotient: null, quantified: false };
    }
    const amount = units(values[id]);
    const contribution = amount / BigInt(denominator);
    const isQuantified = amount >= units(pql);
    if (contribution > 0n) positives += 1;
    if (isQuantified) quantified += 1;
    total += contribution;
    return { id, denominator, pql, quotient: fixed(contribution), quantified: isQuantified };
  });
  const exactStatus = status(total, one);
  const epaMixture = quantified >= 2;
  const rounded = epaMixture && missing.length === 0 ? roundSignificant(total, 1) : null;
  return {
    status: exactStatus === 'above' ? (missing.length ? 'above-lower-bound' : 'above') :
      epaMixture && missing.length === 0 ? exactStatus : missing.length ? 'incomplete' : 'not-applicable',
    raw: missing.length === terms.length ? null : fixed(total),
    rounded: rounded?.text ?? null,
    roundedStatus: rounded ? status(rounded.units, one) : null,
    positives,
    quantified,
    epaMixture,
    partial: missing.length > 0,
    missing,
    terms,
  };
}

export function screenSample(input) {
  const { advisory, ecoli, values } = normalizeSample(input);
  const results = CHEMICALS.map(meta => {
    const { id, limit, sig } = meta;
    const value = values[id];
    const exact = value === null ? null : units(value);
    const benchmark = limit === null ? null : units(limit);
    const rounded = exact !== null && sig ? roundSignificant(exact, sig) : null;
    return {
      ...meta,
      value,
      status: exact === null ? 'missing' : benchmark === null ? 'no-limit' : status(exact, benchmark),
      rounded: rounded?.text ?? null,
      roundedStatus: rounded ? status(rounded.units, benchmark) : null,
    };
  });
  const mixture = hazardIndex(values);
  const chemicals = results.filter(result => result.status === 'above').map(({ id }) => id);
  if (['above', 'above-lower-bound'].includes(mixture.status)) chemicals.push('hazard-index');
  const unknowns = results.filter(result => result.status === 'missing').map(({ id }) => id);
  if (advisory === 'unknown') unknowns.push('advisory');
  if (ecoli === 'unknown') unknowns.push('ecoli');
  const microbial = advisory === 'boil' || ecoli === 'present';
  const hasChemicals = chemicals.length > 0;
  const nitrateAtOrAbove = ['at', 'above'].includes(results.find(result => result.id === 'nitrate')?.status);
  const action = advisory === 'do-not-use' || advisory === 'do-not-drink' ? advisory :
    microbial && (hasChemicals || nitrateAtOrAbove) ? 'co-occurrence' :
    advisory === 'boil' ? 'boil' :
    microbial ? 'microbial' :
    hasChemicals ? 'chemical' :
    unknowns.length ? 'incomplete' : 'review';
  return {
    results,
    legacyLead: values.lead === null ? 'missing' : status(units(values.lead), units('15')),
    mixture,
    action,
    chemicals,
    unknowns,
  };
}

function parameter(value, label, minimum, maximum = Infinity) {
  const text = reading(value, label);
  const number = text === null ? NaN : Number(text);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new RangeError(`${label} is outside the modeled range.`);
  }
  return number;
}

export function boilModel(input, percent) {
  const sample = normalizeSample(input);
  const factor = 100 / (100 - parameter(percent, 'Evaporation percentage', 0, 95));
  const values = Object.fromEntries(Object.entries(sample.values).map(([id, value]) =>
    [id, value === null ? null : Number(value) * factor]));
  return { factor, values };
}

export function flushLead({ initial, background, volumeLiters, flowLitersPerMinute, minutes }) {
  const c0 = parameter(initial, 'Initial lead', 0);
  const floor = parameter(background, 'Background lead', 0, c0);
  const volume = parameter(volumeLiters, 'Stagnant volume', 0.01);
  const flow = parameter(flowLitersPerMinute, 'Flow rate', 0.01);
  const time = parameter(minutes, 'Flush duration', 0);
  return floor + (c0 - floor) * Math.exp(-time * flow / volume);
}

const treatmentScenarios = [
  { id: 'carbon', label: 'NSF/ANSI 53 carbon scenario', upfront: 45, annualBase: 75, wasteRatio: 0,
    removal: { lead: 0.90, pfoa: 0.75, pfos: 0.75 } },
  { id: 'ro', label: 'NSF/ANSI 58 reverse osmosis scenario', upfront: 280, annualBase: 105, wasteRatio: 2,
    removal: { lead: 0.95, pfoa: 0.90, pfos: 0.90, nitrate: 0.85, arsenic: 0.90 } },
];

export function compareTreatment(input, { litersPerDay, bottledPerLiter, waterPerLiter }) {
  const sample = normalizeSample(input);
  const use = parameter(litersPerDay, 'Daily liters', 0.01, 100);
  const bottled = parameter(bottledPerLiter, 'Bottled price', 0, 100);
  const tap = parameter(waterPerLiter, 'Tap-water price', 0, 100);
  const annualBottled = 365 * use * bottled;
  const filters = treatmentScenarios.map(({ id, label, upfront, annualBase, wasteRatio, removal }) => {
    const annualOperating = annualBase + 365 * use * tap * (1 + wasteRatio);
    // Keep month crossover exact. Multiplying two input decimals gives a scale of one squared.
    const annualSavings = 365n * units(String(litersPerDay).trim()) *
      (units(String(bottledPerLiter).trim()) - units(String(waterPerLiter).trim()) * BigInt(1 + wasteRatio)) -
      BigInt(annualBase) * one * one;
    const numerator = BigInt(12 * upfront) * one * one;
    const month = annualSavings > 0n ? (numerator + annualSavings - 1n) / annualSavings : null;
    const values = Object.fromEntries(Object.entries(sample.values).map(([key, value]) =>
      [key, value === null || !Object.hasOwn(removal, key) ? null : Number(value) * (1 - removal[key])]));
    return {
      id, label, upfront, annualOperating, annualFirstYear: upfront + annualOperating,
      paybackMonth: month !== null && month <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(month) :
        month?.toString() ?? null,
      values,
      removal: { ...removal },
    };
  });
  return { annualBottled, filters };
}
