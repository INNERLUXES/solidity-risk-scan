import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES } from '../src/index.js';
import { BAD, EXPECTED, EXPLAIN, GOOD, GOOD_EXPECTED, UNWANTED, run } from '../tools/example.mjs';
import { cli, withFiles } from './helpers.js';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const saved = (name) => readFile(resolve(root, 'examples/output', name), 'utf8');
const source = (rel) => readFile(resolve(root, rel), 'utf8');

test('examples: the bad folder fails with the report that is saved in examples/output', async () => {
  const r = await run(BAD);
  assert.equal(r.code, 1);
  assert.equal(r.err, '');
  assert.equal(r.out, await saved('bad.txt'));
  for (const e of EXPECTED) assert.ok(r.out.includes(e), e);
  for (const u of UNWANTED) assert.ok(!r.out.includes(u), u);
});

test('examples: the good folder passes at error, warning and info level with the report that is saved', async () => {
  const r = await run(GOOD);
  assert.equal(r.code, 0);
  assert.equal(r.out, await saved('good.txt'));
  for (const e of GOOD_EXPECTED) assert.ok(r.out.includes(e), e);
  assert.equal((await run([...GOOD, '--fail-on', 'warning'])).code, 0);
  assert.equal((await run([...GOOD, '--fail-on', 'info'])).code, 0);
  assert.doesNotMatch(r.out, /ERROR {4}|WARNING {2}|INFO {5}/);
  assert.doesNotMatch(r.out, /\nnote: /);
  const json = JSON.parse((await run([...GOOD, '--json'])).out);
  assert.deepEqual(json.findings, []);
  assert.deepEqual(json.totals.byLevel, { error: 0, warning: 0, info: 0 });
});

test('examples: every output saved in examples/output is the real output, in all four formats for both folders', async () => {
  const outputs = {
    'bad.md': [...BAD, '--format', 'markdown'],
    'bad.json': [...BAD, '--json'],
    'bad.sarif': [...BAD, '--format', 'sarif'],
    'good.md': [...GOOD, '--format', 'markdown'],
    'good.json': [...GOOD, '--json'],
    'good.sarif': [...GOOD, '--format', 'sarif'],
    'checks.txt': ['--list-checks'],
    'checks.json': ['--list-checks', '--format', 'json'],
    'explain-call-before-state-write.txt': EXPLAIN,
    'explain-call-before-state-write.md': [...EXPLAIN, '--format', 'markdown']
  };
  for (const [name, args] of Object.entries(outputs)) assert.equal((await run(args)).out, await saved(name), name);
  const files = (await readdir(resolve(root, 'examples/output'))).sort();
  assert.deepEqual(files, ['bad.json', 'bad.md', 'bad.sarif', 'bad.txt', 'checks.json', 'checks.txt', 'explain-call-before-state-write.md', 'explain-call-before-state-write.txt', 'good.json', 'good.md', 'good.sarif', 'good.txt']);
});

test('examples: every check but file-unreadable fires on the bad folder, each on the line built for it', async () => {
  const report = JSON.parse((await run([...BAD, '--json'])).out);
  const cache = new Map();
  const lines = async (file) => {
    if (!cache.has(file)) cache.set(file, (await source(file)).split('\n'));
    return cache.get(file);
  };
  // 'file:line:column' of the n-th place in a file where a line holds needle.
  const at = async (file, needle, n = 1) => {
    const list = await lines(file);
    let seen = 0;
    for (let i = 0; i < list.length; i += 1) if (list[i].includes(needle) && (seen += 1) === n) return `${file}:${i + 1}`;
    throw new Error(`${file}: ${needle} x${n}`);
  };
  const where = (id, severity) => report.findings.filter((f) => f.id === id && (severity === undefined || f.severity === severity)).map((f) => f.at.split(':').slice(0, 2).join(':')).sort();
  assert.deepEqual(RULES.map((r) => r.id).filter((id) => where(id).length === 0), ['file-unreadable']);
  const L = 'examples/bad/LeakyVault.sol';
  const O = 'examples/bad/OriginWallet.sol';
  const U = 'examples/bad/UpgradeShim.sol';
  const D = 'examples/bad/LuckyDraw.sol';
  const R = 'examples/bad/OldRegistry.sol';
  assert.deepEqual(where('state-change-no-access-check', 'warning').sort(), [await at(L, 'function setFee'), await at(L, 'function setOwner'), await at(L, 'function capture'), await at(L, 'function refund'), await at(D, 'function join'), await at(R, 'function register'), await at(U, 'function forward'), await at(U, 'function run('), await at(U, 'function close(')].sort());
  assert.deepEqual(where('state-change-no-access-check', 'info'), [await at(L, 'function initialize')]);
  assert.deepEqual(where('unchecked-low-level-call', 'error'), [await at(L, 'to.call{value: msg.value}'), await at(L, 'to.send(amount)'), await at(L, '(bool ok, ) = to.call')]);
  assert.deepEqual(where('unchecked-low-level-call', 'info'), [await at(L, 'to.transfer(1 ether)')]);
  assert.deepEqual(where('call-before-state-write'), [await at(L, '(bool sent, ) = msg.sender.call'), await at(L, 'to.send(amount)'), await at(L, '(bool ok, ) = to.call')].sort());
  assert.deepEqual(where('tx-origin-auth', 'error'), [await at(O, 'require(tx.origin == owner'), await at(O, 'return tx.origin == owner')]);
  assert.deepEqual(where('tx-origin-auth', 'warning'), [await at(O, 'require(tx.origin == msg.sender')]);
  assert.deepEqual(where('delegatecall-use', 'error'), [await at(U, 'target.delegatecall(data)'), await at(U, 'let ok := delegatecall')]);
  assert.deepEqual(where('delegatecall-use', 'warning'), [await at(U, 'implementation.delegatecall(data)')]);
  assert.deepEqual(where('delegatecall-use', 'info'), [await at(U, 'implementation.delegatecall(data)', 2)]);
  assert.deepEqual(where('selfdestruct-use', 'warning'), [await at(U, 'selfdestruct(to)')]);
  assert.deepEqual(where('selfdestruct-use', 'info'), [await at(U, 'selfdestruct(to)', 2)]);
  assert.deepEqual(where('block-randomness'), [await at(D, 'keccak256(abi.encodePacked(block.timestamp'), await at(D, 'return block.number % 2'), await at(D, 'keccak256(abi.encode(blockhash')]);
  assert.deepEqual(where('unbounded-loop'), [await at(D, 'i < players.length'), await at(D, 'i < size')]);
  assert.deepEqual(where('floating-pragma'), [`${R}:1`]);
  assert.deepEqual(where('missing-spdx'), [`${R}:1`]);
  assert.deepEqual(where('secret-in-source'), [await at(R, 'string private note')]);
});

