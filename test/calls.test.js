import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contract, lineOf, ofCheck, sol } from './helpers.js';

const STATE = '    address public owner;\n    uint256 public total;\n    mapping(address => uint256) public balances;\n    IToken public token;\n    address payable public wallet;\n';
const IFACE = 'interface IToken { function transfer(address to, uint256 v) external returns (bool); function balanceOf(address a) external view returns (uint256); }\n';
const cont = (members) => sol(`${IFACE}contract C {\n${STATE}${members}\n}`);
const found = (members, id, options) => ofCheck(cont(members), id, options);
const subjects = (members, id, options) => found(members, id, options).map((f) => `${f.subject}${f.severity ? `:${f.severity}` : ''}`);

// ---- unchecked-low-level-call ----

const U = 'unchecked-low-level-call';

test('a call whose result is dropped is an error, and a result that is used is not', () => {
  assert.deepEqual(subjects('    function a(address t) external { t.call(""); }', U), ['a']);
  assert.deepEqual(subjects('    function b(address t) external { (bool ok, ) = t.call(""); require(ok); }', U), []);
  assert.deepEqual(subjects('    function c(address t) external { bool ok; (ok, ) = t.call(""); require(ok); }', U), []);
  assert.deepEqual(subjects('    function d(address t) external { require(t.send(1)); }', U), ['d:info']);
  assert.deepEqual(subjects('    function e(address t) external { if (!t.send(1)) revert(); }', U), ['e:info']);
  assert.deepEqual(subjects('    function f(address t) external returns (bool) { return t.send(1); }', U), ['f:info']);
  assert.deepEqual(subjects('    function g(address t) external { bool ok = t.send(1); require(ok); }', U), ['g:info']);
});

test('the call options between the name and the arguments are read: .call{value: v}("")', () => {
  assert.deepEqual(subjects('    function a(address t) external { t.call{value: 1}(""); }', U), ['a']);
  assert.deepEqual(subjects('    function b(address t) external { t.call{value: 1, gas: 5}(abi.encode(1)); }', U), ['b']);
  assert.deepEqual(subjects('    function c(address t) external { (bool ok, ) = t.call{value: 1}(""); require(ok); }', U), []);
});

test('delegatecall, staticcall and send follow the same rule', () => {
  for (const member of ['delegatecall', 'staticcall']) {
    assert.deepEqual(subjects(`    function a(address t) external { t.${member}(""); }`, U), ['a'], member);
    assert.deepEqual(subjects(`    function b(address t) external { (bool ok, ) = t.${member}(""); require(ok); }`, U), [], member);
  }
  assert.deepEqual(subjects('    function c(address payable t) external { t.send(1); }', U), ['c']);
});

test('a tuple with the bool ignored is reported: (, bytes memory data), (bool, ) and (, )', () => {
  assert.deepEqual(subjects('    function a(address t) external { (, bytes memory d) = t.call(""); d; }', U), ['a']);
  assert.deepEqual(subjects('    function b(address t) external { (bool, bytes memory d) = t.call(""); d; }', U), ['b']);
  assert.deepEqual(subjects('    function c(address t) external { (, ) = t.call(""); }', U), ['c']);
});

test('a named bool that is never read is reported with medium confidence, and one that is read later is not', () => {
  const [a] = found('    function a(address t) external { (bool ok, ) = t.call(""); total = 1; }', U);
  assert.equal(a.confidence, 'medium');
  assert.match(a.message, /stores the bool of a \.call\(\) call in ok and never reads it/);
  assert.deepEqual(subjects('    function b(address t) external { (bool ok, ) = t.call(""); total = 1; require(ok); }', U), []);
  assert.deepEqual(subjects('    function c(address t) external { (bool ok, ) = t.call(""); if (!ok) { revert(); } }', U), []);
  // a read before the call is not a read of this bool
  assert.deepEqual(subjects('    function d(address t, bool ok) external { require(ok); (bool ok2, ) = t.call(""); total = 1; }', U), ['d']);
});

