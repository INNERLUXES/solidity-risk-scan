import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEAD, columnOf, contract, lineOf, ofCheck, scan, sol } from './helpers.js';

const STATE = '    address[] public players;\n    address[3] public fixedPlayers;\n    mapping(address => uint256) public balances;\n    bytes public blob;\n    uint256 public round;\n';
const found = (members, id) => ofCheck(contract(`${STATE}${members}`), id);
const subjects = (members, id) => found(members, id).map((f) => f.subject);

// ---- block-randomness ----

const B = 'block-randomness';

test('a block value inside keccak256 and abi.encodePacked, reduced with %, is reported with high confidence', () => {
  const [f] = found('    function a() external view returns (uint256) { return uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender))) % 10; }', B);
  assert.equal(f.confidence, 'high');
  assert.match(f.message, /uses block\.timestamp, which is hashed and reduced with %/);
});

test('each of the block values is a source: timestamp, number, prevrandao, difficulty and blockhash', () => {
  for (const source of ['block.timestamp', 'block.number', 'block.prevrandao', 'block.difficulty', 'blockhash(block.number - 1)']) {
    const body = `    function a() external view returns (bytes32) { return keccak256(abi.encodePacked(${source})); }`;
    const [f] = found(body, B);
    assert.ok(f, source);
    assert.equal(f.confidence, 'medium', source);
  }
});

test('a hash alone is medium, % alone is low, and abi.encode, sha256 and ripemd160 are hashes of the same kind', () => {
  assert.equal(found('    function a() external view returns (bytes32) { return sha256(abi.encode(block.number)); }', B)[0].confidence, 'medium');
  assert.equal(found('    function b() external view returns (bytes32) { return bytes32(ripemd160(abi.encode(block.number))); }', B)[0].confidence, 'medium');
  assert.equal(found('    function c() external view returns (bool) { return block.number % 2 == 0; }', B)[0].confidence, 'low');
  assert.equal(found('    function d() external view returns (uint256) { return block.timestamp % 1 days; }', B)[0].confidence, 'low');
  assert.equal(found('    function e() external view returns (bytes memory) { return abi.encode(block.number); }', B)[0].confidence, 'medium');
});

test('a block value used for a deadline or a time stamp is not reported', () => {
  for (const code of ['require(block.timestamp >= round);', 'round = block.timestamp;', 'emit E(block.number);', 'uint256 end = block.timestamp + 1 days; end;', 'if (block.number > round) { return; }']) {
    assert.deepEqual(found(`    event E(uint256 v);\n    function a() external { ${code} }`, B), [], code);
  }
});

test('one finding for a statement, however many block values it holds', () => {
  const found2 = found('    function a() external view returns (uint256) { return uint256(keccak256(abi.encodePacked(block.timestamp, block.number, blockhash(1)))) % 7; }', B);
  assert.equal(found2.length, 1);
});

test('the name of a block value on an object is not the block value', () => {
  assert.deepEqual(found('    function a(uint256 timestamp) external pure returns (bytes32) { return keccak256(abi.encodePacked(timestamp)); }', B), []);
});

// ---- unbounded-loop ----

const L = 'unbounded-loop';

test('a for loop up to the length of a state array is reported, with a for and a while', () => {
  assert.deepEqual(subjects('    function a() external { for (uint256 i = 0; i < players.length; i++) { round += 1; } }', L), ['a']);
  assert.deepEqual(subjects('    function b() external { uint256 i = 0; while (i < players.length) { i++; } }', L), ['b']);
  assert.deepEqual(subjects('    function c() external { for (uint256 i = 0; i <= players.length; ++i) { round += 1; } }', L), ['c']);
  assert.deepEqual(subjects('    function d() external view returns (uint256) { return blob.length; }', L), []);
  assert.deepEqual(subjects('    function e() external { for (uint256 i = 0; i < blob.length; i++) { round += 1; } }', L), ['e']);
});

