import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CSV_HEADERS, CsvError, decodeUpload, parseCsv } from '../src/import.js';

const HEADER = CSV_HEADERS.join(',');
const row = cells => cells.join(',');
const csv = lines => lines.join('\n');
const full = cells => [HEADER, row([...cells, ...Array(Math.max(0, 15 - cells.length)).fill('')])];

function decode(text, encoding = 'utf8') {
  return Buffer.from(text, encoding);
}

test('CSV_HEADERS is the exact published schema', () => {
  assert.deepEqual(CSV_HEADERS, [
    'tap', 'advisory', 'ecoli', 'lead_ppb', 'copper_ppb', 'nitrate_mg_l_as_n',
    'arsenic_ppb', 'pfoa_ppt', 'pfos_ppt', 'pfhxs_ppt', 'pfna_ppt', 'genx_ppt', 'pfbs_ppt', 'pair_id', 'draw_type',
  ]);
});

test('parses a full row into a normalized record', () => {
  const [sample] = parseCsv(csv(full([
    'North tap', 'boil', 'present', '12.5', '200', '3.1', '4', '5.5', '4.0', '9', '8', '2', '30',
  ])));
  assert.equal(sample.tap, 'North tap');
  assert.equal(sample.advisory, 'boil');
  assert.equal(sample.ecoli, 'present');
  assert.equal(sample.values.lead, '12.5');
  assert.equal(sample.values.pfbs, '30');
  assert.equal(sample.values.genx, '2');
});

test('fills every chemical key with null when unreported', () => {
  const [sample] = parseCsv(csv(['tap,advisory', 'Well house,none']));
  assert.equal(sample.advisory, 'none');
  assert.equal(sample.ecoli, 'unknown');
  for (const id of ['lead', 'copper', 'nitrate', 'arsenic', 'pfoa', 'pfos', 'pfhxs', 'pfna', 'genx', 'pfbs']) {
    assert.equal(sample.values[id], null, id);
  }
});

test('columns may be a subset in any order', () => {
  const [sample] = parseCsv(csv(['arsenic_ppb,lead_ppb,tap', '4.5,12,Yard spigot']));
  assert.equal(sample.tap, 'Yard spigot');
  assert.equal(sample.values.arsenic, '4.5');
  assert.equal(sample.values.lead, '12');
  assert.equal(sample.values.copper, null);
});

test('CRLF line endings parse', () => {
  const [a, b] = parseCsv('tap,advisory\r\nOne,boil\r\nTwo,none\r\n');
  assert.equal(a.tap, 'One');
  assert.equal(b.advisory, 'none');
});

test('lone CR line endings parse', () => {
  const rows = parseCsv('tap,ecoli\rA,present\rB,absent');
  assert.equal(rows.length, 2);
});

test('trailing newline does not create a phantom row', () => {
  const rows = parseCsv('tap,advisory\nOnly,none\n');
  assert.equal(rows.length, 1);
});

test('quoted field may contain a comma', () => {
  const [sample] = parseCsv(csv(full(['"Lab, north wing"', 'none', 'absent', '', '', '', '', '', '', '', '', '', ''])));
  assert.equal(sample.tap, 'Lab, north wing');
});

test('quoted field may contain escaped double quotes', () => {
  const [sample] = parseCsv(csv(full(['"Tap ""A"" north"', 'none', 'absent', '', '', '', '', '', '', '', '', '', ''])));
  assert.equal(sample.tap, 'Tap "A" north');
});

test('quoted field spanning lines tokenizes, then fails on tap controls', () => {
  const error = rejects(csv([HEADER, '"Multi\nline tap",boil,present,1,2,3,4,5,6,7,8,9,10,,']));
  assert.match(error.errors[0].message, /Tap name/);
});

test('a leading byte order mark is ignored', () => {
  const rows = parseCsv('\uFEFFtap,advisory\nA,none');
  assert.equal(rows.length, 1);
});

test('advisory accepts case and separator variants', () => {
  const [a] = parseCsv(csv(['tap,advisory', 'x,Do Not Drink']));
  assert.equal(a.advisory, 'do-not-drink');
  const [b] = parseCsv(csv(['tap,advisory', 'y,DO_NOT_USE']));
  assert.equal(b.advisory, 'do-not-use');
  const [c] = parseCsv(csv(['tap,advisory', 'z,BOIL']));
  assert.equal(c.advisory, 'boil');
});

test('blank advisory and ecoli cells normalize to unknown', () => {
  const [sample] = parseCsv(csv(['tap,advisory,ecoli', 'A,,']));
  assert.equal(sample.advisory, 'unknown');
  assert.equal(sample.ecoli, 'unknown');
});

