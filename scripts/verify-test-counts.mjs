// Verify that the README's per-suite node:test counts match live output.
import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSelfTests } from '../src/mixture-lab.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), '..');
const LABELS = new Map([
  ['diagnostic', 'diagnostic.test.js'],
  ['engine', 'engine.test.js'],
  ['exports', 'exports.test.js'],
  ['hygiene', 'hygiene.test.js'],
  ['import', 'import.test.js'],
  ['mixture-lab', 'mixture-lab.test.js'],
  ['pfas-signal', 'pfas-signal.test.js'],
  ['SDG 6 equity', 'sdg6-equity.test.js'],
  ['script-safety', 'script-safety.test.js'],
  ['shortcuts', 'shortcuts.test.js'],
]);
const TAP_COUNT_LABELS = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];

export function parseTapSummary(output, file = 'TAP output') {
  const lines = output.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  let planIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^1\.\.\d+$/.test(lines[index])) {
      planIndex = index;
      break;
    }
  }
  if (planIndex === -1) throw new Error(`${file}: TAP output is missing a final 1..N plan line`);

  const summaryLines = lines.slice(planIndex + 1);
  if (summaryLines.length === 0) throw new Error(`${file}: TAP output is missing a final summary block`);
  const counts = {};
  const seen = new Set();
  let nextRequiredIndex = 0;
  let durationSeen = false;
  for (const line of summaryLines) {
    if (/^# duration_ms \d+(?:\.\d+)?$/.test(line)) {
      if (durationSeen || nextRequiredIndex !== TAP_COUNT_LABELS.length) {
        throw new Error(`${file}: TAP final summary directives are out of order`);
      }
      durationSeen = true;
      continue;
    }
    const match = line.match(/^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/);
    if (!match) throw new Error(`${file}: TAP final summary has an unexpected trailing line`);
    const [, label, digits] = match;
    if (seen.has(label)) throw new Error(`${file}: TAP final summary repeats # ${label}`);
    if (label === 'suites') {
      if (!seen.has('tests') || seen.has('pass')) {
        throw new Error(`${file}: TAP final summary directives are out of order`);
      }
      seen.add(label);
      continue;
    }
    if (label !== TAP_COUNT_LABELS[nextRequiredIndex]) {
      throw new Error(`${file}: TAP final summary directives are out of order`);
    }
    counts[label] = Number(digits);
    seen.add(label);
    nextRequiredIndex += 1;
  }
  for (const label of TAP_COUNT_LABELS) {
    if (!Number.isInteger(counts[label]) || counts[label] < 0) {
      throw new Error(`${file}: TAP summary is missing an integer # ${label} count`);
    }
  }
  return counts;
}

export function suiteCountProblems(result) {
  const problems = [];
  if (result.pass !== result.tests) problems.push(`pass ${result.pass} does not equal tests ${result.tests}`);
  for (const label of ['fail', 'cancelled', 'skipped', 'todo']) {
    if (result[label] !== 0) problems.push(`${label} ${result[label]} is not zero`);
  }
  if (result.code !== 0) problems.push(`exit code ${result.code}`);
  return problems;
}

function runSuite(file) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', join('test', file)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', rejectRun);
    child.on('close', code => {
      try {
        resolveRun({ file, code, ...parseTapSummary(stdout, file), output: stdout + stderr });
      } catch (error) {
        rejectRun(error);
      }
    });
  });
}

async function main() {
  const readme = await readFile(join(ROOT, 'README.md'), 'utf8');
  const readmeMatch = readme.match(/The suite has (\d+) tests:\s*diagnostic (\d+), engine (\d+), exports (\d+), hygiene (\d+), import (\d+), mixture-lab (\d+),\s*pfas-signal (\d+), SDG 6 equity (\d+), script-safety (\d+), shortcuts (\d+); lab modules (\d+); page self-tests (\d+)\./);
  if (!readmeMatch) {
    console.error('README test-count sentence is missing or not in the expected format.');
    process.exitCode = 1;
    return;
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
    actual.set(file, result.tests);
    console.log(`${file}: ${result.tests} tests, ${result.pass} passing`);
    const countProblems = suiteCountProblems(result);
    if (countProblems.length > 0) {
      console.error(`${file}: suite did not pass cleanly (${countProblems.join('; ')})`);
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
    process.exitCode = 1;
    return;
  }
  console.log(`README test counts verified: total ${actualTotal}; lab modules ${labTotal}; page self-tests ${selfTests.length}`);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) await main();