test('a call inside the argument of another call, or of an emit or a return, is used', () => {
  assert.deepEqual(subjects('    event E(bool v);\n    function a(address t) external { emit E(t.send(1)); }', U), ['a:info']);
  assert.deepEqual(subjects('    function b(address t) external { assert(t.send(1)); }', U), ['b:info']);
  assert.deepEqual(subjects('    function g(bool v) internal {}\n    function c(address t) external { g(t.send(1)); }', U), ['c:info']);
  assert.deepEqual(subjects('    function d(address t) external { (bool ok, ) = t.call(abi.encode(t.send(1))); require(ok); }', U), ['d:info']);
});

test('transfer with one argument and send are noted with info for the gas stipend; a token transfer with two arguments is not', () => {
  const [a] = found('    function a(address payable t) external { t.transfer(1); }', U);
  assert.equal(a.severity, 'info');
  assert.match(a.message, /passes a fixed gas stipend/);
  assert.deepEqual(subjects('    function b() external { token.transfer(msg.sender, 1); }', U), []);
  assert.deepEqual(subjects('    function c(address payable t) external { payable(t).transfer(1 ether); }', U), ['c:info']);
  assert.deepEqual(subjects('    function d(address payable t) external { t.transfer(1); t.transfer(2); }', U), ['d:info', 'd:info']);
});

test('the place of the finding is the name of the member: its line and column', () => {
  const text = cont('    function a(address t) external {\n        t.call("");\n    }');
  const [f] = ofCheck(text, U);
  assert.equal(f.line, lineOf(text, 't.call'));
  assert.equal(f.column, 11);
});

// ---- call-before-state-write ----

const R = 'call-before-state-write';

test('a low-level call followed by a write to a state variable is reported, and a write followed by the call is not', () => {
  assert.deepEqual(subjects('    function a(address t) external { (bool ok, ) = t.call(""); require(ok); total = 0; }', R), ['a']);
  assert.deepEqual(subjects('    function b(address t) external { total = 0; (bool ok, ) = t.call(""); require(ok); }', R), []);
  const [f] = found('    function a(address t) external { (bool ok, ) = t.call(""); require(ok); balances[t] = 0; }', R);
  assert.equal(f.confidence, 'high');
  assert.match(f.message, /makes a low-level call \(\.call\) and writes state afterwards \(to balances, line \d+\)/);
});

test('only the first call that has a write after it is reported, once for the function', () => {
  assert.deepEqual(subjects('    function a(address t) external { (bool ok, ) = t.call(""); require(ok); (ok, ) = t.call(""); require(ok); total = 0; total = 1; }', R), ['a']);
});

test('the nonReentrant modifier, or its other names, stops the report; a modifier with another name does not', () => {
  const mod = '    modifier nonReentrant() { _; }\n    modifier noReentrancy() { _; }\n    modifier careful() { _; }\n';
  assert.deepEqual(subjects(`${mod}    function a(address t) external nonReentrant { (bool ok, ) = t.call(""); require(ok); total = 0; }`, R), []);
  assert.deepEqual(subjects(`${mod}    function b(address t) external noReentrancy { (bool ok, ) = t.call(""); require(ok); total = 0; }`, R), []);
  assert.deepEqual(subjects(`${mod}    function c(address t) external careful { (bool ok, ) = t.call(""); require(ok); total = 0; }`, R), ['c']);
});

test('an ether transfer or send before a write is reported with low confidence', () => {
  const [a] = found('    function a(address payable t) external { t.transfer(1); total = 0; }', R);
  assert.equal(a.confidence, 'low');
  assert.match(a.message, /a transfer of ether \(\.transfer\)/);
  assert.equal(found('    function b(address payable t) external { require(t.send(1)); total = 0; }', R)[0].confidence, 'low');
});

