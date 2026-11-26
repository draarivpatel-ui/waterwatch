// Contamination-source diagnostic and WHO reference comparison.
// Pure functions over the engine's screen output: no DOM, no network.
// Source wording follows the EPA National Primary Drinking Water
// Regulations table ("common sources of contaminant in drinking water");
// WHO values follow the Guidelines for drinking-water quality, fourth
// edition incorporating the first and second addenda (2022).

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
// Molar masses: NO3 62.0049 g/mol, N 14.0067 g/mol.
const NITRATE_ION = 620049n;
const NITROGEN = 140067n;

export const WHO_GUIDELINES = Object.freeze({
  lead: Object.freeze({ value: '10', text: 'WHO 10 ppb (provisional)' }),
  copper: Object.freeze({ value: '2000', text: 'WHO 2000 ppb' }),
  nitrate: Object.freeze({ value: '50', text: 'WHO 50 mg/L as nitrate (about 11.3 as N)' }),
  arsenic: Object.freeze({ value: '10', text: 'WHO 10 ppb (provisional)' }),
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
  lead: Object.freeze({ text: 'Corrosion of household plumbing systems; erosion of natural deposits.', cite: 'EPA drinking water regulations table' }),
  copper: Object.freeze({ text: 'Corrosion of household plumbing systems; erosion of natural deposits; leaching from wood preservatives.', cite: 'EPA drinking water regulations table' }),
  nitrate: Object.freeze({ text: 'Runoff from fertilizer use; leaking from septic tanks and sewage; erosion of natural deposits.', cite: 'EPA drinking water regulations table' }),
  arsenic: Object.freeze({ text: 'Erosion of natural deposits; runoff from orchards; runoff from glass and electronics production wastes.', cite: 'EPA drinking water regulations table' }),
  ecoli: Object.freeze({ text: 'Human and animal fecal waste.', cite: 'EPA drinking water regulations table' }),
  pfas: Object.freeze({ text: 'Industrial releases, firefighting foam, and landfill or wastewater discharges.', cite: 'EPA PFAS rule (2024)' }),
});

const ADVISORY_WORDS = { boil: 'boil', 'do-not-drink': 'do-not-drink', 'do-not-use': 'do-not-use' };
const FLAGGED = new Set(['above', 'at']);

function sig3(n) {
  return String(Number(n.toPrecision(3)));
}

export function benchmarkRatio(result) {
  if (!result || result.value === null || result.limit === null) return null;
  return Number(result.value) / Number(result.limit);
}

