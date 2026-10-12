import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FILE_LIMITS, LIMITS, InputError, decode, displayPath, locateInput, readInputText, scanPaths } from '../src/index.js';
import { BAD, GOOD, cli, contract, run, withFiles } from './helpers.js';

const EACUTE = String.fromCharCode(0xe9);

test('decode: UTF-8 with and without a byte order mark, and UTF-16 in both byte orders', () => {
  assert.equal(decode(Buffer.from('contract C {}\n')), 'contract C {}\n');
  assert.equal(decode(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`"${EACUTE}"`, 'utf16le')])), `"${EACUTE}"`);
  const be = Buffer.from('{"a": 1}', 'utf16le').swap16();
  assert.equal(decode(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), '{"a": 1}');
  assert.equal(decode(Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), '{}');
});

test('decode: a null byte, bytes that are not UTF-8, an odd number of UTF-16 bytes and a lone UTF-16 surrogate are refused', () => {
  assert.throws(() => decode(Buffer.from([0x7b, 0x00, 0x7d])), /null byte/);
  assert.throws(() => decode(Buffer.from([0xc3, 0x28])), /not valid UTF-8/);
  assert.throws(() => decode(Buffer.from([0xff, 0xfe, 0x61])), /odd number of bytes/);
  assert.throws(() => decode(Buffer.from([0xff, 0xfe, 0x00, 0xd8])), /not valid UTF-16/);
});

test('displayPath: relative with forward slashes inside the folder, and the whole path outside it', () => {
  const base = resolve('/work/project');
  assert.equal(displayPath(resolve(base, 'contracts/Vault.sol'), base), 'contracts/Vault.sol');
  const outside = resolve(base, '..', 'elsewhere', 'Vault.sol');
  assert.ok(!displayPath(outside, base).includes('\\'));
  assert.ok(displayPath(outside, base).endsWith('elsewhere/Vault.sol'));
});

test('locateInput: a file is read; a folder and a missing path are refused', async () => {
  await withFiles({ 'a/Vault.sol': 'contract V {}' }, async (dir) => {
    assert.equal(await locateInput('a/Vault.sol', dir), resolve(dir, 'a/Vault.sol'));
    await assert.rejects(locateInput('a', dir), /is a folder/);
    await assert.rejects(locateInput('missing.sol', dir), /does not exist/);
    await assert.rejects(locateInput('a/Vault.sol/x', dir), /does not exist/);
  });
});

test('an absolute path is used as it is, with resolve() and not a join', async () => {
  await withFiles(GOOD, async (dir) => {
    const r = await cli([resolve(dir, 'Good.sol'), '--min-severity', 'error'], process.cwd());
    assert.equal(r.code, 0, r.err);
  });
});

test('a path that does not exist is an input error with exit code 2 and no report', async () => {
  const r = await run({}, ['Missing.sol']);
  assert.equal(r.code, 2);
  assert.equal(r.out, '');
  assert.match(r.err, /no result, the input has a problem:\n {2}Missing\.sol: does not exist/);
});

test('a folder with no Solidity file in it is an input error, not a pass', async () => {
  const r = await run({ 'notes/readme.txt': 'hello', 'lib/Dep.sol': 'contract D {}', 'node_modules/x/X.sol': 'contract X {}' }, ['.']);
  assert.equal(r.code, 2);
  assert.match(r.err, /no Solidity file was found in the path given/);
  assert.match(r.err, /--include-tests/);
});

test('a file over the size limit is a file-unreadable finding that names the limit, and the other files are still read', async () => {
  await withFiles({ 'Big.sol': contract('    uint256 a;'), 'Bad.sol': BAD['Bad.sol'] }, async (dir) => {
    const report = await scanPaths({ paths: ['.'], version: '0', base: dir, limits: { ...LIMITS, maxBytes: 60 } });
    const unreadable = report.findings.filter((f) => f.id === 'file-unreadable');
    assert.equal(unreadable.length, 2);
    assert.ok(unreadable.every((f) => /is larger than 60 bytes/.test(f.message)));
    assert.equal(report.summary.notRead, 2);
  });
  assert.ok(FILE_LIMITS.maxBytes >= 1024 * 1024);
});

test('the files of one run are read up to a total, and a file past it is a finding that names the limit', async () => {
  const files = { 'A.sol': contract('    uint256 a;'), 'B.sol': contract('    uint256 b;'), 'C.sol': contract('    uint256 c;'), 'D.sol': contract('    uint256 d;') };
  await withFiles(files, async (dir) => {
    const report = await scanPaths({ paths: ['.'], version: '0', base: dir, limits: { ...LIMITS, maxTotalBytes: 100 } });
    const unread = report.findings.filter((f) => f.id === 'file-unreadable');
    assert.deepEqual(unread.map((f) => f.file), ['C.sol', 'D.sol']);
    assert.ok(unread.every((f) => f.message.includes('hold more than 100 bytes, the limit of one run')));
  });
});