test('a call through a variable of an interface type, a cast to an interface and safeTransfer are external calls', () => {
  const [a] = found('    function a() external { token.transfer(msg.sender, 1); total = 0; }', R);
  assert.equal(a.confidence, 'medium');
  assert.match(a.message, /a call to another contract \(token\.transfer\)/);
  assert.deepEqual(subjects('    function b(address t) external { IToken(t).transfer(msg.sender, 1); total = 0; }', R), ['b']);
  assert.deepEqual(subjects('    function c(address t) external { SafeERC20.safeTransfer(t, msg.sender, 1); total = 0; }', R), ['c']);
  assert.deepEqual(subjects('    function d() external { token.safeTransferFrom(msg.sender, address(this), 1); total = 0; }', R), ['d']);
  assert.deepEqual(subjects('    function e(IToken local) external { local.transfer(msg.sender, 1); total = 0; }', R), ['e']);
});

test('a call to a function that is view or pure in the interface changes no state and is not a call to look at', () => {
  assert.deepEqual(subjects('    function a() external { uint256 b = token.balanceOf(msg.sender); total = b; }', R), []);
  assert.deepEqual(subjects('    function b(address t) external { uint256 v = IToken(t).balanceOf(msg.sender); total = v; }', R), []);
});

test('a type with no declaration in the files is an interface when it is named like one (I and a capital), and not otherwise', () => {
  assert.deepEqual(subjects('    function a(IUnknown u) external { u.ping(); total = 0; }', R), ['a']);
  assert.deepEqual(subjects('    function b(Unknown u) external { u.ping(); total = 0; }', R), []);
  assert.deepEqual(subjects('    function c(Library.Item storage u) external { u.ping(); total = 0; }', R), []);
});

test('a struct, an enum and a library are not contracts: calls through them are not external', () => {
  const text = sol('struct Item { uint256 a; }\nlibrary Lib { function f(Item storage i) internal {} }\ncontract C {\n    uint256 total;\n    Item item;\n    function a() external { Lib.f(item); total = 1; }\n}');
  assert.deepEqual(ofCheck(text, R), []);
});

test('a write through an internal function after the call is a write, and a call through an internal function is a call', () => {
  const helper = '    function _clear() internal { total = 0; }\n    function _pay(address t) internal { (bool ok, ) = t.call(""); require(ok); }\n';
  assert.deepEqual(subjects(`${helper}    function a(address t) external { (bool ok, ) = t.call(""); require(ok); _clear(); }`, R), ['a']);
  assert.deepEqual(subjects(`${helper}    function b(address t) external { _pay(t); total = 1; }`, R), ['b']);
  assert.deepEqual(subjects(`${helper}    function c(address t) external { _clear(); _pay(t); }`, R), []);
  const [f] = found(`${helper}    function a(address t) external { (bool ok, ) = t.call(""); require(ok); _clear(); }`, R);
  assert.match(f.message, /writes state afterwards \(through _clear\(\), line \d+\)/);
});

test('view and pure functions, constructors and modifiers are not looked at; a staticcall is not a call that can change state', () => {
  assert.deepEqual(subjects('    function a(address t) external view returns (bool) { (bool ok, ) = t.staticcall(""); return ok; }', R), []);
  assert.deepEqual(subjects('    constructor(address t) { (bool ok, ) = t.call(""); require(ok); total = 1; }', R), []);
  assert.deepEqual(subjects('    modifier m(address t) { (bool ok, ) = t.call(""); require(ok); total = 1; _; }', R), []);
});

// ---- tx-origin-auth ----

const T = 'tx-origin-auth';

test('tx.origin in a require, an assert, an if, a while or a comparison is an error', () => {
  for (const code of ['require(tx.origin == owner);', 'assert(tx.origin == owner);', 'if (tx.origin != owner) revert();', 'bool x = owner == tx.origin; x;', 'while (tx.origin == owner) { break; }', 'require(tx.origin != address(0));']) {
    const [f] = found(`    function a() external { ${code} }`, T);
    assert.ok(f, code);
    assert.equal(f.severity, null, code);
    assert.equal(f.confidence, 'high', code);
  }
});

