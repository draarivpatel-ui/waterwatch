import { normalizeSample } from './engine.js';

export const CSV_HEADERS = [
  'tap', 'advisory', 'ecoli',
  'lead_ppb', 'copper_ppb', 'nitrate_mg_l_as_n', 'arsenic_ppb',
  'pfoa_ppt', 'pfos_ppt', 'pfhxs_ppt', 'pfna_ppt', 'genx_ppt', 'pfbs_ppt',
  'pair_id', 'draw_type',
];

const HEADER_TO_ID = {
  lead_ppb: 'lead',
  copper_ppb: 'copper',
  nitrate_mg_l_as_n: 'nitrate',
  arsenic_ppb: 'arsenic',
  pfoa_ppt: 'pfoa',
  pfos_ppt: 'pfos',
  pfhxs_ppt: 'pfhxs',
  pfna_ppt: 'pfna',
  genx_ppt: 'genx',
  pfbs_ppt: 'pfbs',
};

const ADVISORIES = new Set(['none', 'boil', 'do-not-drink', 'do-not-use', 'unknown']);
const ECOLI = new Set(['present', 'absent', 'unknown']);
const DRAW_TYPES = new Set(['first-draw', 'flushed', 'other', 'unknown']);
const DECIMAL = /^[0-9]{1,9}(?:\.[0-9]{1,12})?$/;
const MAX_BYTES = 1024 * 1024;
const MAX_ROWS = 500;

export class CsvError extends Error {
  constructor(errors) {
    const first = errors[0];
    super(`CSV rejected: ${errors.length} problem${errors.length === 1 ? '' : 's'}. ` +
      `Row ${first.row}${first.field ? `, ${first.field}` : ''}: ${first.message}`);
    this.name = 'CsvError';
    this.errors = errors;
  }
}

function token(tokenText) {
  return tokenText.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function show(value) {
  const text = String(value);
  return `"${text.length > 60 ? `${text.slice(0, 60)}...` : text}"`;
}

// State machine over the raw text. Quoted fields may contain commas, quotes
// (as ""), and line breaks. A quote anywhere else, or any character between a
// closing quote and its comma or line break, is a structural error.
function tokenize(text) {
  const records = [];
  let cells = [];
  let cell = '';
  let cellStarted = false;
  let inQuotes = false;
  let afterClose = false;
  let line = 1;
  let recordLine = 1;
  let recordTouched = false;

  const structural = message => {
    throw new CsvError([{ row: recordLine, field: null, message }]);
  };
  const flushCell = () => {
    if (cells.length >= CSV_HEADERS.length) {
      structural(`A record cannot contain more than ${CSV_HEADERS.length} fields.`);
    }
    cells.push(cell);
    cell = '';
    cellStarted = false;
    afterClose = false;
  };
  const flushRecord = () => {
    flushCell();
    if (records.length > MAX_ROWS) structural('The data row limit is 500.');
    records.push({ cells, line: recordLine });
    cells = [];
    recordTouched = false;
  };
  const endRecord = index => {
    flushRecord();
    if (text[index] === '\r' && text[index + 1] === '\n') return index + 1;
    return index;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (!recordTouched) {
      recordTouched = true;
      recordLine = line;
    }
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
          afterClose = true;
        }
      } else {
        cell += ch;
        if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line += 1;
      }
      continue;
    }
    if (afterClose) {
      if (ch === ',') {
        flushCell();
      } else if (ch === '\r' || ch === '\n') {
        i = endRecord(i);
        line += 1;
      } else {
        structural('Only a comma or a line break may follow a closing quote.');
      }
      continue;
    }
    if (ch === ',') {
      flushCell();
    } else if (ch === '\r' || ch === '\n') {
      i = endRecord(i);
      line += 1;
    } else if (ch === '"') {
      if (cell === '' && !cellStarted) {
        inQuotes = true;
        cellStarted = true;
      } else {
        structural('A quote may only appear at the start of a quoted field. Escape quotes inside quoted fields as "".');
      }
    } else {
      cell += ch;
      cellStarted = true;
    }
  }
  if (inQuotes) structural('A quoted field is still open when the file ends.');
  if (afterClose || cellStarted || cells.length > 0) flushRecord();
  return records;
}

function checkHeader(record, errors) {
  const seen = new Map();
  record.cells.forEach((name, index) => {
    if (name.trim() === '') {
      errors.push({ row: record.line, field: `column ${index + 1}`, message: 'Header cells cannot be blank.' });
      return;
    }
    if (!CSV_HEADERS.includes(name)) {
      errors.push({
        row: record.line,
        field: name,
        message: `${show(name)} is not a column WaterWatch accepts. Use the exact header names, including the unit suffix such as lead_ppb or pfoa_ppt.`,
      });
    }
    if (seen.has(name)) {
      errors.push({ row: record.line, field: name, message: `Column ${show(name)} appears twice.` });
    }
    seen.set(name, index);
  });
  if (!seen.has('tap')) {
    errors.push({ row: record.line, field: 'tap', message: 'A tap column is required.' });
  }
  if (![...seen.keys()].some(name => name !== 'tap')) {
    errors.push({
      row: record.line,
      field: null,
      message: 'At least one advisory, ecoli, or measurement column is required alongside tap.',
    });
  }
  return errors.length === 0 ? seen : null;
}

