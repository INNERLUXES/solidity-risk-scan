// Finding the files to read. A path on the command line is a file or a folder. A folder is walked with an explicit stack, never
// by recursion, to a depth and a number of files that are bounded. The folders node_modules, lib and .git are always left
// out, the folders test and tests and the files that end in .t.sol are left out unless the run asks for them, and a symbolic
// link is followed only when it is a file whose real path is inside the folder that was asked for. Nothing is written.

import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { InputError, displayPath, locateInput } from './files.js';
import { safeText } from './text.js';

export const WALK_LIMITS = { maxFiles: 5000, maxDepth: 64, maxEntries: 200000 };

export const SKIPPED_FOLDERS = ['node_modules', 'lib', '.git'];
export const TEST_FOLDERS = ['test', 'tests'];

const inside = (root, path) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// The files named by the paths, as [{ absolute, shown }] sorted by the path shown, with notes about what was left out, and the
// folders given that held more than the limits allow (truncated).
// Throws InputError for a path that is missing, a link, or a device.
export async function collectInputs(paths, base, { includeTests = false, limits = WALK_LIMITS } = {}) {
  const found = new Map();
  const notes = [];
  let entries = 0;
  const truncated = [];
  let current = '';
  const cut = () => {
    if (!truncated.includes(current)) truncated.push(current);
  };
  // A file reached through a link and also under its own name is read once, under its own name.
  const add = async (absolute, shownPath, viaLink = false) => {
    let key = absolute;
    if (!viaLink) {
      try {
        key = await realpath(absolute);
      } catch {
        key = absolute;
      }
    }
    const existing = found.get(key);
    if (existing !== undefined) {
      if (existing.viaLink && !viaLink) found.set(key, { absolute, shown: displayPath(shownPath, base), viaLink });
      return;
    }
    if (found.size >= limits.maxFiles) {
      cut();
      return;
    }
    found.set(key, { absolute, shown: displayPath(shownPath, base), viaLink });
  };
  for (const given of paths) {
    const absolute = resolve(base, given);
    current = displayPath(absolute, base);
    let s;
    try {
      s = await lstat(absolute);
    } catch (error) {
      const shown = displayPath(absolute, base);
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new InputError([`${shown}: does not exist`]);
      throw new InputError([`${shown}: ${error.code ?? 'cannot be read'}`]);
    }
    if (!s.isDirectory()) {
      await add(await locateInput(given, base), absolute);
      continue;
    }
    const root = await realpath(absolute);
    const stack = [{ dir: absolute, depth: 0 }];
    while (stack.length > 0) {
      const { dir, depth } = stack.pop();
      let list;
      try {
        list = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        notes.push(`${displayPath(dir, base)}: the folder could not be read (${error.code ?? 'error'}); it was left out`);
        continue;
      }
      list.sort(byName);
      const subfolders = [];
      for (const entry of list) {
        entries += 1;
        if (entries > limits.maxEntries) {
          cut();
          break;
        }
        const full = resolve(dir, entry.name);
        if (entry.isSymbolicLink()) {
          let target;
          try {
            target = await realpath(full);
          } catch {
            notes.push(`${displayPath(full, base)}: a symbolic link that leads nowhere; it was left out`);
            continue;
          }
          if (!inside(root, target)) {
            notes.push(`${displayPath(full, base)}: a symbolic link to a place outside the folder given; it was refused`);
            continue;
          }
          let t;
          try {
            t = await stat(target);
          } catch {
            continue;
          }
          if (t.isDirectory()) {
            notes.push(`${displayPath(full, base)}: a symbolic link to a folder; it was not followed`);
            continue;
          }
          if (t.isFile() && entry.name.toLowerCase().endsWith('.sol') && (includeTests || !entry.name.toLowerCase().endsWith('.t.sol'))) await add(target, full, true);
          continue;
        }
        if (entry.isDirectory()) {
          if (SKIPPED_FOLDERS.includes(entry.name)) continue;
          if (!includeTests && TEST_FOLDERS.includes(entry.name)) continue;
          if (depth + 1 > limits.maxDepth) {
            notes.push(`${displayPath(full, base)}: deeper than ${limits.maxDepth} folders; it was left out`);
            continue;
          }
          subfolders.push({ dir: full, depth: depth + 1 });
        } else if (entry.isFile()) {
          const lower = entry.name.toLowerCase();
          if (lower.endsWith('.sol') && (includeTests || !lower.endsWith('.t.sol'))) await add(full, full);
        }
      }
      // pushed in reverse, so the folders are visited in the order of their names
      for (let k = subfolders.length - 1; k >= 0; k -= 1) stack.push(subfolders[k]);
      if (entries > limits.maxEntries) break;
    }
  }
  const files = [...found.values()].map((f) => ({ absolute: f.absolute, shown: f.shown }));
  files.sort((a, b) => (a.shown < b.shown ? -1 : a.shown > b.shown ? 1 : 0));
  return { files, truncated, notes: notes.map((n) => safeText(n, 600)) };
}
