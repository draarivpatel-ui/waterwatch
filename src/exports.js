import { normalizeSample, screenSample } from './engine.js';
import { classifyPfasMixture } from './pfas-signal.js';
import { sha256Hex } from './sha256.js';

export const RULESET = 'epa-2024-sample-screen-v1';

function isBoxedBy(value, extractor) {
  try {
    return { value: extractor.call(value) };
  } catch {
    return null;
  }
}

// Preserve JSON.stringify's value semantics while emitting sorted own object keys.
export function canonicalJson(value) {
  const stack = new Set();

  function serialize(holder, key) {
    let item = holder[key];
    const type = typeof item;
    if (item !== null && (type === 'object' || type === 'function' || type === 'bigint')) {
      const hook = item.toJSON;
      if (typeof hook === 'function') item = Reflect.apply(hook, item, [key]);
    }
    if (item !== null && typeof item === 'object') {
      if (isBoxedBy(item, Number.prototype.valueOf)) item = +item;
      else if (isBoxedBy(item, String.prototype.valueOf)) item = `${item}`;
      else {
        const boolean = isBoxedBy(item, Boolean.prototype.valueOf);
        const integer = isBoxedBy(item, BigInt.prototype.valueOf);
        if (boolean) item = boolean.value;
        if (integer) item = integer.value;
      }
    }
    if (item === null || typeof item !== 'object') return JSON.stringify(item);
    if (stack.has(item)) throw new TypeError('Cannot serialize cyclic JSON.');
    stack.add(item);
    let result;
    if (Array.isArray(item)) {
      const elements = [];
      const length = Math.min(Math.max(0, Math.trunc(+item.length) || 0), Number.MAX_SAFE_INTEGER);
      for (let i = 0; i < length; i += 1) elements.push(serialize(item, String(i)) ?? 'null');
      result = `[${elements.join(',')}]`;
    } else {
      const entries = [];
      for (const name of Object.keys(item)) {
        const serialized = serialize(item, name);
        if (serialized !== undefined) entries.push([name, serialized]);
      }
      entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
      result = `{${entries.map(([name, serialized]) => `${JSON.stringify(name)}:${serialized}`).join(',')}}`;
    }
    stack.delete(item);
    return result;
  }

  return serialize({ '': value }, '');
}

const formulaStart = /^(?:[\p{White_Space}\p{Cc}\p{Cf}]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|[\t\r\n])/u;

export function csvCell(value) {
  const original = value == null ? '' : String(value);
  const safe = formulaStart.test(original) ? `'${original}` : original;
  return `"${safe.replace(/"/g, '""')}"`;
}

function snapshots(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new RangeError('No samples to export.');
  const out = [];
  for (let i = 0; i < samples.length; i += 1) {
    const sample = normalizeSample(samples[i]);
    out.push({ sample, screen: screenSample(sample) });
  }
  return out;
}

function auditSource(source) {
  if (source !== 'synthetic' && source !== 'unverified-input') {
    throw new RangeError('Export source must be synthetic or unverified-input.');
  }
  return source;
}

function mixtureAuditLabel(hi) {
  return classifyPfasMixture(hi).text.csv;
}

export function auditCsv(samples, { source = 'unverified-input' } = {}) {
  const origin = auditSource(source);
  const rows = [[
    'tap', 'reported_advisory', 'ecoli_result', 'recommended_review', 'measurement', 'value', 'unit',
    'benchmark', 'benchmark_type', 'exact_screen', 'rounded_context', 'rounded_screen_context', 'scope', 'source',
  ]];
  for (const { sample, screen } of snapshots(samples)) {
    const identity = [sample.tap, sample.advisory, sample.ecoli, screen.action];
    const scope = 'Single-sample educational screen; not a compliance or potability determination.';
    for (const result of screen.results) {
      rows.push([...identity, result.label, result.value, result.unit, result.limit, result.kind, result.status,
        result.rounded, result.roundedStatus, scope, origin]);
    }
    rows.push([...identity, 'Lead (legacy)', sample.values.lead, 'ppb', '15', 'legacy action level',
      screen.legacyLead, null, null, scope, origin]);
    const hi = screen.mixture;
    rows.push([...identity, mixtureAuditLabel(hi), hi.raw, 'unitless', '1', '2024 rule screening context',
      hi.status, hi.rounded, hi.roundedStatus,
      hi.missing.length ? `${scope} Unreported constituents: ${hi.missing.join(' ')}.` : scope, origin]);
  }
  return `${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export async function buildBundle(samples, { source = 'unverified-input' } = {}) {
  const payload = {
    schema: 'waterwatch/v1',
    ruleset: RULESET,
    scope: 'Single-sample educational screening only. Not a regulatory compliance or potability determination.',
    source: auditSource(source),
    samples: snapshots(samples),
  };
  const bytes = new TextEncoder().encode(canonicalJson(payload));
  let fingerprint;
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } else {
    // Plain HTTP on a LAN is not a secure context, so WebCrypto can be absent
    // even though the application is fully offline. Keep fingerprinted
    // exports available with the same local SHA-256 implementation the lab
    // uses; no network or native dependency is introduced.
    fingerprint = sha256Hex(bytes);
  }
  return { fingerprint, payload };
}
