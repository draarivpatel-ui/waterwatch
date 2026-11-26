// Verify that the README's per-suite node:test counts match live output.
import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSelfTests } from '../src/mixture-lab.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LABELS = new Map([
  ['diagnostic', 'diagnostic.test.js'],
  ['engine', 'engine.test.js'],
  ['exports', 'exports.test.js'],
  ['hygiene', 'hygiene.test.js'],
  ['import', 'import.test.js'],
  ['mixture-lab', 'mixture-lab.test.js'],
  ['pfas-signal', 'pfas-signal.test.js'],
  ['SDG 6 equity', 'sdg6-equity.test.js'],
  ['shortcuts', 'shortcuts.test.js'],
]);

function runSuite(file) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', join('test', file)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', rejectRun);
    child.on('close', code => {
      const pass = Number(output.match(/^ℹ pass (\d+)$/m)?.[1] ?? NaN);
      const fail = Number(output.match(/^ℹ fail (\d+)$/m)?.[1] ?? NaN);
      resolveRun({ file, code, pass, fail, output });
    });
  });
}

const readme = await readFile(join(ROOT, 'README.md'), 'utf8');
const readmeMatch = readme.match(/The suite has (\d+) tests:\s*diagnostic (\d+), engine (\d+), exports (\d+), hygiene (\d+), import (\d+), mixture-lab (\d+),\s*pfas-signal (\d+), SDG 6 equity (\d+), shortcuts (\d+); lab modules (\d+); page self-tests (\d+)\./);
if (!readmeMatch) {
  console.error('README test-count sentence is missing or not in the expected format.');
  process.exit(1);
}

const [readmeTotal, ...values] = readmeMatch.slice(1).map(Number);
const labels = [...LABELS.keys()];
const readmeCounts = Object.fromEntries(labels.map((label, index) => [label, values[index]]));
const readmeLabTotal = values[labels.length];
const readmeSelfTests = values[labels.length + 1];

const testFiles = (await readdir(join(ROOT, 'test')))
  .filter(name => name.endsWith('.test.js'))
  .sort();
const actual = new Map();
let failed = false;
for (const file of testFiles) {
  const result = await runSuite(file);
  actual.set(file, result.pass);
  console.log(`${file}: ${result.pass} passing`);
  if (result.code !== 0 || result.fail !== 0 || !Number.isFinite(result.pass)) {
    console.error(`${file}: suite did not pass cleanly`);
    failed = true;
  }
}

const mismatches = [];
let actualTotal = 0;
for (const [label, file] of LABELS) {
  const count = actual.get(file);
  actualTotal += count || 0;
  if (count === undefined) {
    mismatches.push(`${label}: missing ${file}`);
  } else if (count !== readmeCounts[label]) {
    mismatches.push(`${label}: README ${readmeCounts[label]} but live ${count}`);
  }
}
for (const file of testFiles) {
  if (![...LABELS.values()].includes(file)) mismatches.push(`${file}: missing from README counts`);
}
if (actualTotal !== readmeTotal) mismatches.push(`total: README ${readmeTotal} but live ${actualTotal}`);
const labTotal = (actual.get('mixture-lab.test.js') ?? 0) + (actual.get('sdg6-equity.test.js') ?? 0);
if (labTotal !== readmeLabTotal) mismatches.push(`lab modules: README ${readmeLabTotal} but live ${labTotal}`);
const selfTests = runSelfTests();
if (selfTests.length !== readmeSelfTests) {
  mismatches.push(`page self-tests: README ${readmeSelfTests} but live ${selfTests.length}`);
}
if (selfTests.some(item => !item.ok)) {
  mismatches.push(`page self-tests: ${selfTests.filter(item => !item.ok).length} failing`);
  failed = true;
}

if (mismatches.length || failed) {
  for (const line of mismatches) console.error(line);
  process.exit(1);
}
console.log(`README test counts verified: total ${actualTotal}; lab modules ${labTotal}; page self-tests ${selfTests.length}`);
