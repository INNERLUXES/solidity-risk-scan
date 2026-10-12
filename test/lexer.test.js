import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEX_LIMITS, LexError, lex } from '../src/index.js';

const EACUTE = String.fromCharCode(0xe9);
const values = (src) => lex(src).tokens.map((t) => t.v);
const kinds = (src) => lex(src).tokens.map((t) => t.k);
const failure = (src, limits) => {
  try {
    lex(src, limits);
  } catch (error) {
    assert.ok(error instanceof LexError);
    return error;
  }
  return assert.fail(`no error for ${JSON.stringify(src.slice(0, 40))}`);
};

test('identifiers, numbers, strings and punctuation get their kinds', () => {
  assert.deepEqual(kinds('uint256 x = 0x1F + 3.5e10 ; s = "a";'), ['id', 'id', 'pun', 'num', 'pun', 'num', 'pun', 'id', 'pun', 'str', 'pun']);
  assert.deepEqual(values('a.b(c)[d]{e};'), ['a', '.', 'b', '(', 'c', ')', '[', 'd', ']', '{', 'e', '}', ';']);
});

test('line and column count from 1 for LF, CRLF and CR line ends and tabs, and agree for the three', () => {
  const lines = ['a b', '\tc', '  d'];
  const where = (eol) => lex(lines.join(eol)).tokens.map((t) => `${t.v}@${t.line}:${t.col}`);
  const expected = ['a@1:1', 'b@1:3', 'c@2:2', 'd@3:3'];
  assert.deepEqual(where('\n'), expected);
  assert.deepEqual(where('\r\n'), expected);
  assert.deepEqual(where('\r'), expected);
});

test('comments are skipped, and the lines inside a block comment are counted', () => {
  const t = lex('a // b c\n/* d\n e\r\n f */ g\r// h\ni').tokens;
  assert.deepEqual(t.map((x) => `${x.v}@${x.line}:${x.col}`), ['a@1:1', 'g@4:7', 'i@6:1']);
});

test('the license line is found in a line comment and in a block comment, and not in a string', () => {
  assert.equal(lex('// SPDX-License-Identifier: MIT\n').spdx, true);
  assert.equal(lex('/* SPDX-License-Identifier: MIT */').spdx, true);
  assert.equal(lex('x = "SPDX-License-Identifier: MIT";').spdx, false);
  assert.equal(lex('// SPDX-License-Identifie: MIT').spdx, false);
});

test('a comment of 47 to 4000 characters is kept for the search for secrets, and a short or a very long one is not', () => {
  assert.equal(lex(`// ${'a'.repeat(46)}`).comments.length, 1);
  assert.equal(lex(`// ${'a'.repeat(40)}`).comments.length, 0);
  assert.equal(lex(`// ${'a'.repeat(4001)}`).comments.length, 0);
  assert.equal(lex(`/* ${'a'.repeat(50)} */`).comments.length, 1);
});

test('strings: both quotes, escapes, an escaped quote, and a backslash before a line end', () => {
  const [a, b, c, d] = lex('"a\\"b" \'c\\\'d\' "e\\\nf" "g"').tokens;
  assert.equal(a.v, 'a\\"b');
  assert.equal(b.v, "c\\'d");
  assert.equal(c.k, 'str');
  assert.equal(d.line, 2);
  assert.equal(a.n, 4);
});

test('unicode and hex strings are strings with a prefix, and the word alone is an identifier', () => {
  const t = lex(`unicode"h${EACUTE}" hex"00ff" hex unicode`).tokens;
  assert.deepEqual(t.map((x) => [x.k, x.pre]), [['str', 'unicode'], ['str', 'hex'], ['id', undefined], ['id', undefined]]);
  assert.equal(t[0].v, `h${EACUTE}`);
});

test('a string body is cut at 4001 characters but its length is kept', () => {
  const [t] = lex(`"${'a'.repeat(5000)}"`).tokens;
  assert.equal(t.v.length, 4001);
  assert.equal(t.n, 5000);
});

test('numbers: decimals with underscores, fractions, exponents, hex, and a unit written after them', () => {
  assert.deepEqual(values('1_000 + .5 + 0.5 1e18 1.5e-3 0xFF_ff 2 ether'), ['1_000', '+', '.5', '+', '0.5', '1e18', '1.5e-3', '0xFF_ff', '2', 'ether']);
  assert.deepEqual(values('a.b a [1].x'), ['a', '.', 'b', 'a', '[', '1', ']', '.', 'x']);
  assert.deepEqual(values('x.5'), ['x', '.', '5']);
});

