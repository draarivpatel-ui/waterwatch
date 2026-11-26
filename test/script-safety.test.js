import assert from 'node:assert/strict';
import test from 'node:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScratchDir, isCreatedScratchDir, verifyCreatedScratchDir } from '../scripts/scratch-dir.mjs';
import { parseTapSummary, suiteCountProblems } from '../scripts/verify-test-counts.mjs';

const REAL_TMP = realpathSync(os.tmpdir());

function scratchFixture() {
  const container = mkdtempSync(path.join(REAL_TMP, 'waterwatch-script-safety-'));
  const allowedRoot = path.join(container, 'allowed');
  const outsideRoot = path.join(container, 'outside');
  mkdirSync(allowedRoot);
  mkdirSync(outsideRoot);
  return {
    container,
    allowedRoot,
    outsideRoot,
    options: { allowedRoots: [allowedRoot] },
  };
}

function removeFixture(target) {
  rmSync(target, { recursive: true, force: true });
}

test('pre-existing override directories are refused without deleting contents', () => {
  const fixture = scratchFixture();
  try {
    const existing = path.join(fixture.allowedRoot, 'already-here');
    mkdirSync(existing);
    writeFileSync(path.join(existing, 'sentinel.txt'), 'keep');
    assert.throws(
      () => createScratchDir('waterwatch-smoke-profile-', existing, fixture.options),
      /pre-existing scratch path/);
    assert.equal(readFileSync(path.join(existing, 'sentinel.txt'), 'utf8'), 'keep');
    assert.ok(lstatSync(existing).isDirectory());
  } finally {
    removeFixture(fixture.container);
  }
});

test('a symlink override target is refused without following or deleting it', () => {
  const fixture = scratchFixture();
  try {
    const outside = path.join(fixture.outsideRoot, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'sentinel.txt'), 'keep');
    const link = path.join(fixture.allowedRoot, 'profile-link');
    symlinkSync(outside, link, 'dir');
    assert.throws(
      () => createScratchDir('waterwatch-smoke-profile-', link, fixture.options),
      /pre-existing scratch path/);
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.equal(readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'keep');
  } finally {
    removeFixture(fixture.container);
  }
});

test('a symlink ancestor escaping the allowed scratch roots is refused', () => {
  const fixture = scratchFixture();
  try {
    const outside = path.join(fixture.outsideRoot, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'sentinel.txt'), 'keep');
    const link = path.join(fixture.allowedRoot, 'linked-parent');
    symlinkSync(outside, link, 'dir');
    const target = path.join(link, 'new-profile');
    assert.throws(
      () => createScratchDir('waterwatch-smoke-profile-', target, fixture.options),
      /outside temporary scratch space/);
    assert.equal(existsSync(path.join(outside, 'new-profile')), false);
    assert.equal(readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'keep');
  } finally {
    removeFixture(fixture.container);
  }
});

test('a symlinked override parent inside the allowed root is refused', () => {
  const fixture = scratchFixture();
  try {
    const realParent = path.join(fixture.allowedRoot, 'real-parent');
    const inner = path.join(realParent, 'inner');
    mkdirSync(realParent);
    mkdirSync(inner);
    const link = path.join(fixture.allowedRoot, 'linked-real-parent');
    symlinkSync(realParent, link, 'dir');
    assert.throws(
      () => createScratchDir('waterwatch-smoke-profile-', path.join(link, 'inner', 'new-profile'), fixture.options),
      /non-canonical scratch parent/);
    assert.equal(readdirSync(inner).length, 0);
  } finally {
    removeFixture(fixture.container);
  }
});

test('missing override paths create only fresh mkdtemp directories', () => {
  const fixture = scratchFixture();
  try {
    const target = path.join(fixture.allowedRoot, 'fresh-profile');
    const created = createScratchDir('waterwatch-smoke-profile-', target, fixture.options);
    const second = createScratchDir('waterwatch-smoke-profile-', target, fixture.options);
    assert.notEqual(created, target);
    assert.notEqual(second, target);
    assert.notEqual(created, second);
    assert.equal(existsSync(target), false);
    assert.equal(isCreatedScratchDir(target), false);
    for (const dir of [created, second]) {
      assert.equal(isCreatedScratchDir(dir), true);
      assert.equal(path.dirname(dir), realpathSync(fixture.allowedRoot));
      assert.ok(path.basename(dir).startsWith('waterwatch-smoke-profile-'));
      assert.ok(lstatSync(dir).isDirectory());
      assert.equal(lstatSync(dir).isSymbolicLink(), false);
    }
  } finally {
    removeFixture(fixture.container);
  }
});

