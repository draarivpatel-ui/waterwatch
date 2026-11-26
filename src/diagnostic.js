// Contamination-source diagnostic and WHO reference comparison.
// Pure functions over the engine's screen output: no DOM, no network.
// Source wording follows the EPA National Primary Drinking Water
// Regulations table ("common sources of contaminant in drinking water");
// WHO values follow the Guidelines for drinking-water quality, fourth
// edition incorporating the first, second and third addenda (2026).

import { classifyPfasMixture } from './pfas-signal.js';

const SCALE = 16;
const decimal = /^[0-9]{1,9}(?:\.[0-9]{1,12})?$/;

function units(value) {
  const [whole, fractional = ''] = String(value).split('.');
  return BigInt(whole + fractional.padEnd(SCALE, '0'));
}

function compare(a, b) {
  return a > b ? 'above' : a === b ? 'at' : 'below';
}

// Nitrate is reported as N; WHO states 50 mg/L as the nitrate ion.
// Molar-mass convention: 50 * 14.0067 / 62.0049 = 11.294833... mg/L as N,
// rounded in display text to about 11.3 mg/L as N.
const NITRATE_ION = 620049n;
const NITROGEN = 140067n;

export const WHO_GUIDELINES = Object.freeze({
  lead: Object.freeze({ value: '10', text: 'WHO 10 ppb (provisional)', textEs: 'OMS 10 ppb (provisional)' }),
  copper: Object.freeze({ value: '2000', text: 'WHO 2000 ppb', textEs: 'OMS 2000 ppb' }),
  nitrate: Object.freeze({ value: '50', text: 'WHO 50 mg/L as nitrate (about 11.2948 as N)', textEs: 'OMS 50 mg/L como nitrato (aprox. 11,2948 como N)' }),
  arsenic: Object.freeze({ value: '10', text: 'WHO 10 ppb (provisional)', textEs: 'OMS 10 ppb (provisional)' }),
});

// Returns null when WHO sets no guideline value for the field, 'missing'
// when the reading is unreported, else the exact status against WHO.
export function whoStatus(id, value) {
  const guide = WHO_GUIDELINES[id];
  if (!guide) return null;
  if (value === null || value === undefined || value === '') return 'missing';
  const text = String(value).trim();
  if (!decimal.test(text)) throw new RangeError(`${id} requires a nonnegative decimal.`);
  if (id === 'nitrate') return compare(units(text) * NITRATE_ION, units(guide.value) * NITROGEN);
  return compare(units(text), units(guide.value));
}

export const SOURCE_HINTS = Object.freeze({
  lead: Object.freeze({
    text: 'Corrosion of household plumbing systems; erosion of natural deposits.',
    textEs: 'Corrosión de las tuberías domésticas; erosión de depósitos naturales.',
    cite: 'EPA drinking water regulations table',
    citeEs: 'tabla de normas de agua potable de la EPA',
  }),
  copper: Object.freeze({
    text: 'Corrosion of household plumbing systems; erosion of natural deposits; leaching from wood preservatives.',
    textEs: 'Corrosión de las tuberías domésticas; erosión de depósitos naturales; lixiviación de preservantes de madera.',
    cite: 'EPA drinking water regulations table',
    citeEs: 'tabla de normas de agua potable de la EPA',
  }),
  nitrate: Object.freeze({
    text: 'Runoff from fertilizer use; leaking from septic tanks and sewage; erosion of natural deposits.',
    textEs: 'Escorrentía por uso de fertilizantes; fugas de fosas sépticas y aguas residuales; erosión de depósitos naturales.',
    cite: 'EPA drinking water regulations table',
    citeEs: 'tabla de normas de agua potable de la EPA',
  }),
  arsenic: Object.freeze({
    text: 'Erosion of natural deposits; runoff from orchards; runoff from glass and electronics production wastes.',
    textEs: 'Erosión de depósitos naturales; escorrentía de huertos; escorrentía de residuales de producción de vidrio y electrónica.',
    cite: 'EPA drinking water regulations table',
    citeEs: 'tabla de normas de agua potable de la EPA',
  }),
  ecoli: Object.freeze({
    text: 'Human and animal fecal waste.',
    textEs: 'Materia fecal humana y animal.',
    cite: 'EPA drinking water regulations table',
    citeEs: 'tabla de normas de agua potable de la EPA',
  }),
  pfas: Object.freeze({
    text: 'Industrial releases, firefighting foam, and landfill or wastewater discharges.',
    textEs: 'Descargas industriales, espuma contra incendios y descargas de rellenos sanitarios o aguas residuales.',
    cite: 'EPA PFAS rule (2024)',
    citeEs: 'norma de PFAS de la EPA (2024)',
  }),
});

