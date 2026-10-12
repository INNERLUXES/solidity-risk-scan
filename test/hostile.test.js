import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FINDING_CAP, LIMITS, checkSources, scanPaths } from '../src/index.js';
import { allowed, contract, sol, withFiles } from './helpers.js';

// Each test builds input meant to make the tool slow or to exhaust the stack or the memory, and checks that it ends with an
// answer in good time. The time allowed is four times as long under coverage (NODE_V8_COVERAGE is set only when coverage is
// on).

function timed(fn) {
  const start = process.hrtime.bigint();
  const value = fn();
  return { value, ms: Number(process.hrtime.bigint() - start) / 1e6 };
}

const check = (text) => timed(() => checkSources([{ file: 'H.sol', text }]));
const ids = (r) => r.value.findings.map((f) => f.id);
const within = (r, ms) => assert.ok(r.ms < allowed(ms), `took ${r.ms} ms`);

test('a hundred thousand nested braces in a function body: no stack is used up', () => {
  const n = 100000;
  const r = check(contract(`    uint256 x;\n    function f() public { ${'{'.repeat(n)} x = 1; ${'}'.repeat(n)} }`));
  assert.deepEqual(ids(r), ['state-change-no-access-check']);
  within(r, 15000);
});

test('a hundred thousand nested parentheses, brackets and calls in one statement', () => {
  const n = 100000;
  const parens = check(contract(`    uint256 x;\n    function f() public { x = ${'('.repeat(n)}1${')'.repeat(n)}; }`));
  assert.deepEqual(ids(parens), ['state-change-no-access-check']);
  within(parens, 15000);
  const index = check(contract(`    mapping(uint256 => uint256) a;\n    function f() public { ${'a['.repeat(n)}1${']'.repeat(n)} = 1; }`));
  assert.deepEqual(ids(index), ['state-change-no-access-check']);
  within(index, 15000);
  const calls = check(contract(`    uint256 x;\n    function g(uint256 v) internal { x = v; }\n    function f() public { ${'g('.repeat(n)}1${')'.repeat(n)}; }`));
  assert.deepEqual(ids(calls), ['state-change-no-access-check']);
  within(calls, 15000);
});

test('a hundred thousand nested parentheses around a block value inside a hash: the climb out of them is bounded', () => {
  const n = 100000;
  const r = check(contract(`    function f() public view returns (bytes32) { return keccak256(${'('.repeat(n)}block.timestamp${')'.repeat(n)}); }`));
  assert.ok(Array.isArray(r.value.findings));
  within(r, 15000);
});

test('a hundred thousand nested braces outside any function, and brackets that never close', () => {
  const n = 100000;
  const deep = check(sol(`contract C ${'{'.repeat(n)}${'}'.repeat(n)}`));
  assert.ok(Array.isArray(deep.value.findings));
  within(deep, 15000);
  const open = check(sol(`contract C { function f() public { ${'('.repeat(n)}`));
  assert.deepEqual(ids(open), ['file-unreadable']);
  assert.match(open.value.findings[0].message, /is never closed/);
  within(open, 15000);
});

test('a million tokens in one function are read in good time', () => {
  const r = check(contract(`    uint256 x;\n    function f() public { ${'x = 1; '.repeat(250000)} }`));
  assert.deepEqual(ids(r), ['state-change-no-access-check']);
  assert.ok(r.value.files[0].tokens >= 1000000, String(r.value.files[0].tokens));
  within(r, 30000);
});

test('more tokens than the limit is a file-unreadable finding with the place where the limit was passed, and the memory stays bounded', () => {
  const text = sol(`contract C { function f() public { ${'x = 1; '.repeat(520000)} } }`);
  const r = check(text);
  assert.deepEqual(ids(r), ['file-unreadable']);
  assert.match(r.value.findings[0].message, /the file holds more than 2,000,000 tokens/);
  assert.equal(r.value.findings[0].line, 3);
  within(r, 30000);
  assert.equal(LIMITS.maxTokens, 2000000);
});

test('the tokens of all the files together are bounded: a file past the limit is reported, not skipped', () => {
  const one = contract('    function f() public { ' + 'x = 1; '.repeat(200) + '}');
  const sources = Array.from({ length: 10 }, (_, i) => ({ file: `F${i}.sol`, text: one }));
  const r = checkSources(sources, { limits: { ...LIMITS, maxTotalTokens: 3000 } });
  const unread = r.findings.filter((f) => f.id === 'file-unreadable');
  assert.ok(unread.length >= 1 && unread.length < 10);
  assert.ok(unread.every((f) => f.message.includes('one run reads at most 3,000')), unread[0].message);
});

test('a line of millions of characters, a string of five million characters and an identifier of a million characters', () => {
  const line = check(sol(`contract C { ${'uint256 a; '.repeat(400000)} }`));
  assert.deepEqual(ids(line), []);
  within(line, 20000);
  const str = check(contract(`    string s = "${'a'.repeat(5000000)}";`));
  assert.deepEqual(ids(str), []);
  within(str, 20000);
  const long = check(contract(`    uint256 ${'a'.repeat(1000000)};\n    function f() public { ${'a'.repeat(1000000)} = 1; }`));
  assert.deepEqual(ids(long), ['state-change-no-access-check']);
  within(long, 20000);
});

