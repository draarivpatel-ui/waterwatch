import assert from 'node:assert/strict';
import test from 'node:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScratchDir, isCreatedScratchDir } from '../scripts/scratch-dir.mjs';

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