const ADVISORY_WORDS = { boil: 'boil', 'do-not-drink': 'do-not-drink', 'do-not-use': 'do-not-use' };
const ADVISORY_WORDS_ES = { boil: 'hervir el agua', 'do-not-drink': 'no beber el agua', 'do-not-use': 'no usar el agua' };
const PFAS_NAMES = Object.freeze({ pfhxs: 'PFHxS', pfna: 'PFNA', genx: 'GenX', pfbs: 'PFBS' });
const FLAGGED = new Set(['above', 'at']);
const PAIR_DRAWS = new Set(['first-draw', 'flushed']);

function sig3(n) {
  return String(Number(n.toPrecision(3)));
}

function sig3Es(n) {
  return sig3(n).replace('.', ',');
}

function esDecimal(value) {
  return String(value).replace('.', ',');
}

function listEn(items) {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0];
}

function listEs(items) {
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}` : items[0];
}

export function benchmarkRatio(result) {
  if (!result || result.value === null || result.limit === null) return null;
  return Number(result.value) / Number(result.limit);
}

function resultFor(screen, id) {
  return screen.results.find(result => result.id === id);
}

function leadPairContext(samples, sample, active) {
  if (!sample.pairId || !PAIR_DRAWS.has(sample.drawType) || sample.values?.lead == null) return null;
  const companions = samples
    .map((other, index) => ({ row: other, index }))
    .filter(({ row, index }) => index !== active
      && row.pairId === sample.pairId
      && PAIR_DRAWS.has(row.drawType)
      && row.values?.lead != null);
  const choose = drawType => {
    if (sample.drawType === drawType) return { row: sample, index: active };
    const matches = companions.filter(({ row }) => row.drawType === drawType);
    if (!matches.length) return null;
    return matches.reduce((best, item) =>
      (Number(item.row.values.lead) < Number(best.row.values.lead) ? item : best));
  };
  const first = choose('first-draw');
  const flushed = choose('flushed');
  return first && flushed ? { first, flushed } : null;
}

function leadAtOrAbove(value) {
  return units(String(value)) >= units('10');
}

function leadPairFinding(pair) {
  const firstText = pair.first.row.values.lead;
  const flushedText = pair.flushed.row.values.lead;
  const firstValue = Number(firstText);
  const flushedValue = Number(flushedText);
  const firstAt = leadAtOrAbove(firstText);
  const flushedAt = leadAtOrAbove(flushedText);
  if (!firstAt && !flushedAt) return null;
  const share = firstValue > 0 ? flushedValue / firstValue : 1;
  const dropPercent = Math.round((1 - share) * 100);
  const sharePercent = Math.round(share * 100);
  const firstTap = pair.first.row.tap;
  const flushedTap = pair.flushed.row.tap;
  if (flushedValue > firstValue) {
    return {
      id: 'lead-rises', tone: 'caution',
      title: 'Lead rises in the flushed draw',
      titleEs: 'El plomo aumenta en la extracción de purga',
      evidence: `Lead is ${flushedText} ppb in the flushed draw at ${flushedTap} after ${firstText} ppb in the first draw at ${firstTap}. The flushed draw rose above the first draw, pointing away from fixture-only stagnation and toward upstream supply or the service line.`,
      evidenceEs: `El plomo es ${esDecimal(flushedText)} ppb en la extracción de purga en ${flushedTap} después de ${esDecimal(firstText)} ppb en la primera extracción en ${firstTap}. La extracción de purga aumentó por encima de la primera extracción, lo que no concuerda con un estancamiento limitado al grifo y apunta al suministro aguas arriba o la línea de servicio.`,
      action: 'Share the paired draws with the water system and ask whether the service line or upstream supply could be contributing lead. Resample the pair before changing plumbing.',
      actionEs: 'Comparta las extracciones pareadas con el sistema de agua y pregunte si la línea de servicio o el suministro aguas arriba podrían aportar plomo. Vuelva a muestrear el par antes de cambiar plomería.',
    };
  }
  if (firstValue > flushedValue && firstAt && share <= 0.5) {
    if (flushedAt) {
      return {
        id: 'lead-local-shared', tone: 'caution',
        title: 'Lead points near the tap and beyond it',
        titleEs: 'El plomo apunta cerca del grifo y también más allá',
        evidence: `Lead falls from ${firstText} ppb in the first draw at ${firstTap} to ${flushedText} ppb in the flushed draw at ${flushedTap}, ${dropPercent}% lower. That large drop points strongly to plumbing near the tap or fixture, while the flushed draw remains at or above 10 ppb, so upstream or shared plumbing or corrosive water can also be contributing.`,
        evidenceEs: `El plomo baja de ${esDecimal(firstText)} ppb en la primera extracción en ${firstTap} a ${esDecimal(flushedText)} ppb en la extracción de purga en ${flushedTap}, un ${dropPercent}% menos. Esa caída grande apunta fuertemente a la plomería cercana al grifo o al accesorio, mientras que la extracción de purga sigue en 10 ppb o por encima, así que la plomería aguas arriba o compartida o el agua corrosiva también pueden estar aportando.`,
        action: 'Share the pair with the water system, check the faucet and nearby fixture plumbing, and ask about service lines, shared plumbing, and corrosion control. Resample the pair before changing plumbing.',
        actionEs: 'Comparta el par con el sistema de agua, revise el grifo y la plomería cercana del accesorio, y pregunte sobre líneas de servicio, plomería compartida y control de corrosión. Vuelva a muestrear el par antes de cambiar plomería.',
      };
    }
    return {
      id: 'lead-local', tone: 'caution',
      title: 'Lead points to plumbing near this tap',
      titleEs: 'El plomo apunta a la plomería cerca de este grifo',
      evidence: `Lead falls from ${firstText} ppb in the first draw at ${firstTap} to ${flushedText} ppb in the flushed draw at ${flushedTap}, ${dropPercent}% lower. The first draw is higher than the flushed draw, which points strongly to plumbing near the tap or fixture. Lead carried in by the source water would show up in both paired draws.`,
      evidenceEs: `El plomo baja de ${esDecimal(firstText)} ppb en la primera extracción en ${firstTap} a ${esDecimal(flushedText)} ppb en la extracción de purga en ${flushedTap}, un ${dropPercent}% menos. La primera extracción es más alta que la purga, lo que apunta fuertemente a la plomería cercana al grifo o al accesorio. El plomo traído por el agua de origen aparecería en ambas extracciones pareadas.`,
      action: 'Share the pair with the water system, check faucets, fixtures, and the service line, and resample. Flushing can lower lead but cannot guarantee it is gone.',
      actionEs: 'Comparta el par con el sistema de agua, revise grifos, accesorios y la línea de servicio, y vuelva a muestrear. Dejar correr el agua puede reducir el plomo, pero no garantiza que desaparezca.',
    };
  }
  if (firstAt && !flushedAt) {
    return {
      id: 'lead-drops-below', tone: 'caution',
      title: 'Flushed draw drops below the lead benchmark',
      titleEs: 'La extracción de purga baja del nivel de referencia de plomo',
      evidence: `Lead is ${firstText} ppb in the first draw at ${firstTap}, at or above the 10 ppb benchmark, but the flushed draw at ${flushedTap} is ${flushedText} ppb, below the benchmark. The flushed sample dropped below the benchmark, so the pair does not show lead staying high across both draws.`,
      evidenceEs: `El plomo es ${esDecimal(firstText)} ppb en la primera extracción en ${firstTap}, en el nivel de referencia de 10 ppb o por encima de él, pero la extracción de purga en ${flushedTap} es ${esDecimal(flushedText)} ppb, por debajo del nivel de referencia. La muestra de purga bajó por debajo del nivel de referencia, así que el par no muestra plomo alto en ambas extracciones.`,
      action: 'Share the pair with the water system and resample before treating one lower flushed result as a clearance. Flushing can lower lead but cannot guarantee it is gone.',
      actionEs: 'Comparta el par con el sistema de agua y vuelva a muestrear antes de tomar un resultado más bajo de purga como un visto bueno. Dejar correr el agua puede reducir el plomo, pero no garantiza que desaparezca.',
    };
  }
  if (firstAt && flushedAt) {
    return {
      id: 'lead-shared', tone: 'caution',
      title: 'Lead stays high across the paired draws',
      titleEs: 'El plomo sigue alto en las extracciones pareadas',
      evidence: `Lead is ${firstText} ppb in the first draw at ${firstTap} and ${flushedText} ppb in the flushed draw at ${flushedTap} (${sharePercent}% of the first draw). Both draws are at or above 10 ppb, so one fixture is unlikely to explain the pair. Shared plumbing or corrosive water fits better.`,
      evidenceEs: `El plomo es ${esDecimal(firstText)} ppb en la primera extracción en ${firstTap} y ${esDecimal(flushedText)} ppb en la extracción de purga en ${flushedTap} (${sharePercent}% de la primera extracción). Ambas extracciones están en 10 ppb o por encima, por lo que un solo accesorio difícilmente explica el par. Una plomería compartida o agua corrosiva concuerda mejor.`,
      action: 'Ask the water system about lead service lines and corrosion control, and resample a first-draw and flushed pair.',
      actionEs: 'Pregunte al sistema de agua sobre líneas de servicio de plomo y control de corrosión, y vuelva a muestrear un par de primera extracción y purga.',
    };
  }
  return null;
}

function mixtureWording(mix) {
  const classification = classifyPfasMixture(mix);
  const quantified = classification.quantifiedTerms;
  const qnames = quantified.map(term => PFAS_NAMES[term.id]);
  const missingNames = mix.missing.map(id => PFAS_NAMES[id]);
  const partialEn = mix.partial
    ? ` ${listEn(missingNames)} ${missingNames.length === 1 ? 'is' : 'are'} unreported, so this is a partial sum and a lower bound.`
    : '';
  const partialEs = mix.partial
    ? ` ${listEs(missingNames)} no ${missingNames.length === 1 ? 'está reportado' : 'están reportados'}, así que esta es una suma parcial y una cota inferior.`
    : '';
  if (classification.kind === 'multi-compound') {
    return {
      title: mix.partial ? 'Quantified PFAS mixture already passes the lower-bound screen' : 'Quantified PFAS mixture passes the Hazard Index screen',
      titleEs: mix.partial ? 'Una mezcla cuantificada de PFAS ya supera la evaluación de cota inferior' : 'Una mezcla cuantificada de PFAS supera la evaluación del Índice de Peligro',
      evidence: `${listEn(qnames)} are at or above their practical quantitation levels. The multi-constituent Hazard Index is ${mix.raw}, above 1. This is a ${classification.text.en} under EPA's multi-constituent mixture benchmark.${partialEn}`,
      evidenceEs: `${listEs(qnames)} están en sus niveles prácticos de cuantificación o por encima de ellos. El Índice de Peligro multiconstituyente es ${esDecimal(mix.raw)}, superior a 1. Esta es una ${classification.text.es} según el nivel multiconstituyente de la EPA.${partialEs}`,
    };
  }
  if (classification.kind === 'below-quantitation') {
    return {
      title: mix.partial ? 'Partial below-quantitation PFAS sum passes the screen' : 'Below-quantitation PFAS sum passes the screen',
      titleEs: mix.partial ? 'Una suma parcial de PFAS por debajo del nivel de cuantificación supera la evaluación' : 'Una suma de PFAS por debajo del nivel de cuantificación supera la evaluación',
      evidence: `None of the reported mixture constituents reached their EPA practical quantitation levels. The screening sum is ${mix.raw}, above 1, so it is a ${classification.text.en} only, not EPA's multi-constituent Hazard Index mixture.${partialEn}`,
      evidenceEs: `Ninguno de los constituyentes reportados de la mezcla alcanzó sus niveles prácticos de cuantificación de la EPA. La suma de evaluación es ${esDecimal(mix.raw)}, superior a 1, así que es solo una ${classification.text.es}, no la mezcla multiconstituyente del Índice de Peligro de la EPA.${partialEs}`,
    };
  }
  const driver = classification.driver;
  const driverName = PFAS_NAMES[driver.id];
  if (classification.kind === 'combined') {
    return {
      title: mix.partial ? 'Partial combined PFAS sum passes the screen' : 'Combined PFAS terms pass the screening sum',
      titleEs: mix.partial ? 'Una suma parcial combinada de PFAS supera la evaluación' : 'Términos combinados de PFAS superan la suma de evaluación',
      evidence: `${driverName} is the only mixture constituent at or above its practical quantitation level, but its own quotient is ${driver.quotient}, below 1. The reported screening sum is ${mix.raw}, above 1 because the other reported below-quantitation terms add the rest. This is a ${classification.text.en}, not EPA's multi-constituent Hazard Index mixture.${partialEn}`,
      evidenceEs: `${driverName} es el único constituyente de la mezcla en su nivel práctico de cuantificación o por encima de él, pero su propia proporción es ${esDecimal(driver.quotient)}, inferior a 1. La suma de evaluación reportada es ${esDecimal(mix.raw)}, superior a 1 porque los demás términos reportados por debajo del nivel de cuantificación aportan el resto. Esta es una ${classification.text.es}, no la mezcla multiconstituyente del Índice de Peligro de la EPA.${partialEs}`,
    };
  }
  return {
    title: mix.partial ? 'Partial PFAS sum passes the screen' : 'One PFAS drives the screening sum',
    titleEs: mix.partial ? 'Una suma parcial de PFAS supera la evaluación' : 'Un solo PFAS impulsa la suma de evaluación',
    evidence: `${driverName} is the only mixture constituent at or above its practical quantitation level, and its own quotient is ${driver.quotient}, at or above 1. The reported screening sum is ${mix.raw}, above 1. This is a ${classification.text.en}, not EPA's multi-constituent Hazard Index mixture.${partialEn}`,
    evidenceEs: `${driverName} es el único constituyente de la mezcla en su nivel práctico de cuantificación o por encima de él, y su propia proporción es ${esDecimal(driver.quotient)}, en 1 o por encima. La suma de evaluación reportada es ${esDecimal(mix.raw)}, superior a 1. Esta es una ${classification.text.es}, no la mezcla multiconstituyente del Índice de Peligro de la EPA.${partialEs}`,
  };
}