function resultFor(screen, id) {
  return screen.results.find(result => result.id === id);
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

  if (ADVISORY_WORDS[sample.advisory]) {
    add({
      id: 'advisory', tone: 'urgent',
      title: 'A reported advisory comes first',
      titleEs: 'Un aviso reportado tiene prioridad',
      evidence: `A ${ADVISORY_WORDS[sample.advisory]} advisory was entered for this tap.`,
      action: 'Follow the official notice before anything below. The patterns here are for follow-up with the water system.',
      cite: null,
    });
  }

  const nitrate = resultFor(screen, 'nitrate');
  const nitrateHigh = nitrate && FLAGGED.has(nitrate.status);

  if (sample.ecoli === 'present') {
    add({
      id: 'fecal', tone: 'urgent',
      title: 'E. coli points to fecal contamination',
      titleEs: 'E. coli indica contaminación fecal',
      evidence: `E. coli is present in this sample.${nitrateHigh
        ? ` High nitrate in the same sample fits runoff, septic, or sewage water reaching the supply, as after a flood.`
        : ''}`,
      action: 'Use bottled water for drinking and formula, and report the result to the water system and health department now.',
      cite: SOURCE_HINTS.ecoli,
    });
  }

  if (nitrateHigh) {
    add({
      id: 'nitrate', tone: 'caution',
      title: 'Nitrate at or above the 10 mg/L as N MCL',
      titleEs: 'Nitrato en el MCL de 10 mg/L como N o por encima de él',
      evidence: `Nitrate is ${nitrate.value} mg/L as N, ${sig3(benchmarkRatio(nitrate))}x the MCL.`,
      action: 'Do not use this water for infant formula. Boiling does not remove nitrate; it concentrates it as water evaporates.',
      cite: SOURCE_HINTS.nitrate,
    });
  }

  const lead = resultFor(screen, 'lead');
  if (lead && FLAGGED.has(lead.status)) {
    const here = Number(lead.value);
    const others = samples
      .map((other, index) => ({ other, index }))
      .filter(({ other, index }) => index !== active && other.values?.lead != null);
    if (others.length) {
      const low = others.reduce((best, item) =>
        (Number(item.other.values.lead) < Number(best.other.values.lead) ? item : best));
      const lowValue = Number(low.other.values.lead);
      const share = here > 0 ? lowValue / here : 1;
      if (share <= 0.5) {
        add({
          id: 'lead-local', tone: 'caution',
          title: 'Lead points to plumbing near this tap',
          titleEs: 'El plomo apunta a la plomería cerca de este grifo',
          evidence: `Lead is ${lead.value} ppb here but ${low.other.values.lead} ppb at ${low.other.tap}, ${Math.round((1 - share) * 100)}% lower in the same data set. Lead carried in by the source water would show up at every tap.`,
          action: 'Share the pair with the water system, check faucets, fixtures, and the service line, and resample. Flushing can lower lead but cannot guarantee it is gone.',
          cite: SOURCE_HINTS.lead,
        });
      } else {
        add({
          id: 'lead-shared', tone: 'caution',
          title: 'Lead stays high across the taps tested',
          titleEs: 'El plomo sigue alto en los grifos analizados',
          evidence: `The lowest other tap, ${low.other.tap}, still reads ${low.other.values.lead} ppb (${Math.round(share * 100)}% of this tap), so one fixture is unlikely to explain it. A shared service line or corrosive water fits better.`,
          action: 'Ask the water system about lead service lines and corrosion control, and resample a first-draw and flushed pair.',
          cite: SOURCE_HINTS.lead,
        });
      }
    } else {
      add({
        id: 'lead-unpaired', tone: 'caution',
        title: 'Lead at or above the 10 ppb action level',
        titleEs: 'Plomo en el nivel de acción de 10 ppb o por encima de él',
        evidence: `Lead is ${lead.value} ppb, ${sig3(benchmarkRatio(lead))}x the action level. With one tap, plumbing and source water cannot be told apart.`,
        action: 'Collect a first-draw and a flushed sample from this tap to separate plumbing from source water.',
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
      action: 'Ask the water system about corrosion control and resample after the water has run.',
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
      action: 'Test the source itself, and ask the lab which arsenic form is present before choosing treatment.',
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
      action: 'Boiling does not remove PFAS. Share the result with the water system; a filter only counts where its own certification covers these compounds.',
      cite: SOURCE_HINTS.pfas,
    });
  }

  const mix = screen.mixture;
  if (mix && ['above', 'above-lower-bound'].includes(mix.status)) {
    add({
      id: 'pfas-mixture', tone: 'caution',
      title: 'Several PFAS add up past the Hazard Index',
      titleEs: 'Varios PFAS juntos superan el Índice de Peligro',
      evidence: singles.length
        ? `The Hazard Index is ${mix.raw}${mix.status === 'above-lower-bound' ? ' even before the unreported terms' : ''}, above 1.`
        : `No single PFAS is above its own MCL, yet PFHxS, PFNA, GenX, and PFBS together give a Hazard Index of ${mix.raw}${mix.status === 'above-lower-bound' ? ' even before the unreported terms' : ''}, above 1.`,
      action: 'Boiling does not remove PFAS. Ask the water system for its running annual average; one sample is a screen, not a violation.',
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
        action: 'Ask the lab for the missing fields before treating this tap as screened.',
        cite: null,
      });
    } else {
      add({
        id: 'clear', tone: 'clear',
        title: 'No contamination pattern in these readings',
        titleEs: 'Sin patrón de contaminación en estas lecturas',
        evidence: 'Every reported reading with an individual benchmark is below it. Only the measured fields were checked.',
        action: 'Keep the routine sampling schedule and retest after plumbing work, flooding, or a change in taste or color.',
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