test('examples: the loop checks of the bad folder name the array in the condition, and the one that copies the length first is followed', async () => {
  const report = JSON.parse((await run([...BAD, '--json'])).out);
  const loops = report.findings.filter((f) => f.id === 'unbounded-loop');
  assert.equal(loops.length, 2);
  assert.ok(loops.every((f) => f.file === 'examples/bad/LuckyDraw.sol'));
  assert.deepEqual(loops.map((f) => f.confidence).sort(), ['high', 'medium']);
});

test('examples: the files are plain ASCII with LF line ends, with no key, no date and no number that reads like a year', async () => {
  for (const dir of ['examples/good', 'examples/bad']) {
    for (const name of await readdir(resolve(root, dir))) {
      const text = await source(`${dir}/${name}`);
      assert.ok([...text].every((c) => c.charCodeAt(0) < 128), name);
      assert.ok(!text.includes('\r'), name);
      assert.doesNotMatch(text, /\b(?:19|20)\d{2}\b/, name);
      assert.doesNotMatch(text, /\b\d{4}-\d{2}-\d{2}\b/, name);
    }
  }
});

test('examples: the good folder has a base contract, an interface, a library, modifiers and the patterns the checks accept, and the checks are not silenced by a comment', async () => {
  const good = JSON.parse((await run([...GOOD, '--json'])).out);
  assert.equal(good.summary.contracts, 4);
  assert.equal(good.summary.interfaces, 1);
  assert.equal(good.summary.libraries, 1);
  const vault = await source('examples/good/Vault.sol');
  for (const part of ['nonReentrant', 'onlyOwner', 'pragma solidity 0.8.24;', 'SPDX-License-Identifier', 'if (!sent) revert', 'balances[msg.sender] = held - amount;']) assert.ok(vault.includes(part), part);
  assert.ok(vault.indexOf('balances[msg.sender] = held - amount;') < vault.indexOf('msg.sender.call{value: amount}'), 'the state is written before the call');
  for (const dir of ['examples/good', 'examples/bad']) for (const name of await readdir(resolve(root, dir))) assert.doesNotMatch(await source(`${dir}/${name}`), /scan:ignore|risk-scan-disable|solhint-disable/, name);
});

test('examples: the good folder gives the same result with CRLF, with a byte order mark and as UTF-16, and the bad folder keeps its places', async () => {
  const files = (await readdir(resolve(root, 'examples/good'))).sort();
  const variants = {};
  for (const name of files) {
    const text = await source(`examples/good/${name}`);
    variants[`crlf/${name}`] = text.replace(/\n/g, '\r\n');
    variants[`cr/${name}`] = text.replace(/\n/g, '\r');
    variants[`bom/${name}`] = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]);
    variants[`utf16/${name}`] = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  }
  await withFiles(variants, async (dir) => {
    for (const kind of ['crlf', 'cr', 'bom', 'utf16']) {
      const r = await cli([kind, '--fail-on', 'info'], dir);
      assert.equal(r.code, 0, `${kind}: ${r.out}`);
      assert.match(r.out, /\nfindings: 0\n/, kind);
    }
  });
  const bad = {};
  for (const name of await readdir(resolve(root, 'examples/bad'))) bad[`bad/${name}`] = (await source(`examples/bad/${name}`)).replace(/\n/g, '\r\n');
  await withFiles(bad, async (dir) => {
    const r = await cli(['bad', '--json'], dir);
    const ids = JSON.parse(r.out).findings.map((f) => `${f.id}:${f.line}:${f.column}`).sort();
    const original = JSON.parse((await run([...BAD, '--json'])).out).findings.map((f) => `${f.id}:${f.line}:${f.column}`).sort();
    assert.deepEqual(ids, original);
  });
});
