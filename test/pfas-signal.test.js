import assert from 'node:assert/strict';
import test from 'node:test';
import { screenSample } from '../src/engine.js';
import { classifyPfasMixture } from '../src/pfas-signal.js';

function mixture(values) {
  return screenSample({ tap: 'T', advisory: 'none', ecoli: 'absent', values }).mixture;
}

test('zero quantified constituents classify the 1.197 sum as below quantitation', () => {
  const hi = mixture({ pfhxs: '2.99', pfna: '3.99', genx: '4.99', pfbs: '0' });
  const classification = classifyPfasMixture(hi);
  assert.equal(hi.raw, '1.197');
  assert.equal(classification.kind, 'below-quantitation');
  assert.equal(classification.quantifiedCount, 0);
  assert.equal(classification.text.csv, 'PFAS below-quantitation screening sum');
  assert.match(classification.text.en, /below-quantitation screening signal/);
  assert.doesNotMatch(classification.text.en, /single-compound/);
});

test('one quantified constituent below 1 plus sub-quantitation terms is combined', () => {
  const hi = mixture({ pfhxs: '3.00', pfna: '3.99', genx: '4.99', pfbs: '0' });
  const classification = classifyPfasMixture(hi);
  assert.equal(hi.raw, '1.198');
  assert.equal(classification.kind, 'combined');
  assert.equal(classification.quantifiedCount, 1);
  assert.equal(classification.driver.id, 'pfhxs');
  assert.equal(classification.driver.quotient, '0.3');
  assert.match(classification.text.en, /combined screening signal \(one quantified constituent plus below-quantitation terms\)/);
  assert.doesNotMatch(classification.text.en, /single-compound/);
});

test('one quantified constituent at or above 1 alone is the single-compound driver', () => {
  const hi = mixture({ pfhxs: '0', pfna: '0', genx: '0', pfbs: '5000' });
  const classification = classifyPfasMixture(hi);
  assert.equal(classification.kind, 'single-compound');
  assert.equal(classification.driver.id, 'pfbs');
  assert.equal(classification.driver.quotient, '2.5');
});

test('two quantified constituents classify as a multi-compound mixture signal', () => {
  const hi = mixture({ pfhxs: '6', pfna: '5', genx: '0', pfbs: '0' });
  const classification = classifyPfasMixture(hi);
  assert.equal(classification.kind, 'multi-compound');
  assert.equal(classification.quantifiedCount, 2);
  assert.equal(classification.epaMixture, true);
});

test('unreported and empty mixtures never invent a driver', () => {
  assert.equal(classifyPfasMixture(mixture({})).kind, 'incomplete');
  const partial = classifyPfasMixture(mixture({ pfhxs: '2.99', pfna: '3.99' }));
  assert.equal(partial.kind, 'below-quantitation');
  assert.equal(partial.driver, null);
});
