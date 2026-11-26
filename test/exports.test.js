import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { auditCsv, buildBundle, canonicalJson, csvCell } from '../src/exports.js';

const sample = (tap = 'Sink') => ({
  tap, advisory: 'boil', ecoli: 'present',
  values: { pfoa: '4.001', lead: '10.001', nitrate: '13.6', pfhxs: '6', pfna: '5', genx: '0', pfbs: '0' },
});

for (const [input, expected] of [
  [undefined, undefined], [null, 'null'], [false, 'false'], ['\uD800', '"\\ud800"'], [-0, '0'],
  [NaN, 'null'], [Infinity, 'null'], [Symbol('skip'), undefined], [() => {}, undefined],
  [new Number(9), '9'], [new String('sample'), '"sample"'], [new Boolean(false), 'false'],
  [Object(Symbol('boxed')), '{}'], [Object.create(null), '{}'],
  [{ toJSON() { return undefined; } }, undefined],
  [{ z: { toJSON() { return undefined; } }, a: 1 }, '{"a":1}'],
  [[{ toJSON() { return undefined; } }, undefined], '[null,null]'],
  [{ z: [1, undefined, null], a: { z: 2, a: 1 } }, '{"a":{"a":1,"z":2},"z":[1,null,null]}'],
  [{ 2: 'b', 10: 'a', 1: 'c' }, '{"1":"c","10":"a","2":"b"}'],
  [new Date('2024-11-01T00:00:00Z'), '"2024-11-01T00:00:00.000Z"'],
  [JSON.parse('{"z":0,"__proto__":{"a":1}}'), '{"__proto__":{"a":1},"z":0}'],
]) {
  test(`canonical value case ${expected ?? typeof input}`, () => assert.equal(canonicalJson(input), expected));
}

test('canonical hooks see their standard key, this, and a single property lookup', () => {
  let reads = 0;
  const value = {
    get toJSON() {
      reads += 1;
      const hook = function (key) { return this === value ? key : 'wrong this'; };
      hook.call = 'not Function.call';
      return hook;
    },
  };
  assert.equal(canonicalJson([value, { record: value }]), '["0",{"record":"record"}]');
  assert.equal(reads, 2);
});

test('array length is captured before each hook runs, as in JSON.stringify', () => {
  const array = [{ toJSON() { array.push('later'); return 'first'; } }];
  assert.equal(canonicalJson(array), '["first"]');
});

test('array proxy length is converted to an integer exactly once', () => {
  let conversions = 0;
  const array = new Proxy(['first', 'second'], {
    get(target, key, receiver) {
      return key === 'length' ? { valueOf() { conversions += 1; return 1.9; } } : Reflect.get(target, key, receiver);
    },
  });
  assert.equal(canonicalJson(array), '["first"]');
  assert.equal(conversions, 1);
});

test('getter evaluation keeps ECMAScript enumeration order, independent of emitted key order', () => {
  const reads = [];
  const input = {
    get last() { reads.push('last'); return 1; },
    get first() { reads.push('first'); return 0; },
  };
  assert.equal(canonicalJson(input), '{"first":0,"last":1}');
  assert.deepEqual(reads, ['last', 'first']);
});

test('enumerable own fields only and sparse array semantics', () => {
  const item = Object.create({ inherited: 5 }, { hidden: { value: 2 } });
  item.only = [];
  item.only.length = 3;
  item.only[1] = 'middle';
  item[Symbol('excluded')] = 6;
  assert.equal(canonicalJson(item), '{"only":[null,"middle",null]}');
});

test('shared references are not mistaken for cycles', () => {
  const record = { value: 42 };
  assert.equal(canonicalJson([record, record]), '[{"value":42},{"value":42}]');
});

test('cycles and unadapted BigInt throw rather than emitting a misleading fingerprint', () => {
  const item = {};
  item.item = item;
  assert.throws(() => canonicalJson(item), TypeError);
  assert.throws(() => canonicalJson(1n), TypeError);
  assert.throws(() => canonicalJson(Object(1n)), TypeError);
});

for (const field of ['=1+2', '+3', '-7', '@sum(1)', '\tinput', '\rinput', '\ninput', ' \t=1',
  '\u00A0+5', '\u200B@place', '\uFF1D1', '\uFF0B1', '\uFF0D1', '\uFF201']) {
  test(`CSV protects formula-like cell ${JSON.stringify(field)}`, () => {
    assert.equal(csvCell(field), `"'${field}"`);
  });
}

for (const [value, expected] of [[null, '""'], ['Quoted "Tap", 3', '"Quoted ""Tap"", 3"'],
  ['7.001', '"7.001"'], ['Ordinary tap', '"Ordinary tap"'], ['A+1', '"A+1"']]) {
  test(`ordinary CSV quoting for ${value}`, () => assert.equal(csvCell(value), expected));
}

