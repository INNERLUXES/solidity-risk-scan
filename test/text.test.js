import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flat, grouped, listText, plural, safeText } from '../src/index.js';

const code = (...points) => String.fromCharCode(...points);

test('safeText replaces control characters, line separators and direction controls with a space', () => {
  assert.equal(safeText(`a${code(27)}[31mb`), 'a [31mb');
  assert.equal(safeText(`a${code(0x202e)}b${code(0x2066)}c${code(0x2029)}d${code(0x85)}e${code(0xfeff)}f`), 'a b c d e f');
  assert.equal(safeText(`line1${code(10)}line2${code(13)}${code(0)}`), 'line1 line2  ');
  assert.equal(safeText(`tab${code(9)}here`), 'tab here');
});

test('safeText caps the length and marks the cut', () => {
  assert.equal(safeText('abcdef', 6), 'abcdef');
  assert.equal(safeText('abcdefg', 6), 'abc...');
  assert.equal(safeText('x'.repeat(1000)).length, 300);
  assert.equal(safeText('x'.repeat(10000000), 20).length, 20);
});

test('flat folds runs of white space into one space', () => {
  assert.equal(flat('  a \n\t b   c  '), 'a b c');
});

test('grouped, plural and listText fix the locale and the words', () => {
  assert.equal(grouped(1234567), '1,234,567');
  assert.equal(plural(1, 'file'), '1 file');
  assert.equal(plural(2, 'file'), '2 files');
  assert.equal(plural(0, 'library', 'libraries'), '0 libraries');
  assert.equal(plural(1500, 'line'), '1,500 lines');
  assert.equal(listText(['a']), 'a');
  assert.equal(listText(['a', 'b']), 'a and b');
  assert.equal(listText(['a', 'b', 'c']), 'a, b and c');
  assert.equal(listText(['a', 'b', 'c', 'd', 'e'], 3), 'a, b, c and 2 more');
});