test('paired-draw metadata parses as explicit sample provenance', () => {
  const [sample] = parseCsv(csv(['tap,lead_ppb,pair_id,draw_type', 'East tap,12,east-hall,First Draw']));
  assert.equal(sample.pairId, 'east-hall');
  assert.equal(sample.drawType, 'first-draw');
});

test('blank paired-draw metadata stays unknown without blocking legacy CSVs', () => {
  const [sample] = parseCsv(csv(['tap,lead_ppb', 'East tap,12']));
  assert.equal(sample.pairId, null);
  assert.equal(sample.drawType, 'unknown');
});

test('bad draw types and control-bearing pair ids reject', () => {
  rejects(csv(['tap,lead_ppb,draw_type', 'A,5,random']), { row: 2, field: 'draw_type' });
  rejects(csv(['tap,lead_ppb,pair_id', 'A,5,"bad\nid"']), { match: /Pair metadata/ });
});

test('missing advisory and ecoli columns default to unknown', () => {
  const [sample] = parseCsv(csv(['tap,lead_ppb', 'A,5']));
  assert.equal(sample.advisory, 'unknown');
  assert.equal(sample.ecoli, 'unknown');
});

test('ecoli tokens normalize', () => {
  const [a] = parseCsv(csv(['tap,ecoli', 'A,Absent']));
  const [b] = parseCsv(csv(['tap,ecoli', 'B,PRESENT']));
  assert.equal(a.ecoli, 'absent');
  assert.equal(b.ecoli, 'present');
});

test('zero and boundary decimal widths are valid measurements', () => {
  const cells = ['T', 'none', 'absent', '0', '123456789', '0.000000000001', '123456789.123456789012',
    '007.5', '1', '2', '3', '4', '5'];
  const [sample] = parseCsv(csv(full(cells)));
  assert.equal(sample.values.lead, '0');
  assert.equal(sample.values.copper, '123456789');
  assert.equal(sample.values.nitrate, '0.000000000001');
  assert.equal(sample.values.arsenic, '123456789.123456789012');
  assert.equal(sample.values.pfoa, '007.5');
});

test('whitespace-only concentration cells count as unreported', () => {
  const [sample] = parseCsv(csv(['tap,lead_ppb', 'A,   ']));
  assert.equal(sample.values.lead, null);
});

test('tap names are trimmed by normalization', () => {
  const [sample] = parseCsv(csv(['tap,lead_ppb', '   Fountain west  ,1']));
  assert.equal(sample.tap, 'Fountain west');
});

function rejects(text, { row, field, match } = {}) {
  let error;
  assert.throws(() => parseCsv(text), thrown => {
    error = thrown;
    return thrown instanceof CsvError;
  });
  assert.ok(Array.isArray(error.errors));
  const first = error.errors[0];
  if (row !== undefined) assert.equal(first.row, row);
  if (field !== undefined) assert.equal(first.field, field);
  if (match) assert.match(error.message, match);
  return error;
}

test('empty input fails', () => {
  rejects('', { row: 1, match: /empty/ });
});

test('non-string input fails closed', () => {
  assert.throws(() => parseCsv(null), TypeError);
  assert.throws(() => parseCsv(42), TypeError);
});

test('header alone has no tap rows', () => {
  rejects(HEADER, { row: 2, match: /no tap rows/ });
});

test('unknown column names reject with unit guidance', () => {
  const error = rejects(csv(['tap,lead_ppt', 'A,5']), { row: 1, field: 'lead_ppt' });
  assert.match(error.errors[0].message, /lead_ppb|pfoa_ppt/);
});

test('header names are case sensitive', () => {
  rejects(csv(['tap,Lead_ppb', 'A,5']), { row: 1, field: 'Lead_ppb' });
});

test('duplicate header names reject', () => {
  rejects(csv(['tap,lead_ppb,lead_ppb', 'A,5,6']), { row: 1, field: 'lead_ppb' });
});

test('blank header cells reject', () => {
  rejects(csv(['tap,,lead_ppb', 'A,x,5']), { row: 1, field: 'column 2' });
});

test('a tap column is required', () => {
  rejects(csv(['lead_ppb,copper_ppb', '5,6']), { row: 1, field: 'tap' });
});

test('tap alone is not enough data', () => {
  rejects(csv(['tap', 'A']), { row: 1, match: /advisory, ecoli, or measurement/ });
});

test('a bare quote inside a header fails the parse', () => {
  rejects(csv(['ta"p,lead_ppb', 'A,5']), { match: /quoted field/ });
});