test('tx.origin that is not in a condition is not reported: stored, emitted, passed', () => {
  for (const code of ['address o = tx.origin; o;', 'emit E(tx.origin);', 'total = uint160(tx.origin);', 'owner = tx.origin;']) assert.deepEqual(found(`    event E(address a);\n    function a() external { ${code} }`, T), [], code);
});

test('tx.origin compared with msg.sender is a warning with low confidence, on either side', () => {
  for (const code of ['require(tx.origin == msg.sender);', 'require(msg.sender == tx.origin);', 'require(_msgSender() != tx.origin);']) {
    const [f] = found(`    function _msgSender() internal view returns (address) { return msg.sender; }\n    function a() external { ${code} }`, T);
    assert.equal(f.severity, 'warning', code);
    assert.equal(f.confidence, 'low', code);
  }
});

test('tx.origin in the body of a modifier is reported too, with the name of the modifier', () => {
  const [f] = found('    modifier onlyOrigin() { require(tx.origin == owner); _; }', T);
  assert.equal(f.subject, 'modifier onlyOrigin');
});

// ---- delegatecall-use and selfdestruct-use ----

const D = 'delegatecall-use';
const S = 'selfdestruct-use';

test('delegatecall on a parameter is an error, directly or through address() and payable()', () => {
  assert.deepEqual(subjects('    function a(address t, bytes calldata d) external { (bool ok, ) = t.delegatecall(d); require(ok); }', D), ['a:error']);
  assert.deepEqual(subjects('    function b(address t, bytes calldata d) external { (bool ok, ) = address(t).delegatecall(d); require(ok); }', D), ['b:error']);
  assert.deepEqual(subjects('    function c(address t, bytes calldata d) external { (bool ok, ) = payable(t).delegatecall(d); require(ok); }', D), ['c:error']);
});

test('delegatecall on a state variable is a warning, and with an access check it is info', () => {
  assert.deepEqual(subjects('    function a(bytes calldata d) external { (bool ok, ) = owner.delegatecall(d); require(ok); }', D), ['a:warning']);
  assert.deepEqual(subjects('    modifier onlyOwner() { require(msg.sender == owner); _; }\n    function b(bytes calldata d) external onlyOwner { (bool ok, ) = owner.delegatecall(d); require(ok); }', D), ['b:info']);
  assert.deepEqual(subjects('    function c(bytes calldata d) external { require(msg.sender == owner); (bool ok, ) = owner.delegatecall(d); require(ok); }', D), ['c:info']);
});

test('delegatecall in an assembly block is found, and an error when its target is a parameter', () => {
  assert.deepEqual(subjects('    function a(address t, bytes calldata d) external { assembly { let r := delegatecall(gas(), t, d.offset, d.length, 0, 0) } }', D), ['a:error']);
  assert.deepEqual(subjects('    function b(bytes calldata d) external { address t = owner; assembly { let r := delegatecall(gas(), t, d.offset, d.length, 0, 0) } }', D), ['b:warning']);
  assert.deepEqual(subjects('    function c(address t) external { assembly { let r := call(gas(), t, 0, 0, 0, 0, 0) } }', D), []);
});

test('selfdestruct is a warning, info with an access check, and suicide is read as selfdestruct', () => {
  assert.deepEqual(subjects('    function a(address payable t) external { selfdestruct(t); }', S), ['a:warning']);
  assert.deepEqual(subjects('    function b(address payable t) external { require(msg.sender == owner); selfdestruct(t); }', S), ['b:info']);
  assert.deepEqual(subjects('    function c(address payable t) external { suicide(t); }', S), ['c:warning']);
  assert.deepEqual(subjects('    function d(address payable t) external { assembly { selfdestruct(t) } }', S), ['d:warning']);
  assert.deepEqual(subjects('    function e(address payable t) external { total = 1; }', S), []);
});

test('a function called selfdestruct on an object is not the built-in', () => {
  assert.deepEqual(subjects('    function a(IToken t) external { t.selfdestruct(); }', S), []);
});

test('the contract helper makes a contract around members', () => {
  assert.ok(contract('    uint256 x;').includes('contract C {'));
});
