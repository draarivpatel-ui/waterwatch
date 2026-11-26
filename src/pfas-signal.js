const KIND_TEXT = Object.freeze({
  'below-quantitation': Object.freeze({
    csv: 'PFAS below-quantitation screening sum',
    en: 'below-quantitation screening signal',
    es: 'señal de evaluación por debajo del nivel de cuantificación',
    enNoun: 'below-quantitation screening sum',
    esNoun: 'suma de evaluación por debajo del nivel de cuantificación',
  }),
  'single-compound': Object.freeze({
    csv: 'PFAS single-compound screening signal',
    en: 'single-compound screening signal',
    es: 'señal de evaluación de un solo compuesto',
    enNoun: 'single-compound screening sum',
    esNoun: 'suma de evaluación de un solo compuesto',
  }),
  combined: Object.freeze({
    csv: 'PFAS combined screening signal',
    en: 'combined screening signal (one quantified constituent plus below-quantitation terms)',
    es: 'señal de evaluación combinada (un constituyente cuantificado más términos por debajo del nivel de cuantificación)',
    enNoun: 'combined screening sum (one quantified constituent plus below-quantitation terms)',
    esNoun: 'suma de evaluación combinada (un constituyente cuantificado más términos por debajo del nivel de cuantificación)',
  }),
  'multi-compound': Object.freeze({
    csv: 'PFAS multi-compound mixture signal',
    en: 'multi-compound mixture signal',
    es: 'señal de mezcla de varios compuestos',
    enNoun: 'multi-compound mixture Hazard Index',
    esNoun: 'Índice de Peligro de mezcla de varios compuestos',
  }),
  incomplete: Object.freeze({
    csv: 'PFAS incomplete screening sum',
    en: 'incomplete screening sum',
    es: 'suma de evaluación incompleta',
    enNoun: 'incomplete screening sum',
    esNoun: 'suma de evaluación incompleta',
  }),
});

function atLeastOne(decimalText) {
  if (decimalText === null || decimalText === undefined) return false;
  const [whole = '0'] = String(decimalText).split('.');
  return BigInt(whole || '0') >= 1n;
}

export function classifyPfasMixture(mix) {
  const terms = Array.isArray(mix?.terms) ? mix.terms : [];
  const positiveTerms = terms.filter(term =>
    term.quotient !== null && term.quotient !== undefined && Number(term.quotient) > 0);
  const quantifiedTerms = terms.filter(term =>
    term.quantified && term.quotient !== null && term.quotient !== undefined && Number(term.quotient) > 0);
  let kind = 'incomplete';
  if (mix?.raw !== null && mix?.raw !== undefined) {
    if (quantifiedTerms.length === 0) kind = 'below-quantitation';
    else if (quantifiedTerms.length >= 2) kind = 'multi-compound';
    else if (!atLeastOne(quantifiedTerms[0].quotient) && positiveTerms.length > 1) kind = 'combined';
    else kind = 'single-compound';
  }
  const raw = mix?.raw ?? null;
  return Object.freeze({
    kind,
    text: KIND_TEXT[kind],
    quantifiedTerms: Object.freeze(quantifiedTerms.slice()),
    quantifiedCount: quantifiedTerms.length,
    driver: quantifiedTerms.length === 1 ? quantifiedTerms[0] : null,
    epaMixture: quantifiedTerms.length >= 2,
    partial: Boolean(mix?.partial),
    raw,
    total: raw === null ? null : Number(raw),
    meetsBenchmark: raw !== null && atLeastOne(raw),
  });
}