test('a quote that never closes fails', () => {
  rejects(csv(['"tap,advisory', 'A,none']), { match: /still open/ });
});

test('a quote inside an unquoted field fails', () => {
  rejects(csv(full(['ta"p', 'none', 'absent', '', '', '', '', '', '', '', '', '', ''])), { match: /quoted field/ });
});

test('characters after a closing quote fail', () => {
  rejects(csv(full(['"A"x', 'none', 'absent', '', '', '', '', '', '', '', '', '', ''])), { match: /closing quote/ });
});

test('a space before a quote is still a bare quote', () => {
  rejects(csv(full([' "A"', 'none', 'absent', '', '', '', '', '', '', '', '', '', ''])), { match: /quoted field/ });
});

test('short rows fail on field count', () => {
  rejects(csv([HEADER, 'A,none,absent,1,2']), { row: 2, match: /Expected 15 fields, found 5/ });
});

test('long rows fail on record arity inside data rows', () => {
  rejects(csv([HEADER, 'A,none,absent,1,2,3,4,5,6,7,8,9,10,EXTRA,MORE,AGAIN']), { row: 2, match: /more than 15 fields/ });
});

test('an empty row fails closed instead of being skipped', () => {
  rejects(csv(['tap,advisory', 'A,none', '', 'B,boil']), { row: 3, match: /Empty row/ });
});

test('a row of only commas fails as empty', () => {
  rejects(csv(['tap,advisory', 'A,none', ',']), { row: 3, match: /Empty row/ });
});

test('missing tap names fail', () => {
  rejects(csv(['tap,lead_ppb', ',5']), { row: 2, field: 'tap' });
});

test('whitespace-only tap names fail through normalization', () => {
  rejects(csv(['tap,lead_ppb', '   ,5']), { row: 2, match: /Tap name/ });
});

test('duplicate tap names fail closed', () => {
  const error = rejects(csv(['tap,lead_ppb', 'Fountain,5', 'Fountain,6']), { row: 3, field: 'tap' });
  assert.match(error.errors[0].message, /row 2/);
});

test('duplicates are detected after tap normalization', () => {
  rejects(csv(['tap,lead_ppb', 'Fountain,5', '  Fountain  ,6']), { row: 3 });
});

test('invisible-separator tap names collapse into real duplicates', () => {
  for (const lookalike of ['a\u00a0b', 'a\u2028b', 'a\u2029b', 'a\u2003b']) {
    rejects(csv(['tap,lead_ppb', 'a b,5', `${lookalike},6`]), { row: 3, field: 'tap' });
  }
});

test('a line break inside a quoted cell still advances error line numbers', () => {
  for (const sep of ['\r', '\n', '\r\n']) {
    const error = rejects(`tap,lead_ppb\n"A${sep}B",1\nC,ND`);
    assert.deepEqual(error.errors.map(item => item.row), [2, 4]);
  }
});

test('ND is rejected with an explicit no-substitute instruction', () => {
  const error = rejects(csv(['tap,lead_ppb', 'A,ND']), { row: 2, field: 'lead_ppb' });
  assert.match(error.errors[0].message, /never substitute zero/);
});

test('below-limit notation is rejected with the same instruction', () => {
  const error = rejects(csv(['tap,lead_ppb', 'A,<0.5']), { row: 2, field: 'lead_ppb' });
  assert.match(error.errors[0].message, /ND or < results/);
});

test('rejects malformed decimals: negative', () => {
  rejects(csv(['tap,lead_ppb', 'A,-1']), { row: 2, field: 'lead_ppb' });
});

test('rejects malformed decimals: no leading digit', () => {
  rejects(csv(['tap,lead_ppb', 'A,.5']), { row: 2, field: 'lead_ppb' });
});

test('rejects malformed decimals: trailing dot', () => {
  rejects(csv(['tap,lead_ppb', 'A,5.']), { row: 2, field: 'lead_ppb' });
});

test('rejects malformed decimals: double dot', () => {
  rejects(csv(['tap,lead_ppb', 'A,1.2.3']), { row: 2, field: 'lead_ppb' });
});

test('rejects more than nine whole digits', () => {
  rejects(csv(['tap,lead_ppb', 'A,1234567890']), { row: 2, field: 'lead_ppb' });
});

test('rejects more than twelve fraction digits', () => {
  rejects(csv(['tap,lead_ppb', 'A,1.1234567890123']), { row: 2, field: 'lead_ppb' });
});

test('rejects exponent and unit-suffixed values', () => {
  rejects(csv(['tap,lead_ppb', 'A,1e3']), { row: 2, field: 'lead_ppb' });
  rejects(csv(['tap,lead_ppb', 'B,5 ppb']), { row: 2, field: 'lead_ppb' });
});