test('a hundred thousand functions, each a finding: the first of each check are listed, the rest counted', () => {
  const members = Array.from({ length: 100000 }, (_, i) => `    function f${i}() public { x = ${i}; }`).join('\n');
  const r = check(contract(`    uint256 x;\n${members}`));
  assert.equal(r.value.findings.length, FINDING_CAP);
  assert.equal(r.value.omitted.get('state-change-no-access-check'), 100000 - FINDING_CAP);
  within(r, 30000);
});

test('a chain of fifty thousand internal functions, each calling the next, with a write at the end: facts are passed along without recursion', () => {
  const n = 50000;
  const chain = Array.from({ length: n }, (_, i) => `    function f${i}() internal { f${i + 1}(); }`).join('\n');
  const r = check(contract(`    uint256 x;\n${chain}\n    function f${n}() internal { x = 1; }\n    function top() public { f0(); }`));
  assert.deepEqual(r.value.findings.map((f) => f.subject), ['top']);
  within(r, 30000);
});

test('a ring of twenty thousand internal functions that call each other', () => {
  const n = 20000;
  const ring = Array.from({ length: n }, (_, i) => `    function f${i}() internal { f${(i + 1) % n}(); ${i === 5 ? 'x = 1;' : ''} }`).join('\n');
  const r = check(contract(`    uint256 x;\n${ring}\n    function top() public { f0(); }`));
  assert.deepEqual(r.value.findings.map((f) => f.subject), ['top']);
  within(r, 30000);
});

test('twenty thousand contracts in one line of inheritance, and a thousand contracts that inherit a base of a hundred thousand variables', () => {
  const chain = Array.from({ length: 20000 }, (_, i) => `contract C${i}${i ? ` is C${i - 1}` : ''} { uint256 v${i}; function f${i}() public { v${i} = 1; } }`).join('\n');
  const a = check(sol(chain));
  assert.equal(a.value.findings.length, FINDING_CAP);
  within(a, 30000);
  const vars = Array.from({ length: 100000 }, (_, i) => `uint256 v${i};`).join(' ');
  const kids = Array.from({ length: 1000 }, (_, i) => `contract D${i} is Base { function f() public { v5 = 1; } }`).join('\n');
  const b = check(sol(`contract Base { ${vars} }\n${kids}`));
  assert.equal(b.value.findings.length, FINDING_CAP);
  within(b, 30000);
});

test('a hundred thousand require statements, if statements and assembly blocks', () => {
  const req = check(contract(`    uint256 x;\n    function f() public { ${'require(msg.sender == address(1)); '.repeat(100000)} x = 1; }`));
  assert.deepEqual(ids(req), []);
  within(req, 20000);
  const ifs = check(contract(`    uint256 x;\n    function f() public { ${'if (msg.sender != address(1)) revert(); x = 1; '.repeat(100000)} }`));
  assert.deepEqual(ids(ifs), []);
  within(ifs, 20000);
  const asm = check(contract(`    function f() public { ${'assembly { sstore(0, 1) } '.repeat(100000)} }`));
  assert.deepEqual(ids(asm), ['state-change-no-access-check']);
  within(asm, 20000);
});

test('a hundred thousand nested braces inside an assembly block', () => {
  const n = 100000;
  const r = check(contract(`    function f() public { assembly { ${'{'.repeat(n)}${'}'.repeat(n)} sstore(0, 1) } }`));
  assert.deepEqual(ids(r), ['state-change-no-access-check']);
  within(r, 20000);
});

test('a member chain of two hundred thousand names and a hundred thousand pragmas', () => {
  const chain = check(contract(`    uint256 x;\n    function f() public { ${'a.'.repeat(200000)}b = 1; }`));
  assert.deepEqual(ids(chain), []);
  within(chain, 20000);
  const pragmas = check('pragma solidity ^0.8.0;\n'.repeat(100000));
  assert.equal(pragmas.value.findings.filter((f) => f.id === 'floating-pragma').length, FINDING_CAP);
  within(pragmas, 20000);
});

test('a hundred thousand comments and a hundred thousand long comments', () => {
  const r = check(`${'// a comment of some length\n'.repeat(100000)}${'// '.padEnd(60, 'a')}\n`.repeat(2));
  assert.ok(r.value.findings.length >= 1);
  within(r, 20000);
});

test('a block comment of ten million characters and a hundred thousand block comments in a row', () => {
  const big = check(`/* ${'x'.repeat(10000000)} */ contract C {}`);
  assert.ok(Array.isArray(big.value.findings));
  within(big, 20000);
  const many = check(`${'/**/ '.repeat(100000)} contract C {}`);
  assert.ok(Array.isArray(many.value.findings));
  within(many, 20000);
});

test('a file over the size limit is refused before it is read whole, and a folder of more files than the limit is cut with a finding', async () => {
  const text = 'x'.repeat(16 * 1024 * 1024 + 10);
  await withFiles({ 'Big.sol': text }, async (dir) => {
    const report = await scanPaths({ paths: ['Big.sol'], version: '0', base: dir });
    assert.match(report.findings[0].message, /is larger than 16777216 bytes/);
  });
  const many = {};
  for (let i = 0; i < 5010; i += 1) many[`d${i % 50}/F${i}.sol`] = 'contract C {}\n';
  await withFiles(many, async (dir) => {
    const start = process.hrtime.bigint();
    const report = await scanPaths({ paths: ['.'], version: '0', base: dir });
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.equal(report.summary.files, 5000);
    assert.ok(report.findings.some((f) => f.id === 'file-unreadable' && /more than 5,000 Solidity files/.test(f.message)));
    assert.ok(ms < allowed(60000), `took ${ms} ms`);
  });
});
