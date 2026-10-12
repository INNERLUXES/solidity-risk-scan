import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lex, matchBrackets, parseFile, readDeclaration, scanStatements, skipStatement, typeKeyOf } from '../src/index.js';

function parse(src) {
  const { tokens } = lex(src);
  const { match, parent, problem } = matchBrackets(tokens);
  assert.equal(problem, null);
  return { tokens, match, parent, ...parseFile(tokens, match) };
}

test('matchBrackets pairs every bracket in one pass and gives the bracket around each token', () => {
  const { tokens } = lex('a ( b [ c ] ) { d }');
  const { match, parent, problem } = matchBrackets(tokens);
  assert.equal(problem, null);
  assert.equal(match[1], 6);
  assert.equal(match[6], 1);
  assert.equal(match[3], 5);
  assert.equal(match[7], 9);
  assert.equal(parent[4], 3);
  assert.equal(parent[2], 1);
  assert.equal(parent[0], -1);
  assert.equal(parent[8], 7);
});

test('matchBrackets names the problem and where it is: a bracket never closed, one that closes nothing, two kinds crossed', () => {
  const never = matchBrackets(lex('a ( b').tokens);
  assert.match(never.problem.message, /the bracket "\(" is never closed/);
  assert.equal(never.problem.index, 1);
  const nothing = matchBrackets(lex('a ) b').tokens);
  assert.match(nothing.problem.message, /the bracket "\)" closes nothing/);
  const crossed = matchBrackets(lex('a ( b }').tokens);
  assert.match(crossed.problem.message, /the bracket "\}" does not close the "\(" opened at line 1, column 3/);
});

test('contracts, interfaces and libraries are found with their names, kinds and bases', () => {
  const { contracts } = parse('abstract contract A is B, C.D, E(1, 2) { } interface I { } library L { } contract Z {}');
  assert.deepEqual(contracts.map((c) => [c.name, c.kind, c.abstract, c.bases.join(',')]), [['A', 'contract', true, 'B,D,E'], ['I', 'interface', false, ''], ['L', 'library', false, ''], ['Z', 'contract', false, '']]);
});

test('state variables: types, mappings, arrays, constants, immutables and initial values', () => {
  const { contracts } = parse('contract C { uint256 public a = 1; mapping(address => uint256[]) b; address[] c; address[3] d; uint256 constant E = 5; address immutable F; IToken public override g; bytes h; Lib.Item i; mapping(uint => mapping(uint => bool)) public j; }');
  const v = contracts[0].stateVars;
  assert.deepEqual([...v.keys()], ['a', 'b', 'c', 'd', 'E', 'F', 'g', 'h', 'i', 'j']);
  assert.equal(v.get('b').isMapping, true);
  assert.equal(v.get('b').dynamicArray, false);
  assert.equal(v.get('c').dynamicArray, true);
  assert.equal(v.get('d').dynamicArray, false);
  assert.equal(v.get('E').isConst, true);
  assert.equal(v.get('F').isConst, true);
  assert.equal(v.get('a').isConst, false);
  assert.equal(v.get('g').typeKey, 'IToken');
  assert.equal(v.get('h').dynamicArray, true);
  assert.equal(v.get('i').typeKey, 'other');
  assert.equal(v.get('F').typeKey, 'address');
});

test('functions: name, visibility, mutability, modifiers with and without arguments, returns, override, virtual and the body range', () => {
  const { contracts, tokens } = parse('contract C { function f(uint a, address payable b) public virtual override(X, Y) onlyRole(ROLE) nonReentrant view returns (uint x, bool) { return 1; } function g() external; }');
  const [f, g] = contracts[0].functions;
  assert.deepEqual([f.name, f.kind, f.visibility, f.mutability, f.virtual, f.override, f.hasBody], ['f', 'function', 'public', 'view', true, true, true]);
  assert.deepEqual(f.modifiers.map((m) => m.name), ['onlyRole', 'nonReentrant']);
  assert.notEqual(f.modifiers[0].argsOpen, -1);
  assert.equal(f.modifiers[1].argsOpen, -1);
  assert.deepEqual(f.params.map((p) => [p.name, p.type, p.typeKey]), [['a', 'uint', 'other'], ['b', 'address', 'address']]);
  assert.deepEqual(f.returns.map((p) => p.name), ['x', null]);
  assert.equal(tokens[f.bodyOpen].v, '{');
  assert.equal(tokens[f.bodyClose].v, '}');
  assert.equal(g.hasBody, false);
  assert.equal(g.visibility, 'external');
});

test('constructor, receive, fallback, the unnamed legacy fallback and modifiers are functions of the contract', () => {
  const { contracts } = parse('contract C { constructor(uint a) { } receive() external payable { } fallback() external { } function() external payable { } modifier m { _; } modifier n(uint a) virtual { _; } }');
  assert.deepEqual(contracts[0].functions.map((f) => [f.kind, f.name]), [['constructor', 'constructor'], ['receive', 'receive'], ['fallback', 'fallback'], ['fallback', 'fallback'], ['modifier', 'm'], ['modifier', 'n']]);
  assert.equal(contracts[0].functions[3].visibility, 'external');
  assert.deepEqual([...contracts[0].modifiers.keys()], ['m', 'n']);
});

test('a state variable of a function type is a variable and not a function', () => {
  const { contracts } = parse('contract C { function (uint) external callback; function f() public {} }');
  assert.deepEqual([...contracts[0].stateVars.keys()], ['callback']);
  assert.deepEqual(contracts[0].functions.map((f) => f.name), ['f']);
});

