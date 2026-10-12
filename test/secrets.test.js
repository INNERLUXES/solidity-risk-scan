import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECRET_KEYS, isSecretKey, secretShape } from '../src/index.js';
import { cli, contract, run, sol } from './helpers.js';

// Every value below is built from repeated characters, so that no file of this repository holds anything that could be a real
// key or seed. A near miss is built the same way, one character or one word away.
const words = (n, word = 'abc') => Array.from({ length: n }, () => word).join(' ');
const hex = (n, ch = 'a') => ch.repeat(n);
const base58 = (n, ch = 'K') => ch.repeat(n);

test('the shapes: a mnemonic of 12, 15, 18, 21 or 24 words, an extended private key, a key in hex and a key in WIF', () => {
  for (const n of [12, 15, 18, 21, 24]) assert.equal(secretShape(words(n)), 'a mnemonic', String(n));
  assert.equal(secretShape(`xprv${base58(110)}`), 'an extended private key');
  assert.equal(secretShape(hex(64)), 'a private key in hex');
  assert.equal(secretShape(`0x${hex(64)}`), 'a private key in hex');
  assert.equal(secretShape(`5${base58(50, 'H')}`), 'a private key in WIF');
  assert.equal(secretShape(`L${base58(50, 'H')}`), 'a private key in WIF');
});

test('near misses on each side are not a shape: 11 and 13 words, 63 and 65 hex digits, a short extended key, a WIF of the wrong length', () => {
  for (const n of [1, 11, 13, 14, 25]) assert.equal(secretShape(words(n)), null, String(n));
  assert.equal(secretShape(words(12, 'ab')), null);
  assert.equal(secretShape(words(12, 'abcdefghi')), null);
  assert.equal(secretShape(hex(63)), null);
  assert.equal(secretShape(hex(65)), null);
  assert.equal(secretShape(`0x${hex(63)}`), null);
  assert.equal(secretShape(`xprv${base58(99)}`), null);
  assert.equal(secretShape(`5${base58(48, 'H')}`), null);
  assert.equal(secretShape(`M${base58(50, 'H')}`), null);
  assert.equal(secretShape(`${hex(32)}${'g'}${hex(31)}`), null);
});

test('a text over 4000 characters is not looked at, and plain text is not a shape', () => {
  assert.equal(secretShape(`${words(12)} ${'x'.repeat(4000)}`), null);
  assert.equal(secretShape('the quick brown fox jumps over the lazy dog'), null);
  assert.equal(secretShape(''), null);
});

test('the names of keys that hold a seed or a key are read with case and separators ignored', () => {
  for (const name of ['mnemonic', 'Seed_Phrase', 'private-key', 'PRIVATE KEY', 'xprv', 'WIF', 'passphrase']) assert.equal(isSecretKey(name), true, name);
  for (const name of ['owner', 'seeded', 'keys', 'privateKeyHash2x', 'price']) assert.equal(isSecretKey(name), false, name);
  assert.ok(SECRET_KEYS.includes('mnemonic'));
});

test('a secret in a string is a finding with its place, in every format, and the value is shown nowhere', async () => {
  const secret = words(12, 'qwx');
  const key = `0x${hex(64, 'c')}`;
  const files = { 'Keys.sol': sol(`contract K {\n    string private a = "${secret}";\n    string private b = "${key}";\n    // ${words(15, 'zyx')}\n}`) };
  for (const format of ['text', 'markdown', 'json', 'sarif']) {
    const r = await run(files, ['Keys.sol', '--format', format]);
    assert.equal(r.code, 1, format);
    assert.equal((r.out.match(/secret-in-source/g) ?? []).length >= 3, true, format);
    for (const value of ['qwx', hex(64, 'c'), 'zyx']) assert.ok(!r.out.includes(value) && !r.err.includes(value), `${format}: ${value}`);
  }
  const json = JSON.parse((await run(files, ['Keys.sol', '--json'])).out);
  assert.deepEqual(json.findings.filter((f) => f.id === 'secret-in-source').map((f) => f.line), [4, 5, 6]);
  assert.match(json.findings.find((f) => f.id === 'secret-in-source').message, /^A string is shaped like a mnemonic\./);
});

test('a hex literal and a number in hex are not looked at: a hash constant has the shape of a key', async () => {
  const r = await run({ 'Hash.sol': contract(`    bytes32 private constant A = hex"${hex(64)}";\n    bytes32 private constant B = 0x${hex(64)};`) }, ['Hash.sol']);
  assert.equal(r.code, 0, r.out);
});

test('the explanation of the check says why a hash constant is left alone', async () => {
  const r = await cli(['--explain', 'secret-in-source'], process.cwd());
  assert.match(r.out, /a hash constant has the same shape as a key/);
});
