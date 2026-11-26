import { lstatSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const AGENT_WORK = '/private/tmp/agent-work';

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

function scratchRoots() {
  const roots = new Set([realpathSync(os.tmpdir())]);
  try {
    roots.add(realpathSync(AGENT_WORK));
  } catch {
    // The optional agent-work root is only available on hosts that create it.
  }
  return [...roots];
}

export function createScratchDir(prefix, override) {
  const tmpRoot = realpathSync(os.tmpdir());
  if (!override) return mkdtempSync(path.join(tmpRoot, prefix));

  const requested = path.resolve(override);
  const parent = path.dirname(requested);
  let realParent;
  try {
    realParent = realpathSync(parent);
  } catch {
    throw new Error(`scratch parent does not exist or is not readable: ${parent}`);
  }
  if (!scratchRoots().some(root => isWithin(root, realParent))) {
    throw new Error(`refusing scratch directory outside temporary scratch space: ${requested}`);
  }

  const target = path.join(realParent, path.basename(requested));
  if (pathExists(target)) throw new Error(`refusing pre-existing scratch path: ${target}`);
  mkdirSync(target);
  return target;
}