test('structs, enums, events, errors, using and user value types are skipped, and their names are kept as types', () => {
  const { contracts, typeNames } = parse('struct Top { uint a; } enum Mode { A, B } type Price is uint256; contract C { struct S { uint a; } enum E { X } event Ev(uint a); error Bad(uint a); using L for uint; uint256 real; function f() public {} }');
  assert.deepEqual([...contracts[0].stateVars.keys()], ['real']);
  assert.deepEqual(contracts[0].functions.map((f) => f.name), ['f']);
  assert.deepEqual([...typeNames].sort(), ['E', 'Mode', 'Price', 'S', 'Top']);
});

test('free functions, pragmas and imports at the top of the file', () => {
  const { freeFunctions, pragmas, contracts } = parse('pragma solidity ^0.8.0; import {A, B} from "./x.sol"; import "./y.sol"; function free(uint a) pure returns (uint) { return a; } uint constant K = 3; contract C {}');
  assert.deepEqual(freeFunctions.map((f) => f.name), ['free']);
  assert.deepEqual(pragmas.map((p) => p.text), ['solidity ^0.8.0']);
  assert.equal(contracts.length, 1);
});

test('input that is not Solidity gives a model with less in it and no exception', () => {
  for (const src of ['contract { }', 'contract C is { }', 'function', 'contract C { function }', 'contract C { uint }', 'contract C { mapping( }', 'interface', 'library L { function f( }', 'struct', 'contract C { modifier }', 'contract C;', 'contract C is B;', 'contract C { function f() public [1] {} }', 'contract C { function f() public (1) {} }']) {
    const { tokens } = lex(src);
    const { match, problem } = matchBrackets(tokens);
    if (problem === null) assert.doesNotThrow(() => parseFile(tokens, match), src);
  }
});

test('scanStatements: simple statements, control heads with their condition, blocks skipped, assembly as one statement', () => {
  const { tokens, match, contracts } = parse('contract C { function f() public { uint a = 1; if (a > 0) { a = 2; } else a = 3; for (uint i = 0; i < 3; i++) a += i; while (a < 9) { a++; } assembly { sstore(0, 1) } unchecked { a = 4; } try this.g() returns (uint r) { a = r; } catch Error(string memory m) { a = 5; } do { a++; } while (a < 20); } }');
  const f = contracts[0].functions[0];
  const statements = scanStatements(tokens, match, f.bodyOpen + 1, f.bodyClose);
  assert.deepEqual(statements.map((s) => s.kind), ['simple', 'if', 'simple', 'simple', 'for', 'simple', 'while', 'simple', 'asm', 'simple', 'try', 'simple', 'simple', 'simple', 'while']);
  const heads = statements.filter((s) => s.kind === 'if' || s.kind === 'for' || s.kind === 'while');
  assert.equal(tokens[heads[0].cond[0]].v, 'a');
  assert.equal(tokens[heads[0].after].v, '{');
  assert.equal(statements.find((s) => s.kind === 'asm').open > 0, true);
});

test('scanStatements: call options with braces stay inside the statement, and a statement with no semicolon ends at its block', () => {
  const { tokens, match, contracts } = parse('contract C { function f() public { (bool ok, ) = to.call{value: 1}(""); x = S({a: 1}); { y = 2; } z = 3 } }');
  const f = contracts[0].functions[0];
  const statements = scanStatements(tokens, match, f.bodyOpen + 1, f.bodyClose);
  assert.deepEqual(statements.map((s) => tokens[s.s].v), ['(', 'x', 'y', 'z']);
});

test('readDeclaration: local variables with their types, storage locations, tuples and the first token of the value', () => {
  const read = (src) => {
    const { tokens } = lex(src);
    const { match } = matchBrackets(tokens);
    return readDeclaration(tokens, match, 0, tokens.length);
  };
  assert.deepEqual(read('uint256 a = 1').map((d) => [d.name, d.typeKey, d.storage]), [['a', 'other', false]]);
  assert.deepEqual(read('IToken t = IToken(x)').map((d) => [d.name, d.typeKey]), [['t', 'IToken']]);
  assert.deepEqual(read('address payable p').map((d) => [d.name, d.typeKey]), [['p', 'address']]);
  assert.deepEqual(read('Position storage p = positions[1]').map((d) => [d.name, d.storage]), [['p', true]]);
  assert.deepEqual(read('bytes memory data = x').map((d) => d.name), ['data']);
  assert.deepEqual(read('uint256[] memory list = new uint256[](3)').map((d) => d.name), ['list']);
  assert.deepEqual(read('(bool ok, bytes memory data) = x.call("")').map((d) => d.name), ['ok', 'data']);
  assert.deepEqual(read('(, uint a) = f()').map((d) => d.name), ['a']);
  for (const not of ['a = 1', 'a.b = 1', 'f(x)', 'a[0] = 1', 'return x', 'delete a', 'a++', 'emit E(1)', 'require(x)', 'x']) assert.deepEqual(read(not), [], not);
});

test('skipStatement jumps over brackets to the semicolon, and stops at a closing brace', () => {
  const { tokens, match } = lex('a ( b ; c ) ; d').tokens && { tokens: lex('a ( b ; c ) ; d').tokens, match: matchBrackets(lex('a ( b ; c ) ; d').tokens).match };
  assert.equal(tokens[skipStatement(tokens, match, 0, tokens.length) - 1].v, ';');
  assert.equal(skipStatement(tokens, match, 0, tokens.length), 7);
});

test('typeKeyOf: address, elementary types and names', () => {
  assert.equal(typeKeyOf('address'), 'address');
  for (const w of ['uint256', 'int8', 'bool', 'bytes32', 'bytes', 'string', 'mapping', 'uint']) assert.equal(typeKeyOf(w), 'other', w);
  assert.equal(typeKeyOf('IERC20'), 'IERC20');
  assert.equal(typeKeyOf('Vault'), 'Vault');
});