function advisoryWording(screen, nitrateHigh) {
  if (screen.action !== 'co-occurrence') {
    return {
      action: 'Follow the official notice before anything below. The patterns here are for follow-up with the water system.',
      actionEs: 'Siga el aviso oficial antes que cualquier paso posterior. Estos patrones sirven para dar seguimiento con el sistema de agua.',
    };
  }
  if (nitrateHigh) {
    return {
      action: 'Follow the official notice, but do not treat boiling as a chemical fix. Nitrate is at or above 10 mg/L as N in this sample, so boiling does not make this tap water safe for infant formula; use commercially bottled water or another approved source instead. The patterns here are for follow-up with the water system.',
      actionEs: 'Siga el aviso oficial, pero no trate el hervido como una solución química. El nitrato está en 10 mg/L como N o por encima de ese nivel en esta muestra, así que hervir no hace que esta agua del grifo sea segura para preparar fórmula infantil; use agua embotellada comercial u otra fuente aprobada en su lugar. Estos patrones sirven para dar seguimiento con el sistema de agua.',
    };
  }
  return {
    action: 'Follow the official notice, but do not treat boiling as a chemical fix. A heat-concentrating chemical risk is also present, so boiling does not make this tap water safe for drinking or infant formula; use commercially bottled water or another approved source unless local health officials approve a different source. The patterns here are for follow-up with the water system.',
    actionEs: 'Siga el aviso oficial, pero no trate el hervido como una solución química. También hay un riesgo químico que se concentra al hervir, así que hervir no hace que esta agua del grifo sea segura para beber ni para preparar fórmula infantil; use agua embotellada comercial u otra fuente aprobada salvo que las autoridades locales de salud aprueben otra fuente. Estos patrones sirven para dar seguimiento con el sistema de agua.',
  };
}

