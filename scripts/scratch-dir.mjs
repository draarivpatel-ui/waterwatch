import { lstatSync, mkdtempSync, readlinkSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const AGENT_WORK = '/private/tmp/agent-work';
const PRIVATE_TMP = '/private/tmp';
const createdScratchDirs = new Map();

function pathExists(target) {
  try {
    lstatSync(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

const APPROVED_SYSTEM_SYMLINKS = new Map([
  ['/tmp', '/private/tmp'],
  ['/var', '/private/var'],
]);

function isApprovedSystemSymlink(componentPath, label) {
  const expected = APPROVED_SYSTEM_SYMLINKS.get(componentPath);
  if (!expected) return false;
  let target;
  try {
    target = readlinkSync(componentPath);
  } catch {
    throw new Error(`${label} symlink is not readable: ${componentPath}`);
  }
  if (path.resolve(path.dirname(componentPath), target) !== expected) return false;
  assertSafePathComponents(expected, label);
  return true;
}

function assertSafePathComponents(target, label) {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  let current = root;
  for (const component of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      throw new Error(`${label} path component is not readable: ${current}`);
    }
    if (stat.isSymbolicLink()) {
      const subject = current === resolved ? label : `${label} ancestor`;
      if (!isApprovedSystemSymlink(current, label)) throw new Error(`refusing symlink ${subject}: ${current}`);
      continue;
    }
    if (!stat.isDirectory()) {
      const subject = current === resolved ? label : `${label} path component`;
      throw new Error(`${subject} is not a directory: ${current}`);
    }
  }
  return resolved;
}

function validateExistingDirectory(candidate, label) {
  const unresolved = assertSafePathComponents(candidate, label);
  let real;
  try {
    real = realpathSync(unresolved);
  } catch {
    throw new Error(`${label} does not exist or is not readable: ${unresolved}`);
  }
  assertSafePathComponents(real, label);
  let stat;
  try {
    stat = lstatSync(real);
  } catch {
    throw new Error(`${label} real path is not readable: ${real}`);
  }
  if (stat.isSymbolicLink()) throw new Error(`refusing symlink ${label}: ${real}`);
  if (!stat.isDirectory()) throw new Error(`${label} is not a directory: ${real}`);
  let stable;
  try {
    stable = realpathSync(real);
  } catch {
    throw new Error(`${label} real path is unstable: ${real}`);
  }
  if (stable !== real) throw new Error(`unstable ${label} path: ${real}`);
  return { unresolved, real };
}

function approvedTmpBases() {
  const roots = new Set([validateExistingDirectory(os.tmpdir(), 'TMPDIR').real]);
  try {
    roots.add(validateExistingDirectory(PRIVATE_TMP, 'scratch root').real);
  } catch {
    // Not every host has macOS-style /private/tmp.
  }
  return [...roots];
}

function approvedBaseFor(candidate) {
  return approvedTmpBases().find(root => isWithin(root, candidate));
}

function validateRootCandidate(candidate, label = 'scratch root') {
  const { unresolved, real } = validateExistingDirectory(candidate, label);
  const approvedBase = approvedBaseFor(real);
  if (!approvedBase) {
    throw new Error(`refusing scratch root outside temporary scratch space: ${unresolved}`);
  }
  return real;
}

function validateScratchParent(parent, roots, requested) {
  const { real } = validateExistingDirectory(parent, 'scratch parent');
  if (!roots.some(root => isWithin(root, real))) {
    throw new Error(`refusing scratch directory outside temporary scratch space: ${requested}`);
  }
  return real;
}

function scratchRoots(allowedRoots) {
  if (allowedRoots !== undefined) {
    if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
      throw new Error('allowedRoots must be a non-empty array when provided');
    }
    return [...new Set(allowedRoots.map(root => validateRootCandidate(root)))];
  }

  const roots = new Set([validateRootCandidate(os.tmpdir(), 'TMPDIR')]);
  try {
    roots.add(validateRootCandidate(AGENT_WORK));
  } catch {
    // The optional agent-work root is only available on hosts that create it.
  }
  return [...roots];
}

function rememberScratchDir(target) {
  const stat = lstatSync(target);
  createdScratchDirs.set(target, { dev: stat.dev, ino: stat.ino });
  return target;
}

export function isCreatedScratchDir(target) {
  return createdScratchDirs.has(target);
}

export function verifyCreatedScratchDir(target) {
  const expected = createdScratchDirs.get(target);
  if (!expected) throw new Error(`scratch directory was not created by this process: ${target}`);
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    throw new Error(`created scratch directory is missing before cleanup: ${target}`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev !== expected.dev || stat.ino !== expected.ino) {
    throw new Error(`created scratch directory was replaced before cleanup: ${target}`);
  }
  return true;
}

export function createScratchDir(prefix, override, options = {}) {
  const roots = scratchRoots(options.allowedRoots);
  if (!override) return rememberScratchDir(mkdtempSync(path.join(roots[0], prefix)));

  const requested = path.resolve(override);
  if (pathExists(requested)) throw new Error(`refusing pre-existing scratch path: ${requested}`);

  const parent = validateScratchParent(path.dirname(requested), roots, requested);
  return rememberScratchDir(mkdtempSync(path.join(parent, prefix)));
}