test('default scratch paths are unique inside an explicitly allowed root', () => {
  const fixture = scratchFixture();
  try {
    const first = createScratchDir('waterwatch-smoke-', undefined, fixture.options);
    const second = createScratchDir('waterwatch-smoke-', undefined, fixture.options);
    assert.notEqual(first, second);
    for (const dir of [first, second]) {
      assert.equal(path.dirname(dir), realpathSync(fixture.allowedRoot));
      assert.ok(path.basename(dir).startsWith('waterwatch-smoke-'));
      assert.ok(lstatSync(dir).isDirectory());
    }
  } finally {
    removeFixture(fixture.container);
  }
});

test('a symlinked scratch root ancestor is rejected', () => {
  const fixture = scratchFixture();
  try {
    const realParent = path.join(fixture.allowedRoot, 'real-root-parent');
    const realRoot = path.join(realParent, 'root');
    mkdirSync(realParent);
    mkdirSync(realRoot);
    const link = path.join(fixture.allowedRoot, 'linked-root-parent');
    symlinkSync(realParent, link, 'dir');
    assert.throws(
      () => createScratchDir('waterwatch-smoke-', undefined, { allowedRoots: [path.join(link, 'root')] }),
      /non-canonical scratch root/);
  } finally {
    removeFixture(fixture.container);
  }
});

test('symlink scratch root candidates are rejected', () => {
  const fixture = scratchFixture();
  try {
    const realRoot = path.join(fixture.allowedRoot, 'real-root');
    mkdirSync(realRoot);
    const link = path.join(fixture.container, 'root-link');
    symlinkSync(realRoot, link, 'dir');
    assert.throws(
      () => createScratchDir('waterwatch-smoke-', undefined, { allowedRoots: [link] }),
      /symlink scratch root/);
  } finally {
    removeFixture(fixture.container);
  }
});

test('scratch root candidates escaping approved temporary roots are rejected', () => {
  assert.throws(
    () => createScratchDir('waterwatch-smoke-', undefined, { allowedRoots: ['/'] }),
    /scratch root outside temporary scratch space/);
});

test('created scratch identity rejects a replaced directory before cleanup', () => {
  const fixture = scratchFixture();
  try {
    const created = createScratchDir('waterwatch-smoke-', undefined, fixture.options);
    assert.equal(verifyCreatedScratchDir(created), true);
    const replacement = path.join(fixture.allowedRoot, 'replacement');
    mkdirSync(replacement);
    rmSync(created, { recursive: true, force: true });
    renameSync(replacement, created);
    assert.throws(() => verifyCreatedScratchDir(created), /replaced before cleanup/);
  } finally {
    removeFixture(fixture.container);
  }
});

test('injected TAP summary lines cannot hide a skipped test', () => {
  const output = [
    'TAP version 13',
    '# pass 2',
    '# skipped 0',
    '# Subtest: noisy stdout',
    'ok 1 - noisy stdout',
    '  ---',
    '  duration_ms: 1',
    '  ...',
    '# Subtest: actually skipped',
    'ok 2 - actually skipped # SKIP',
    '  ---',
    '  duration_ms: 0',
    '  ...',
    '1..2',
    '# tests 2',
    '# suites 0',
    '# pass 1',
    '# fail 0',
    '# cancelled 0',
    '# skipped 1',
    '# todo 0',
    '# duration_ms 12.5',
    '',
  ].join('\n');
  const summary = parseTapSummary(output, 'injected stdout');
  assert.equal(summary.tests, 2);
  assert.equal(summary.pass, 1);
  assert.equal(summary.skipped, 1);
  const problems = suiteCountProblems({ ...summary, code: 0 });
  assert.ok(problems.includes('pass 1 does not equal tests 2'));
  assert.ok(problems.includes('skipped 1 is not zero'));
});