test('a binary file and bytes that are not UTF-8 are file-unreadable findings with exit code 1, and the good file next to them is still read', async () => {
  const r = await run({ 'Bin.sol': Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]), 'Odd.sol': Buffer.from([0x7b, 0xc3, 0x28, 0x7d]), 'Good.sol': GOOD['Good.sol'] }, ['.']);
  assert.equal(r.code, 1);
  assert.match(r.out, /ERROR {4}file-unreadable +Bin\.sol:1:1\n {11}The file was not read: holds a null byte; it is not a text file\. Nothing in the file was checked\./);
  assert.match(r.out, /ERROR {4}file-unreadable +Odd\.sol:1:1\n {11}The file was not read: is not valid UTF-8/);
  assert.match(r.out, /files: 1 read, 2 not read/);
});

test('a file that does not end its comment or its string is a file-unreadable finding at the place it stops, and nothing in it is checked', async () => {
  const r = await run({ 'A.sol': 'contract A {\n  /* never closed\n}\n', 'B.sol': 'contract B {\n  string s = "open;\n}\n', 'C.sol': 'contract C { function f( }\n' }, ['.']);
  assert.equal(r.code, 1);
  assert.match(r.out, /file-unreadable +A\.sol:2:3\n {11}The file could not be followed: a comment is never closed; the file ends inside it\. Nothing in the file was checked\./);
  assert.match(r.out, /file-unreadable +B\.sol:2:14\n {11}The file could not be followed: a string is never closed; the line ends inside it/);
  assert.match(r.out, /file-unreadable +C\.sol:1:26\n {11}The file could not be followed: the bracket "\}" does not close the "\(" opened at line 1, column 24/);
});

test('a UTF-8 file with a byte order mark, UTF-16 files and every kind of line end give the same findings as the plain file', async () => {
  const text = BAD['Bad.sol'];
  const plain = await run({ 'Bad.sol': text }, ['.', '--json']);
  const expected = JSON.parse(plain.out).findings.map((f) => `${f.id}:${f.line}:${f.column}`);
  assert.ok(expected.length > 0);
  const variants = {
    'crlf.sol': text.replace(/\n/g, '\r\n'),
    'cr.sol': text.replace(/\n/g, '\r'),
    'bom.sol': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]),
    'utf16.sol': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]),
    'utf16be.sol': Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()])
  };
  for (const [name, content] of Object.entries(variants)) {
    const r = await run({ [name]: content }, [name, '--json']);
    const ids = JSON.parse(r.out).findings.map((f) => `${f.id}:${f.line}:${f.column}`);
    assert.deepEqual(ids, expected, name);
  }
});

test('a symbolic link given as a path is refused by name, not followed', { skip: process.platform === 'win32' ? 'creating symbolic links needs a privilege on Windows' : false }, async () => {
  await withFiles({ 'real/Vault.sol': 'contract V {}' }, async (dir) => {
    await mkdir(resolve(dir, 'linked'));
    await symlink(resolve(dir, 'real/Vault.sol'), resolve(dir, 'linked/Vault.sol'));
    const r = await cli(['linked/Vault.sol'], dir);
    assert.equal(r.code, 2);
    assert.match(r.err, /symbolic link/);
  });
});

test('a device is refused as not a regular file', { skip: process.platform === 'win32' ? 'there is no /dev/null on Windows' : false }, async () => {
  const r = await cli(['/dev/null'], process.cwd());
  assert.equal(r.code, 2);
  assert.match(r.err, /not a regular file/);
});

test('readInputText reads a file through a handle and reports its size in bytes', async () => {
  await withFiles({ 'A.sol': `// ${EACUTE}\n` }, async (dir) => {
    const r = await readInputText(resolve(dir, 'A.sol'), dir);
    assert.equal(r.text, `// ${EACUTE}\n`);
    assert.equal(r.bytes, 6);
  });
  await assert.rejects(withFiles({ 'A.sol': 'x' }, (dir) => readInputText(resolve(dir, 'B.sol'), dir)), (e) => e instanceof InputError);
});

test('a file named on the command line is read whatever its name, and a file given twice is read once', async () => {
  const r = await run({ 'contracts.txt': GOOD['Good.sol'] }, ['contracts.txt', 'contracts.txt', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).files.length, 1);
});