// One finding per pattern, most urgent first. Wording says "points to" and
// "fits": a single screen suggests where to look, it never proves a source.
export function diagnose({ samples, screens, active = 0 }) {
  if (!Array.isArray(samples) || !Array.isArray(screens)) return [];
  const sample = samples[active];
  const screen = screens[active];
  if (!sample || !screen) return [];
  const findings = [];
  const add = finding => findings.push(Object.freeze(finding));

  const nitrate = resultFor(screen, 'nitrate');
  const nitrateHigh = nitrate && FLAGGED.has(nitrate.status);

  if (ADVISORY_WORDS[sample.advisory]) {
    const wording = advisoryWording(screen, nitrateHigh);
    add({
      id: 'advisory', tone: 'urgent',
      title: 'A reported advisory comes first',
      titleEs: 'Un aviso reportado tiene prioridad',
      evidence: `A ${ADVISORY_WORDS[sample.advisory]} advisory was entered for this tap.`,
      evidenceEs: `Se ingresó un aviso de ${ADVISORY_WORDS_ES[sample.advisory]} para este grifo.`,
      action: wording.action,
      actionEs: wording.actionEs,
      cite: null,
    });
  }

  if (sample.ecoli === 'present') {
    add({
      id: 'fecal', tone: 'urgent',
      title: 'E. coli points to fecal contamination',
      titleEs: 'E. coli indica contaminación fecal',
      evidence: `E. coli is present in this sample.${nitrateHigh
        ? ` High nitrate in the same sample fits runoff, septic, or sewage water reaching the supply, as after a flood.`
        : ''}`,
      evidenceEs: `E. coli está presente en esta muestra.${nitrateHigh
        ? ` El nitrato alto en la misma muestra concuerda con agua de escorrentía, séptica o residual que llega al suministro, como después de una inundación.`
        : ''}`,
      action: 'Use bottled water for drinking and formula, and report the result to the water system and health department now.',
      actionEs: 'Use agua embotellada para beber y preparar fórmula, y reporte ahora el resultado al sistema de agua y al departamento de salud.',
      cite: SOURCE_HINTS.ecoli,
    });
  }

  if (nitrateHigh) {
    add({
      id: 'nitrate', tone: 'caution',
      title: 'Nitrate at or above the 10 mg/L as N MCL',
      titleEs: 'Nitrato en el MCL de 10 mg/L como N o por encima de él',
      evidence: `Nitrate is ${nitrate.value} mg/L as N, ${sig3(benchmarkRatio(nitrate))}x the MCL.`,
      evidenceEs: `El nitrato es ${esDecimal(nitrate.value)} mg/L como N, ${sig3Es(benchmarkRatio(nitrate))} veces el MCL.`,
      action: 'Do not use this water for infant formula. Boiling does not remove nitrate; it concentrates it as water evaporates.',
      actionEs: 'No use esta agua para preparar fórmula infantil. Hervir no elimina el nitrato; lo concentra a medida que el agua se evapora.',
      cite: SOURCE_HINTS.nitrate,
    });
  }

  const lead = resultFor(screen, 'lead');
  const leadPair = leadPairContext(samples, sample, active);
  if (leadPair) {
    const pairFinding = leadPairFinding(leadPair);
    if (pairFinding) add({ ...pairFinding, cite: SOURCE_HINTS.lead });
  } else if (lead && FLAGGED.has(lead.status)) {
    const others = samples
      .map((other, index) => ({ other, index }))
      .filter(({ other, index }) => index !== active && other.values?.lead != null);
    if (others.length) {
      const low = others.reduce((best, item) =>
        (Number(item.other.values.lead) < Number(best.other.values.lead) ? item : best));
      add({
        id: 'lead-contrast', tone: 'caution',
        title: 'Lead contrast cannot be tied to plumbing',
        titleEs: 'El contraste de plomo no puede vincularse a la plomería',
        evidence: `Lead is ${lead.value} ppb here. Another row, ${low.other.tap}, reads ${low.other.values.lead} ppb, but the rows do not carry matching first-draw and flushed pair metadata, so the contrast cannot separate local plumbing from source water.`,
        evidenceEs: `El plomo es ${esDecimal(lead.value)} ppb aquí. Otra fila, ${low.other.tap}, marca ${esDecimal(low.other.values.lead)} ppb, pero las filas no tienen metadatos pareados coincidentes de primera extracción y purga, así que el contraste no puede separar la plomería local del agua de origen.`,
        action: 'Collect a first-draw and flushed pair from this tap, or add matching pair_id and draw_type values before using the contrast.',
        actionEs: 'Recolecte un par de primera extracción y purga de este grifo, o agregue valores coincidentes de pair_id y draw_type antes de usar el contraste.',
        cite: SOURCE_HINTS.lead,
      });
    } else {
      add({
        id: 'lead-unpaired', tone: 'caution',
        title: 'Lead at or above the 10 ppb action level',
        titleEs: 'Plomo en el nivel de acción de 10 ppb o por encima de él',
        evidence: `Lead is ${lead.value} ppb, ${sig3(benchmarkRatio(lead))}x the action level. Without a paired draw, plumbing and source water cannot be told apart.`,
        evidenceEs: `El plomo es ${esDecimal(lead.value)} ppb, ${sig3Es(benchmarkRatio(lead))} veces el nivel de acción. Sin una extracción pareada, no se pueden distinguir la plomería y el agua de origen.`,
        action: 'Collect a first-draw and a flushed sample from this tap to separate plumbing from source water.',
        actionEs: 'Recolecte una muestra de primera extracción y una de purga de este grifo para separar la plomería del agua de origen.',
        cite: SOURCE_HINTS.lead,
      });
    }
  }

  const copper = resultFor(screen, 'copper');
  if (copper && FLAGGED.has(copper.status)) {
    add({
      id: 'copper', tone: 'caution',
      title: 'Copper points to corroding plumbing',
      titleEs: 'El cobre apunta a plomería con corrosión',
      evidence: `Copper is ${copper.value} ppb, ${sig3(benchmarkRatio(copper))}x the 1300 ppb action level. Copper builds up while water sits in copper pipes.`,
      evidenceEs: `El cobre es ${esDecimal(copper.value)} ppb, ${sig3Es(benchmarkRatio(copper))} veces el nivel de acción de 1300 ppb. El cobre se acumula mientras el agua permanece en tuberías de cobre.`,
      action: 'Ask the water system about corrosion control and resample after the water has run.',
      actionEs: 'Pregunte al sistema de agua sobre el control de corrosión y vuelva a muestrear después de dejar correr el agua.',
      cite: SOURCE_HINTS.copper,
    });
  }

  const arsenic = resultFor(screen, 'arsenic');
  if (arsenic && FLAGGED.has(arsenic.status)) {
    add({
      id: 'arsenic', tone: 'caution',
      title: 'Arsenic at or above the 10 ppb MCL',
      titleEs: 'Arsénico en el MCL de 10 ppb o por encima de él',
      evidence: `Arsenic is ${arsenic.value} ppb, ${sig3(benchmarkRatio(arsenic))}x the MCL. It often comes from natural deposits in the ground.`,
      evidenceEs: `El arsénico es ${esDecimal(arsenic.value)} ppb, ${sig3Es(benchmarkRatio(arsenic))} veces el MCL. A menudo proviene de depósitos naturales en el suelo.`,
      action: 'Test the source itself, and ask the lab which arsenic form is present before choosing treatment.',
      actionEs: 'Analice la fuente misma y pregunte al laboratorio qué forma de arsénico está presente antes de elegir un tratamiento.',
      cite: SOURCE_HINTS.arsenic,
    });
  }

  const singles = ['pfoa', 'pfos', 'pfhxs', 'pfna', 'genx']
    .map(id => resultFor(screen, id))
    .filter(result => result && FLAGGED.has(result.status));
  if (singles.length) {
    add({
      id: 'pfas-single', tone: 'caution',
      title: 'PFAS at or above an individual MCL',
      titleEs: 'PFAS en un MCL individual o por encima de él',
      evidence: `${singles.map(result => `${result.label} ${result.value} ppt (${sig3(benchmarkRatio(result))}x)`).join(', ')}.`,
      evidenceEs: `${singles.map(result => `${result.label} ${esDecimal(result.value)} ppt (${sig3Es(benchmarkRatio(result))} veces)`).join(', ')}.`,
      action: 'Boiling does not remove PFAS. Share the result with the water system; a filter only counts where its own certification covers these compounds.',
      actionEs: 'Hervir no elimina los PFAS. Comparta el resultado con el sistema de agua; un filtro solo cuenta cuando su propia certificación cubre estos compuestos.',
      cite: SOURCE_HINTS.pfas,
    });
  }

  const mix = screen.mixture;
  if (mix && ['above', 'above-lower-bound'].includes(mix.status)) {
    const wording = mixtureWording(mix);
    add({
      id: 'pfas-mixture', tone: 'caution',
      title: wording.title,
      titleEs: wording.titleEs,
      evidence: wording.evidence,
      evidenceEs: wording.evidenceEs,
      action: 'Boiling does not remove PFAS. Ask the water system for its running annual average; one sample is a screen, not a violation.',
      actionEs: 'Hervir no elimina los PFAS. Pida al sistema de agua su promedio anual móvil; una muestra es una evaluación, no una infracción.',
      cite: SOURCE_HINTS.pfas,
    });
  }

  if (!findings.length) {
    if (screen.unknowns.length) {
      add({
        id: 'unknown', tone: 'info',
        title: 'The pattern check is limited',
        titleEs: 'La revisión de patrones es limitada',
        evidence: `${screen.unknowns.length} field${screen.unknowns.length === 1 ? ' is' : 's are'} unreported, so a hidden pattern cannot be ruled out.`,
        evidenceEs: `${screen.unknowns.length} ${screen.unknowns.length === 1 ? 'campo no está reportado' : 'campos no están reportados'}, así que no se puede descartar un patrón oculto.`,
        action: 'Ask the lab for the missing fields before treating this tap as screened.',
        actionEs: 'Pida al laboratorio los campos faltantes antes de considerar evaluado este grifo.',
        cite: null,
      });
    } else {
      add({
        id: 'clear', tone: 'clear',
        title: 'No contamination pattern in these readings',
        titleEs: 'Sin patrón de contaminación en estas lecturas',
        evidence: 'Every reported reading with an individual benchmark is below it. Only the measured fields were checked.',
        evidenceEs: 'Cada lectura reportada con un nivel individual está por debajo de él. Solo se revisaron los campos medidos.',
        action: 'Keep the routine sampling schedule and retest after plumbing work, flooding, or a change in taste or color.',
        actionEs: 'Mantenga el calendario habitual de muestreo y repita la prueba después de trabajos de plomería, inundaciones o un cambio de sabor o color.',
        cite: null,
      });
    }
  }
  return findings;
}

