import { lstatSync, mkdtempSync, realpathSync } from 'node:fs';
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

function approvedTmpBases() {
  const roots = new Set([realpathSync(os.tmpdir())]);
  try {
    roots.add(realpathSync(PRIVATE_TMP));
  } catch {
    // Not every host has macOS-style /private/tmp.
  }
  return [...roots];
}

function approvedBaseFor(candidate) {
  return approvedTmpBases().find(root => isWithin(root, candidate));
}

function assertNoSymlinkedComponents(root, target, label) {
  const chain = [root];
  const relative = path.relative(root, target);
  if (relative !== '') {
    let current = root;
    for (const component of relative.split(path.sep)) {
      current = path.join(current, component);
      chain.push(current);
    }
  }
  for (const componentPath of chain) {
    let stat;
    try {
      stat = lstatSync(componentPath);
    } catch {
      throw new Error(`${label} path component is not readable: ${componentPath}`);
    }
    if (stat.isSymbolicLink()) throw new Error(`refusing symlink ${label} ancestor: ${componentPath}`);
    if (!stat.isDirectory()) throw new Error(`${label} path component is not a directory: ${componentPath}`);
  }
}

function validateRootCandidate(candidate) {
  const resolved = path.resolve(candidate);
  let stat;
  try {
    stat = lstatSync(resolved);
  } catch {
    throw new Error(`scratch root does not exist or is not readable: ${resolved}`);
  }
  if (stat.isSymbolicLink()) throw new Error(`refusing symlink scratch root: ${resolved}`);
  if (!stat.isDirectory()) throw new Error(`scratch root is not a directory: ${resolved}`);
  const real = realpathSync(resolved);
  const approvedBase = approvedBaseFor(real);
  if (!approvedBase) {
    throw new Error(`refusing scratch root outside temporary scratch space: ${resolved}`);
  }
  if (resolved !== real || resolved !== realpathSync(resolved)) {
    throw new Error(`refusing non-canonical scratch root: ${resolved}`);
  }
  assertNoSymlinkedComponents(approvedBase, resolved, 'scratch root');
  if (resolved !== realpathSync(resolved)) throw new Error(`unstable scratch root path: ${resolved}`);
  return resolved;
}

function validateScratchParent(parent, roots, requested) {
  const resolved = path.resolve(parent);
  let stat;
  let real;
  try {
    stat = lstatSync(resolved);
    real = realpathSync(resolved);
  } catch {
    throw new Error(`scratch parent does not exist or is not readable: ${parent}`);
  }
  if (!roots.some(root => isWithin(root, real))) {
    throw new Error(`refusing scratch directory outside temporary scratch space: ${requested}`);
  }
  if (stat.isSymbolicLink()) throw new Error(`refusing symlink scratch parent: ${parent}`);
  if (!stat.isDirectory()) throw new Error(`scratch parent is not a directory: ${parent}`);
  if (resolved !== real || resolved !== realpathSync(resolved)) {
    throw new Error(`refusing non-canonical scratch parent: ${resolved}`);
  }
  const approvedBase = approvedBaseFor(resolved);
  if (!approvedBase) {
    throw new Error(`refusing scratch directory outside temporary scratch space: ${requested}`);
  }
  assertNoSymlinkedComponents(approvedBase, resolved, 'scratch parent');
  if (resolved !== realpathSync(resolved)) throw new Error(`unstable scratch parent path: ${resolved}`);
  return resolved;
}

function scratchRoots(allowedRoots) {
  if (allowedRoots !== undefined) {
    if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
      throw new Error('allowedRoots must be a non-empty array when provided');
    }
    return [...new Set(allowedRoots.map(root => validateRootCandidate(root)))];
  }

  const roots = new Set([validateRootCandidate(realpathSync(os.tmpdir()))]);
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