test('operators are read longest first', () => {
  assert.deepEqual(values('a>>>=b >>> >>= >> >= > <<= << <= < == = != ! => ** * ++ + -- - += -= && || | & ^ ~ ? : := ->'), ['a', '>>>=', 'b', '>>>', '>>=', '>>', '>=', '>', '<<=', '<<', '<=', '<', '==', '=', '!=', '!', '=>', '**', '*', '++', '+', '--', '-', '+=', '-=', '&&', '||', '|', '&', '^', '~', '?', ':', ':=', '->']);
});

test('a pragma is read as raw text up to its semicolon, with its version numbers whole', () => {
  const t = lex('pragma solidity ^0.8.24;\npragma solidity >=0.8.0\n  <0.9.0;\ncontract C {}').tokens;
  assert.deepEqual(t.slice(0, 6).map((x) => [x.k, x.v]), [['id', 'pragma'], ['pragma', 'solidity ^0.8.24'], ['pun', ';'], ['id', 'pragma'], ['pragma', 'solidity >=0.8.0\n  <0.9.0'], ['pun', ';']]);
  assert.equal(t[6].line, 4);
});

test('the word pragma used as a name is not a pragma', () => {
  assert.deepEqual(values('x.pragma = 1;'), ['x', '.', 'pragma', '=', '1', ';']);
  assert.deepEqual(values('pragma = 1;'), ['pragma', '=', '1', ';']);
});

test('an assembly block is marked as a region: its tokens have asm, and the opening brace knows its closing brace', () => {
  const t = lex('f() { assembly { let x := 1 if x { y := 2 } } z }').tokens;
  const open = t.findIndex((x) => x.asm && x.v === '{');
  assert.ok(open > 0);
  assert.equal(t[t[open].close].v, '}');
  assert.deepEqual(t.filter((x) => x.asm).map((x) => x.v), ['{', 'let', 'x', ':=', '1', 'if', 'x', '{', 'y', ':=', '2', '}', '}']);
  assert.equal(t.at(-1).asm, undefined);
  assert.equal(t.find((x) => x.v === 'z').asm, undefined);
});

test('assembly with a dialect string and flags before its brace, and the word assembly used as a name', () => {
  const t = lex('assembly ("memory-safe") { a } assembly("evmasm") { b } assembly = 1; assembly;').tokens;
  assert.deepEqual(t.filter((x) => x.asm).map((x) => x.v), ['{', 'a', '}', '{', 'b', '}']);
  assert.equal(t.filter((x) => x.v === 'assembly').length, 4);
});

test('a comment or a string inside an assembly block does not end it', () => {
  const t = lex('assembly { // }\n let s := "}" /* } */ }').tokens;
  assert.equal(t.at(-1).v, '}');
  assert.ok(t.slice(1).every((x) => x.asm));
});

test('an unclosed block comment is an error at the place it starts', () => {
  const e = failure('a\n  /* never');
  assert.deepEqual([e.line, e.column], [2, 3]);
  assert.match(e.message, /a comment is never closed/);
});

test('an unclosed string is an error at the place it starts, at the end of the line and at the end of the file', () => {
  const a = failure('x = 1;\n  y = "abc\nz');
  assert.deepEqual([a.line, a.column], [2, 7]);
  assert.match(a.message, /a string is never closed; the line ends inside it/);
  const b = failure("\"abc");
  assert.deepEqual([b.line, b.column], [1, 1]);
  assert.match(b.message, /the file ends inside it/);
  const c = failure('unicode"abc\n');
  assert.deepEqual([c.line, c.column], [1, 1]);
});

test('a character that Solidity does not use outside a string is an error with its place, and is named by its code when it is not printable', () => {
  const a = failure('a\n  @');
  assert.deepEqual([a.line, a.column], [2, 3]);
  assert.match(a.message, /the character "@"/);
  assert.match(failure(`a ${EACUTE}`).message, /U\+00E9/);
  assert.match(failure('a \u0001').message, /U\+0001/);
  assert.match(failure('a `').message, /the character "`"/);
});

test('a pragma never ended, or with a comment in it, is an error', () => {
  assert.match(failure('pragma solidity ^0.8.0').message, /never ended with a semicolon/);
  assert.match(failure('pragma solidity ^0.8.0 // x\n;').message, /holds a comment/);
  assert.match(failure(`pragma solidity ${'1'.repeat(600)};`).message, /never ended/);
});

test('more tokens than the limit is an error at the place of the first one past it', () => {
  const e = failure('a b c d e', { maxTokens: 3 });
  assert.match(e.message, /more than 3 tokens/);
  assert.equal(e.column, 7);
  assert.equal(lex('a b c', { maxTokens: 3 }).tokens.length, 3);
  assert.ok(LEX_LIMITS.maxTokens >= 1000000);
});

test('an empty file, white space and comments give no tokens', () => {
  assert.deepEqual(lex('').tokens, []);
  assert.deepEqual(lex(' \n\t\r\n // x\n /* y */ ').tokens, []);
});