/* ---------- scenario summary for the preset cards ---------- */

const SCENARIO_NAMES = {
  lead: 'Lead', copper: 'Copper', nitrate: 'Nitrate', arsenic: 'Arsenic',
  pfoa: 'PFOA', pfos: 'PFOS', pfhxs: 'PFHxS', pfna: 'PFNA', genx: 'GenX',
  'hazard-index': 'PFAS mixture',
};
const ADVISORY_NOTICE = { boil: 'Boil notice', 'do-not-drink': 'Do-not-drink notice', 'do-not-use': 'Do-not-use notice' };

// Each scenario card states its own screened result, computed from the
// scenario data with the same engine as the report.
export function summarizeScenario({ samples, screens }) {
  const advisory = ['do-not-use', 'do-not-drink', 'boil']
    .find(level => samples.some(sample => sample.advisory === level));
  const ecoli = samples.some(sample => sample.ecoli === 'present');
  const flagged = [];
  for (const screen of screens) {
    for (const id of screen.chemicals) if (!flagged.includes(id)) flagged.push(id);
  }
  const flaggedTaps = screens.filter(screen => screen.chemicals.length).length;
  if (advisory || ecoli) {
    return {
      tone: 'urgent', icon: 'mark-above',
      text: [advisory ? ADVISORY_NOTICE[advisory] : null, ecoli ? 'E. coli present' : null].filter(Boolean).join(', '),
    };
  }
  if (flagged.length) {
    const names = flagged.slice(0, 2).map(id => SCENARIO_NAMES[id] ?? id).join(' and ');
    return {
      tone: 'caution', icon: 'mark-at',
      text: flaggedTaps < samples.length
        ? `${names} above in ${flaggedTaps} of ${samples.length} taps`
        : `${names} above benchmark`,
    };
  }
  if (screens.some(screen => screen.unknowns.length)) {
    return { tone: 'pending', icon: 'mark-missing', text: 'Some fields unreported' };
  }
  return { tone: 'clear', icon: 'mark-below', text: 'Within screened benchmarks' };
}