function listOf(set) {
  const items = [...set];
  return items.length > 1 ? `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}` : items[0];
}

function normalizeToken(raw, allowed, field, row, errors) {
  if (raw.trim() === '') return 'unknown';
  const mapped = token(raw);
  if (!allowed.has(mapped)) {
    errors.push({
      row,
      field,
      message: `${show(raw)} is not a recognized ${field} value. Use ${listOf(allowed)}; leave blank for unknown.`,
    });
    return null;
  }
  return mapped;
}

export function parseCsv(input) {
  if (typeof input !== 'string') {
    throw new TypeError('parseCsv expects CSV text.');
  }
  const text = input.startsWith('\uFEFF') ? input.slice(1) : input;
  if (text.length > MAX_BYTES || new TextEncoder().encode(text).length > MAX_BYTES) {
    throw new CsvError([{ row: 1, field: null, message: `The file is larger than the 1 MB limit.` }]);
  }
  const records = tokenize(text);
  if (records.length === 0) {
    throw new CsvError([{ row: 1, field: null, message: 'The file is empty; a header row and at least one tap row are required.' }]);
  }
  const headerErrors = [];
  const columns = checkHeader(records[0], headerErrors);
  if (!columns) throw new CsvError(headerErrors);
  const data = records.slice(1);
  if (data.length === 0) {
    throw new CsvError([{ row: records[0].line + 1, field: null, message: 'The header parsed, but there are no tap rows.' }]);
  }

  const errors = [];
  const samples = [];
  const taps = new Map();
  const chemColumns = CSV_HEADERS.filter(name => HEADER_TO_ID[name])
    .map(name => ({ name, id: HEADER_TO_ID[name], index: columns.get(name) }))
    .filter(column => column.index !== undefined);
  const advisoryIndex = columns.get('advisory');
  const ecoliIndex = columns.get('ecoli');
  const pairIndex = columns.get('pair_id');
  const drawIndex = columns.get('draw_type');

  for (const record of data) {
    const { cells, line: row } = record;
    if (cells.every(cell => cell.trim() === '')) {
      errors.push({ row, field: null, message: 'Empty row. Delete it or fill it; rows are never skipped.' });
      continue;
    }
    if (cells.length !== records[0].cells.length) {
      errors.push({ row, field: null, message: `Expected ${records[0].cells.length} fields, found ${cells.length}.` });
      continue;
    }
    const before = errors.length;
    const tap = cells[columns.get('tap')];
    if (tap === '') {
      errors.push({ row, field: 'tap', message: 'Every row needs a tap name so results cannot be misattributed.' });
    }
    const advisory = advisoryIndex === undefined ? 'unknown'
      : normalizeToken(cells[advisoryIndex], ADVISORIES, 'advisory', row, errors);
    const ecoli = ecoliIndex === undefined ? 'unknown'
      : normalizeToken(cells[ecoliIndex], ECOLI, 'ecoli', row, errors);
    const pairId = pairIndex === undefined || cells[pairIndex].trim() === '' ? null : cells[pairIndex];
    const drawType = drawIndex === undefined ? 'unknown'
      : normalizeToken(cells[drawIndex], DRAW_TYPES, 'draw_type', row, errors);
    const values = {};
    for (const { name, id, index } of chemColumns) {
      const raw = cells[index];
      if (raw.trim() === '') continue;
      if (!DECIMAL.test(raw.trim())) {
        errors.push({
          row,
          field: name,
          message: `${show(raw)} is not a decimal in the expected unit. Use an unsigned value such as 12.4 (up to 9 whole and 12 fractional digits). Leave the cell blank when the lab did not report a number, and never substitute zero for ND or < results.`,
        });
        continue;
      }
      values[id] = raw.trim();
    }
    if (errors.length !== before || tap === '') continue;
    let sample;
    try {
      sample = normalizeSample({ tap, advisory, ecoli, pairId, drawType, values });
    } catch (error) {
      errors.push({ row, field: null, message: error.message });
      continue;
    }
    const earlier = taps.get(sample.tap);
    if (earlier !== undefined) {
      errors.push({
        row,
        field: 'tap',
        message: `${show(sample.tap)} also appears on row ${earlier}. Tap names must be unique.`,
      });
      continue;
    }
    taps.set(sample.tap, row);
    samples.push(sample);
  }
  if (errors.length > 0) throw new CsvError(errors);
  return samples;
}

export function decodeUpload(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer)
    : ArrayBuffer.isView(buffer) ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : null;
  if (!bytes) throw new TypeError('decodeUpload expects an ArrayBuffer or a typed array.');
  let encoding = 'utf-8';
  let offset = 0;
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    offset = 3;
  } else if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
    encoding = 'utf-16le';
    offset = 2;
  } else if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
    encoding = 'utf-16be';
    offset = 2;
  }
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset));
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}
