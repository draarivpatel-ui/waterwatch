import { lstatSync, mkdtempSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const AGENT_WORK = '/private/tmp/agent-work';
const PRIVATE_TMP = '/private/tmp';
const createdScratchDirs = new Set();

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

function validateRootCandidate(candidate) {
  const resolved = path.resolve(candidate);
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink()) throw new Error(`refusing symlink scratch root: ${resolved}`);
  if (!stat.isDirectory()) throw new Error(`scratch root is not a directory: ${resolved}`);
  const real = realpathSync(resolved);
  if (!approvedTmpBases().some(root => isWithin(root, real))) {
    throw new Error(`refusing scratch root outside temporary scratch space: ${resolved}`);
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

  const roots = new Set([validateRootCandidate(os.tmpdir())]);
  try {
    roots.add(validateRootCandidate(AGENT_WORK));
  } catch {
    // The optional agent-work root is only available on hosts that create it.
  }
  return [...roots];
}

function rememberScratchDir(target) {
  createdScratchDirs.add(target);
  return target;
}

export function isCreatedScratchDir(target) {
  return createdScratchDirs.has(target);
}

export function createScratchDir(prefix, override, options = {}) {
  const roots = scratchRoots(options.allowedRoots);
  if (!override) return rememberScratchDir(mkdtempSync(path.join(roots[0], prefix)));

  const requested = path.resolve(override);
  if (pathExists(requested)) throw new Error(`refusing pre-existing scratch path: ${requested}`);

  const parent = path.dirname(requested);
  let parentStat;
  let realParent;
  try {
    parentStat = lstatSync(parent);
    realParent = realpathSync(parent);
  } catch {
    throw new Error(`scratch parent does not exist or is not readable: ${parent}`);
  }
  if (!roots.some(root => isWithin(root, realParent))) {
    throw new Error(`refusing scratch directory outside temporary scratch space: ${requested}`);
  }
  if (parentStat.isSymbolicLink()) throw new Error(`refusing symlink scratch parent: ${parent}`);
  if (!parentStat.isDirectory()) throw new Error(`scratch parent is not a directory: ${parent}`);

  return rememberScratchDir(mkdtempSync(path.join(realParent, prefix)));
}
