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
import { fileURLToPath } from 'node:url';
import { createScratchDir } from '../scripts/scratch-dir.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_TMP = realpathSync(os.tmpdir());

function tmpFixture() {
  return mkdtempSync(path.join(REAL_TMP, 'waterwatch-script-safety-'));
}

function outsideFixture() {
  return mkdtempSync(path.join(ROOT, '.script-safety-outside-'));
}

function removeFixture(target) {
  rmSync(target, { recursive: true, force: true });
}

test('pre-existing override directories are refused without deleting contents', () => {
  const base = tmpFixture();
  try {
    const existing = path.join(base, 'already-here');
    mkdirSync(existing);
    writeFileSync(path.join(existing, 'sentinel.txt'), 'keep');
    assert.throws(
      () => createScratchDir('waterwatch-smoke-profile-', existing),
      /pre-existing scratch path/);
    assert.equal(readFileSync(path.join(existing, 'sentinel.txt'), 'utf8'), 'keep');
    assert.ok(lstatSync(existing).isDirectory());
  } finally {
    removeFixture(base);
  }
});

test('a symlink override target is refused without following or deleting it', () => {
  const tmpBase = tmpFixture();
  const outsideBase = outsideFixture();
  try {
    const outside = path.join(outsideBase, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'sentinel.txt'), 'keep');
    const link = path.join(tmpBase, 'profile-link');
    symlinkSync(outside, link, 'dir');
    assert.throws(
      () => createScratchDir('waterwatch-smoke-profile-', link),
      /pre-existing scratch path/);
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.equal(readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'keep');
  } finally {
    removeFixture(tmpBase);
    removeFixture(outsideBase);
  }
});

test('a symlink ancestor escaping temporary scratch space is refused', () => {
  const tmpBase = tmpFixture();
  const outsideBase = outsideFixture();
  try {
    const outside = path.join(outsideBase, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'sentinel.txt'), 'keep');
    const link = path.join(tmpBase, 'linked-parent');
    symlinkSync(outside, link, 'dir');
    const target = path.join(link, 'new-profile');
    assert.throws(
      () => createScratchDir('waterwatch-smoke-profile-', target),
      /outside temporary scratch space/);
    assert.equal(existsSync(path.join(outside, 'new-profile')), false);
    assert.equal(readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'keep');
  } finally {
    removeFixture(tmpBase);
    removeFixture(outsideBase);
  }
});

test('missing override paths inside temporary scratch space are created once', () => {
  const base = tmpFixture();
  try {
    const target = path.join(base, 'fresh-profile');
    const created = createScratchDir('waterwatch-smoke-profile-', target);
    assert.equal(created, target);
    assert.ok(lstatSync(created).isDirectory());
    assert.throws(
      () => createScratchDir('waterwatch-smoke-profile-', target),
      /pre-existing scratch path/);
  } finally {
    removeFixture(base);
  }
});

test('default scratch paths are unique inside the real temporary root', () => {
  const first = createScratchDir('waterwatch-smoke-');
  const second = createScratchDir('waterwatch-smoke-');
  try {
    assert.notEqual(first, second);
    for (const dir of [first, second]) {
      assert.equal(path.dirname(dir), REAL_TMP);
      assert.ok(path.basename(dir).startsWith('waterwatch-smoke-'));
      assert.ok(lstatSync(dir).isDirectory());
    }
  } finally {
    removeFixture(first);
    removeFixture(second);
  }
});
