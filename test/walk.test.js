import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { InputError, SKIPPED_FOLDERS, TEST_FOLDERS, WALK_LIMITS, collectInputs, scanPaths } from '../src/index.js';
import { cli, run, withFiles } from './helpers.js';

const C = 'contract C {}\n';
const TREE = {
  'src/A.sol': C,
  'src/deep/er/B.sol': C,
  'src/Z.SOL': C,
  'src/readme.md': 'text',
  'src/A.t.sol': C,
  'test/T.sol': C,
  'tests/U.sol': C,
  'lib/dep/D.sol': C,
  'node_modules/pkg/N.sol': C,
  '.git/hooks/G.sol': C,
  'script/Deploy.sol': C
};
const shown = async (paths, dir, options) => (await collectInputs(paths, dir, options)).files.map((f) => f.shown);

test('a folder is walked: Solidity files in every folder, sorted by path, with forward slashes, and nothing else', async () => {
  await withFiles(TREE, async (dir) => {
    assert.deepEqual(await shown(['.'], dir), ['script/Deploy.sol', 'src/A.sol', 'src/Z.SOL', 'src/deep/er/B.sol']);
  });
});

test('node_modules, lib and .git are left out of a walk always, and the folders test and tests and the files ending in .t.sol unless asked', async () => {
  await withFiles(TREE, async (dir) => {
    const all = await shown(['.'], dir, { includeTests: true });
    assert.deepEqual(all, ['script/Deploy.sol', 'src/A.sol', 'src/A.t.sol', 'src/Z.SOL', 'src/deep/er/B.sol', 'test/T.sol', 'tests/U.sol']);
    assert.ok(!all.some((f) => /node_modules|\.git|lib\//.test(f)));
  });
  assert.deepEqual(SKIPPED_FOLDERS, ['node_modules', 'lib', '.git']);
  assert.deepEqual(TEST_FOLDERS, ['test', 'tests']);
});

test('a file named on the command line is always read, and so is a folder named on it, even if it is called lib or test', async () => {
  await withFiles(TREE, async (dir) => {
    assert.deepEqual(await shown(['src/A.t.sol'], dir), ['src/A.t.sol']);
    assert.deepEqual(await shown(['lib'], dir), ['lib/dep/D.sol']);
    assert.deepEqual(await shown(['test', 'tests'], dir), ['test/T.sol', 'tests/U.sol']);
    assert.deepEqual(await shown(['src/readme.md'], dir), ['src/readme.md']);
  });
});

test('several paths are joined, a file reached twice is read once, and the order does not depend on the order of the arguments', async () => {
  await withFiles(TREE, async (dir) => {
    const a = await shown(['src', 'script', 'src/A.sol'], dir);
    const b = await shown(['script', 'src/A.sol', 'src'], dir);
    assert.deepEqual(a, b);
    assert.deepEqual(a, ['script/Deploy.sol', 'src/A.sol', 'src/Z.SOL', 'src/deep/er/B.sol']);
  });
});

test('the number of files, the depth and the number of entries are bounded, and the folder that went past the limit is named', async () => {
  const files = {};
  for (let i = 0; i < 12; i += 1) files[`many/F${String(i).padStart(2, '0')}.sol`] = C;
  files['a/b/c/d/Deep.sol'] = C;
  await withFiles(files, async (dir) => {
    const cut = await collectInputs(['many'], dir, { limits: { ...WALK_LIMITS, maxFiles: 5 } });
    assert.equal(cut.files.length, 5);
    assert.deepEqual(cut.truncated, ['many']);
    assert.deepEqual(cut.files.map((f) => f.shown), ['many/F00.sol', 'many/F01.sol', 'many/F02.sol', 'many/F03.sol', 'many/F04.sol']);
    const entries = await collectInputs(['many'], dir, { limits: { ...WALK_LIMITS, maxEntries: 3 } });
    assert.deepEqual(entries.truncated, ['many']);
    const shallow = await collectInputs(['a'], dir, { limits: { ...WALK_LIMITS, maxDepth: 2 } });
    assert.equal(shallow.files.length, 0);
    assert.equal(shallow.notes[0], 'a/b/c/d: deeper than 2 folders; it was left out');
    const fine = await collectInputs(['a'], dir, { limits: { ...WALK_LIMITS, maxDepth: 3 } });
    assert.equal(fine.files.length, 1);
  });
});

test('a walk that is cut short is a file-unreadable finding for the folder, so a run cannot pass on part of it', async () => {
  const files = {};
  for (let i = 0; i < 6; i += 1) files[`many/F${i}.sol`] = C;
  await withFiles(files, async (dir) => {
    const report = await scanPaths({ paths: ['many'], version: '0', base: dir, walk: { ...WALK_LIMITS, maxFiles: 3 } });
    const [f] = report.findings.filter((x) => x.id === 'file-unreadable');
    assert.equal(f.file, 'many');
    assert.match(f.message, /holds more than 3 Solidity files/);
    assert.equal(report.result.pass, false);
  });
});

test('a path that does not exist is an input error, and a path whose parent is a file too', async () => {
  await withFiles({ 'F.sol': C }, async (dir) => {
    await assert.rejects(collectInputs(['nope'], dir), (e) => e instanceof InputError && /nope: does not exist/.test(e.message));
    await assert.rejects(collectInputs(['F.sol/x'], dir), /does not exist/);
  });
});

test('a path with the name of a folder that has no Solidity file in it gives no file, and the run says so', async () => {
  const r = await run({ 'docs/readme.md': 'x' }, ['docs']);
  assert.equal(r.code, 2);
  assert.match(r.err, /no Solidity file was found/);
});

test('the folders are visited in the order of their names whatever order the system lists them in', async () => {
  await withFiles({ 'b/B.sol': C, 'a/A.sol': C, 'c/C.sol': C, 'a/b/AB.sol': C }, async (dir) => {
    assert.deepEqual(await shown(['.'], dir), ['a/A.sol', 'a/b/AB.sol', 'b/B.sol', 'c/C.sol']);
  });
});

test('a symbolic link to a file inside the folder is followed, to a file outside it is refused, to a folder is not followed', { skip: process.platform === 'win32' ? 'creating symbolic links needs a privilege on Windows' : false }, async () => {
  await withFiles({ 'root/src/Real.sol': C, 'root/lib/Dep.sol': C, 'outside/Secret.sol': C }, async (dir) => {
    const root = resolve(dir, 'root');
    await symlink(resolve(dir, 'root/src/Real.sol'), resolve(root, 'InsideLink.sol'));
    await symlink(resolve(dir, 'root/lib/Dep.sol'), resolve(root, 'LibLink.sol'));
    await symlink(resolve(dir, 'outside/Secret.sol'), resolve(root, 'OutsideLink.sol'));
    await mkdir(resolve(root, 'real'));
    await symlink(resolve(dir, 'root/src'), resolve(root, 'FolderLink'));
    await symlink(resolve(dir, 'root/gone.sol'), resolve(root, 'Broken.sol'));
    const found = await collectInputs(['root'], dir);
    assert.deepEqual(found.files.map((f) => f.shown), ['root/LibLink.sol', 'root/src/Real.sol']);
    assert.ok(found.notes.some((n) => /OutsideLink\.sol: a symbolic link to a place outside the folder given; it was refused/.test(n)));
    assert.ok(found.notes.some((n) => /FolderLink: a symbolic link to a folder; it was not followed/.test(n)));
    assert.ok(found.notes.some((n) => /Broken\.sol: a symbolic link that leads nowhere/.test(n)));
    const r = await cli(['root', '--json'], dir);
    assert.ok(!r.out.includes('Secret'));
  });
});

test('a folder given as a symbolic link is refused as a path of the command line', { skip: process.platform === 'win32' ? 'creating symbolic links needs a privilege on Windows' : false }, async () => {
  await withFiles({ 'real/A.sol': C }, async (dir) => {
    await symlink(resolve(dir, 'real'), resolve(dir, 'linked'));
    const r = await cli(['linked'], dir);
    assert.equal(r.code, 2);
    assert.match(r.err, /symbolic link/);
  });
});