test('a loop over a parameter, a memory array, a fixed-size array or a constant is not reported', () => {
  assert.deepEqual(subjects('    function a(uint256[] calldata ids) external { for (uint256 i = 0; i < ids.length; i++) { round += ids[i]; } }', L), []);
  assert.deepEqual(subjects('    function b() external { address[] memory copy = new address[](3); for (uint256 i = 0; i < copy.length; i++) { round += 1; } }', L), []);
  assert.deepEqual(subjects('    function c() external { for (uint256 i = 0; i < fixedPlayers.length; i++) { round += 1; } }', L), []);
  assert.deepEqual(subjects('    function d() external { for (uint256 i = 0; i < 10; i++) { round += 1; } }', L), []);
});

test('a bound kept in a local variable that was set from the length is followed', () => {
  assert.deepEqual(subjects('    function a() external { uint256 n = players.length; for (uint256 i = 0; i < n; i++) { round += 1; } }', L), ['a']);
  assert.deepEqual(subjects('    function b(uint256 n) external { for (uint256 i = 0; i < n; i++) { round += 1; } }', L), []);
});

test('the length in the body of the loop, and not in its condition, is not a bound', () => {
  assert.deepEqual(subjects('    function a() external { for (uint256 i = 0; i < 10; i++) { round += players.length; } }', L), []);
  assert.deepEqual(subjects('    function b() external { for (uint256 i = players.length; i < 10; i++) { round += 1; } }', L), []);
});

test('an external call in the loop makes the confidence high', () => {
  assert.equal(found('    function a() external { for (uint256 i = 0; i < players.length; i++) { (bool ok, ) = players[i].call(""); require(ok); } }', L)[0].confidence, 'high');
  assert.equal(found('    function b() external { for (uint256 i = 0; i < players.length; i++) round += 1; }', L)[0].confidence, 'medium');
  assert.match(found('    function a() external { for (uint256 i = 0; i < players.length; i++) { players[i].call(""); } }', L)[0].message, /makes an external call in the loop/);
});

test('the place is the array in the condition', () => {
  const text = contract(`${STATE}    function a() external {\n        for (uint256 i = 0; i < players.length; i++) { round += 1; }\n    }`);
  const [f] = ofCheck(text, L);
  assert.equal(f.line, lineOf(text, 'i < players.length'));
  assert.equal(f.column, columnOf(text, 'players.length;'));
});

// ---- pragma and license ----

const P = 'floating-pragma';

test('a pragma with a caret, a range, a tilde or a wildcard is info; a single version is not', () => {
  for (const range of ['^0.8.0', '>=0.8.0', '>=0.8.0 <0.9.0', '~0.8.2', '>0.8.0', '<0.9.0', '0.8.x', '^0.8.0 || ^0.7.0']) {
    const text = `// SPDX-License-Identifier: MIT\npragma solidity ${range};\ncontract C {}\n`;
    const [f] = ofCheck(text, P);
    assert.ok(f, range);
    assert.equal(f.line, 2, range);
    assert.equal(f.column, 1, range);
    assert.equal(f.severity, null, range);
  }
  for (const range of ['0.8.24', '=0.8.24', '= 0.8.24', '0.4.26']) assert.deepEqual(ofCheck(`// SPDX-License-Identifier: MIT\npragma solidity ${range};\ncontract C {}\n`, P), [], range);
});

test('a pragma that is not about solidity is not looked at, and a pragma split over lines is read', () => {
  assert.deepEqual(ofCheck(`${HEAD}pragma abicoder v2;\npragma experimental ABIEncoderV2;\ncontract C {}\n`, P), []);
  assert.equal(ofCheck('// SPDX-License-Identifier: MIT\npragma solidity\n  ^0.8.0;\ncontract C {}\n', P).length, 1);
});

test('each file is checked: two files, two pragmas', () => {
  const files = [{ file: 'A.sol', text: '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\n' }, { file: 'B.sol', text: '// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\n' }, { file: 'C.sol', text: '// SPDX-License-Identifier: MIT\npragma solidity ~0.8.0;\n' }];
  assert.deepEqual(ofCheck(files, P).map((f) => f.file), ['A.sol', 'C.sol']);
});