test('rejects unrecognized advisory tokens with the allowed list', () => {
  const error = rejects(csv(['tap,advisory', 'A,flush']), { row: 2, field: 'advisory' });
  assert.match(error.errors[0].message, /do-not-use/);
});

test('rejects unrecognized ecoli tokens with the allowed list', () => {
  const error = rejects(csv(['tap,ecoli', 'A,detected']), { row: 2, field: 'ecoli' });
  assert.match(error.errors[0].message, /present, absent, or unknown/);
});

test('collects errors across rows and fields', () => {
  const error = rejects(csv(['tap,advisory,lead_ppb', 'A,bogus,ok', 'B,none,oops', 'C,none']));
  assert.ok(error.errors.length >= 3);
  const rows = error.errors.map(e => e.row);
  assert.ok(rows.includes(2) && rows.includes(3));
});

test('every error names its row and, when known, its field', () => {
  const error = rejects(csv(['tap,lead_ppb', 'A,ND']));
  assert.equal(error.errors[0].row, 2);
  assert.equal(error.errors[0].field, 'lead_ppb');
});

test('a quoted empty tap still fails the required check', () => {
  rejects(csv(['tap,lead_ppb', '"",5']), { row: 2, field: 'tap' });
});

test('row cap of 500 data rows', () => {
  const lines = ['tap,lead_ppb', ...Array.from({ length: 501 }, (_, i) => `T${i},1`)];
  rejects(csv(lines), { match: /limit is 500/ });
});

test('500 rows is exactly allowed', () => {
  const lines = ['tap,lead_ppb', ...Array.from({ length: 500 }, (_, i) => `T${i},1`)];
  assert.equal(parseCsv(csv(lines)).length, 500);
});

test('files over 1 MB are refused before parsing', () => {
  const big = `tap,lead_ppb\n${'x'.repeat(1024 * 1024)}`;
  rejects(big, { match: /1 MB/ });
});

test('rejects oversized record arity before collecting rows', () => {
  rejects(`tap,${'x,'.repeat(30)}`, { row: 1, match: /more than 15 fields/ });
});

test('UTF-8 size cap applies to non-ASCII text', () => {
  rejects(`tap,lead_ppb\n${'\\u00E9'.repeat(600000)}`, { match: /1 MB/ });
});

test('decodeUpload handles plain UTF-8', () => {
  assert.equal(decodeUpload(decode('tap\nA')), 'tap\nA');
});

test('decodeUpload strips a UTF-8 BOM', () => {
  const buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), decode('tap\nA')]);
  assert.equal(decodeUpload(buf), 'tap\nA');
});

test('decodeUpload handles UTF-16LE with BOM', () => {
  const buf = Buffer.concat([Buffer.from([0xFF, 0xFE]), decode('tap\nA', 'utf16le')]);
  assert.equal(decodeUpload(buf), 'tap\nA');
});

test('decodeUpload handles UTF-16BE with BOM', () => {
  const text = 'tap\nA';
  const le = decode(text, 'utf16le');
  const be = Buffer.alloc(le.length);
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1];
    be[i + 1] = le[i];
  }
  const buf = Buffer.concat([Buffer.from([0xFE, 0xFF]), be]);
  assert.equal(decodeUpload(buf), 'tap\nA');
});

test('decodeUpload is fatal on invalid UTF-8', () => {
  assert.throws(() => decodeUpload(Buffer.from([0x74, 0xFF, 0x61])), /encoded data was not valid/i);
});

test('decodeUpload is fatal on truncated UTF-16', () => {
  assert.throws(() => decodeUpload(Buffer.from([0xFF, 0xFE, 0x61])), /encoded data was not valid/i);
});

test('decodeUpload accepts ArrayBuffer and typed arrays', () => {
  const u8 = decode('tap\nA');
  assert.equal(decodeUpload(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)), 'tap\nA');
  assert.equal(decodeUpload(u8), 'tap\nA');
});

test('decodeUpload rejects non-buffer inputs', () => {
  assert.throws(() => decodeUpload('tap'), TypeError);
  assert.throws(() => decodeUpload(null), TypeError);
});

test('an end-to-end utf-16le upload parses', () => {
  const text = csv(['tap,advisory,lead_ppb', 'A,boil,12.5']);
  const buf = Buffer.concat([Buffer.from([0xFF, 0xFE]), decode(text, 'utf16le')]);
  const [sample] = parseCsv(decodeUpload(buf));
  assert.equal(sample.advisory, 'boil');
  assert.equal(sample.values.lead, '12.5');
});