test('audit includes a lossless row for every screened item, including exact and rounded conflict', () => {
  const csv = auditCsv([sample('=1+2'), sample('Safe label')]);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines.length, 25);
  assert.ok(lines[1].startsWith(`"'=1+2","boil","present","co-occurrence","Lead"`));
  assert.match(csv, /"PFOA","4.001","ppt","4.0","MCL","above","4.0","at"/);
  assert.match(csv, /"Lead \(legacy\)","10.001","ppb","15","legacy action level","below"/);
  assert.match(csv, /"PFAS mixture Hazard Index","1.1","unitless","1","2024 rule screening context","above","1","at"/);
  assert.match(csv, /not a compliance or potability determination/i);
});

test('audit CSV labels below-quantitation, single-compound, and true mixture sums accurately', () => {
  const below = auditCsv([{ tap: 'Below PQL', advisory: 'none', ecoli: 'absent',
    values: { pfhxs: '2.99', pfna: '3.99', genx: '4.99', pfbs: '0' } }]);
  assert.match(below, /"PFAS below-quantitation screening sum","1\.197","unitless","1"/);
  assert.doesNotMatch(below, /"PFAS mixture Hazard Index","1\.197"/);
  const single = auditCsv([{ tap: 'PFBS only', advisory: 'none', ecoli: 'absent',
    values: { pfhxs: '0', pfna: '0', genx: '0', pfbs: '5000' } }]);
  assert.match(single, /"PFAS single-compound screening signal","2\.5","unitless","1"/);
  assert.doesNotMatch(single, /"PFAS mixture Hazard Index","2\.5"/);
  const mixture = auditCsv([sample()]);
  assert.match(mixture, /"PFAS mixture Hazard Index","1\.1","unitless","1"/);
});

test('fingerprint is SHA-256 of canonical payload UTF-8 bytes and preserves exact data', async () => {
  const result = await buildBundle([sample('Toma \u00C1')]);
  assert.equal(result.payload.samples[0].sample.values.pfoa, '4.001');
  assert.equal(result.payload.samples[0].screen.action, 'co-occurrence');
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(result.fingerprint, createHash('sha256').update(canonicalJson(result.payload), 'utf8').digest('hex'));
});

test('stable fingerprint for field reorder; altered readings or sample order alter digest', async () => {
  const original = sample();
  const reverse = Object.fromEntries(Object.entries(original.values).reverse());
  const a = await buildBundle([original, sample('Second')]);
  const b = await buildBundle([{ ...original, values: reverse }, sample('Second')]);
  const c = await buildBundle([{ ...original, values: { ...reverse, pfoa: '4.002' } }, sample('Second')]);
  const d = await buildBundle([sample('Second'), original]);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
  assert.notEqual(a.fingerprint, d.fingerprint);
});

test('empty or malformed report cannot be exported as an apparently valid audit', async () => {
  assert.throws(() => auditCsv([]), /No samples/);
  await assert.rejects(buildBundle([]), /No samples/);
  await assert.rejects(buildBundle([sample('')]), /Tap name/);
});

test('sparse sample arrays cannot smuggle unvalidated holes into either export', async () => {
  const sparse = new Array(3);
  sparse[1] = sample();
  assert.throws(() => auditCsv(sparse), TypeError);
  await assert.rejects(buildBundle(sparse), TypeError);
  assert.throws(() => auditCsv(new Array(3)), TypeError);
  await assert.rejects(buildBundle(new Array(3)), TypeError);
});

test('non-object samples fail with a clear type error in both exports', async () => {
  for (const bad of [null, undefined, 42, 'x', true]) {
    assert.throws(() => auditCsv([bad]), TypeError);
    await assert.rejects(buildBundle([bad]), TypeError);
  }
});

test('preset and unverified provenance survive download and are covered by the digest', async () => {
  const preset = await buildBundle([sample()], { source: 'synthetic' });
  const unverified = await buildBundle([sample()]);
  assert.equal(preset.payload.source, 'synthetic');
  assert.equal(unverified.payload.source, 'unverified-input');
  assert.notEqual(preset.fingerprint, unverified.fingerprint);
  assert.ok(auditCsv([sample()], { source: 'synthetic' }).trim().split('\r\n').slice(1)
    .every(row => row.endsWith(',"synthetic"')));
});

test('exports reject provenance which suggests unverified samples were verified', async () => {
  assert.throws(() => auditCsv([sample()], { source: 'verified' }), /Export source/);
  await assert.rejects(buildBundle([sample()], { source: 'verified' }), /Export source/);
});

test('fingerprinted bundle still works when WebCrypto is unavailable', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    const result = await buildBundle([sample()]);
    assert.equal(result.fingerprint, createHash('sha256').update(canonicalJson(result.payload), 'utf8').digest('hex'));
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor);
  }
});