const M = 'missing-spdx';

test('a file with no SPDX line is info at line 1; the line in a line comment or in a block comment is read', () => {
  const [f] = ofCheck('pragma solidity 0.8.24;\ncontract C {}\n', M);
  assert.equal(f.line, 1);
  assert.equal(f.column, 1);
  assert.deepEqual(ofCheck('// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\n', M), []);
  assert.deepEqual(ofCheck('/* SPDX-License-Identifier: GPL-3.0-only */\npragma solidity 0.8.24;\n', M), []);
  assert.deepEqual(ofCheck('/**\n * @title X\n * SPDX-License-Identifier: MIT\n */\npragma solidity 0.8.24;\n', M), []);
  assert.deepEqual(ofCheck('pragma solidity 0.8.24;\nstring s = "SPDX-License-Identifier: MIT";\n', M).length, 1);
});

// ---- secret-in-source ----

const K = 'secret-in-source';
const words = (n, word = 'abc') => Array.from({ length: n }, () => word).join(' ');

test('a string of 12, 15, 18, 21 or 24 short lowercase words is shaped like a mnemonic, and 11 or 13 are not', () => {
  for (const n of [12, 15, 18, 21, 24]) assert.equal(ofCheck(sol(`contract C { string s = "${words(n)}"; }`), K).length, 1, String(n));
  for (const n of [11, 13, 25]) assert.deepEqual(ofCheck(sol(`contract C { string s = "${words(n)}"; }`), K), [], String(n));
  assert.deepEqual(ofCheck(sol(`contract C { string s = "${words(12, 'abcdefghi')}"; }`), K), [], 'words of nine letters');
  assert.deepEqual(ofCheck(sol(`contract C { string s = "${words(12, 'ab')}"; }`), K), [], 'words of two letters');
  assert.deepEqual(ofCheck(sol(`contract C { string s = "${words(12, 'Abc')}"; }`), K), [], 'capital letters');
});

test('a key in hex is a string of 64 hex digits, with 0x or without; 63 and 65 are not, and a hex literal is left alone', () => {
  const key = 'ab'.repeat(32);
  assert.equal(ofCheck(sol(`contract C { string s = "0x${key}"; }`), K).length, 1);
  assert.equal(ofCheck(sol(`contract C { string s = "${key}"; }`), K).length, 1);
  assert.deepEqual(ofCheck(sol(`contract C { string s = "${key.slice(1)}"; }`), K), []);
  assert.deepEqual(ofCheck(sol(`contract C { string s = "${key}a"; }`), K), []);
  assert.deepEqual(ofCheck(sol(`contract C { bytes32 h = hex"${key}"; bytes32 k = 0x${key}; }`), K), []);
});

test('a comment that is shaped like a mnemonic is reported at its line, and the value is in no message', () => {
  const text = sol(`// ${words(12, 'zzz')}\ncontract C { string s = "${words(12, 'qqq')}"; }`);
  const found2 = ofCheck(text, K);
  assert.deepEqual(found2.map((f) => f.line).sort((a, b) => a - b), [lineOf(text, '// zzz'), lineOf(text, 'contract C')]);
  for (const f of found2) assert.ok(!f.message.includes('zzz') && !f.message.includes('qqq'));
});

test('a string under 47 characters is not looked at, and a string of ordinary text is not a key', () => {
  assert.deepEqual(ofCheck(sol('contract C { string s = "this is an ordinary sentence of words that is not a key at all"; }'), K), []);
  assert.deepEqual(ofCheck(sol(`contract C { string s = "${'a'.repeat(100)}"; }`), K), []);
});

// ---- all the checks together ----

test('a clean contract has no finding at all', () => {
  const text = sol('contract C {\n    address public owner;\n    modifier onlyOwner() { require(msg.sender == owner); _; }\n    function set(address next) external onlyOwner { owner = next; }\n}');
  assert.deepEqual(scan(text), []);
});
