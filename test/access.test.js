import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEAD, contract, lineOf, ofCheck, scan, sol } from './helpers.js';

const ID = 'state-change-no-access-check';
const STATE = '    address public owner;\n    uint256 public total;\n    uint256[] public items;\n    mapping(address => uint256) public balances;\n    mapping(address => mapping(address => uint256)) public allowance;\n';
const found = (members, options) => ofCheck(contract(`${STATE}${members}`), ID, options);
const names = (members, options) => found(members, options).map((f) => f.subject);

test('a public function that writes a state variable is reported, with the name of the function, its line and its column', () => {
  const text = contract(`${STATE}    function setOwner(address next) public {\n        owner = next;\n    }`);
  const [f] = ofCheck(text, ID);
  assert.equal(f.subject, 'setOwner');
  assert.equal(f.line, lineOf(text, 'function setOwner'));
  assert.equal(f.column, 14);
  assert.equal(f.confidence, 'high');
  assert.ok(f.message.startsWith(`The function setOwner is public, writes a state variable (owner, line ${lineOf(text, 'owner = next')})`));
});

test('external works the same as public, and a function with no visibility is read as public', () => {
  assert.deepEqual(names('    function a() external { total = 1; }'), ['a']);
  assert.deepEqual(names('    function b() public { total = 1; }'), ['b']);
  assert.deepEqual(names('    function c() { total = 1; }'), ['c']);
});

test('internal and private functions, view and pure functions, and constructors are not reported', () => {
  assert.deepEqual(names('    function a() internal { total = 1; }'), []);
  assert.deepEqual(names('    function b() private { total = 1; }'), []);
  assert.deepEqual(names('    function c() public view returns (uint256) { return total; }'), []);
  assert.deepEqual(names('    function d() public pure returns (uint256) { return 1; }'), []);
  assert.deepEqual(names('    constructor() { owner = msg.sender; }'), []);
});

test('each modifier of the default list counts as a check, and one next to it does not', () => {
  for (const m of ['onlyOwner', 'onlyRole(ROLE)', 'onlyAdmin', 'auth', 'requiresAuth']) assert.deepEqual(names(`    function f() external ${m} { total = 1; }`), [], m);
  for (const m of ['onlyOwners', 'onlyowner', 'whenNotPaused', 'nonReentrant', 'onlyOwner2']) assert.deepEqual(names(`    function f() external ${m} { total = 1; }`), ['f'], m);
});

test('whenNotPaused does not count: it stops everyone alike and says nothing about who may call', () => {
  const text = contract(`${STATE}    bool public paused;\n    modifier whenNotPaused() { require(!paused, "paused"); _; }\n    function f() external whenNotPaused { total = 1; }`);
  assert.deepEqual(ofCheck(text, ID).map((f) => f.subject), ['f']);
});

test('a comparison of msg.sender in a require or an assert counts, on either side of the operator, and with _msgSender()', () => {
  for (const check of ['require(msg.sender == owner);', 'require(owner == msg.sender, "no");', 'assert(msg.sender == owner);', 'require(_msgSender() == owner);', 'require(owner == _msgSender());', 'require(msg.sender == owner || msg.sender == address(1));']) {
    assert.deepEqual(names(`    function f() external { ${check} total = 1; }`), [], check);
  }
});

test('a check that is not about who calls does not count: a comparison with the zero address, a balance, tx.origin', () => {
  for (const check of ['require(msg.sender != address(0));', 'require(balances[msg.sender] >= 1);', 'require(msg.sender == tx.origin);', 'require(tx.origin == msg.sender);', 'require(total > 0);']) {
    assert.deepEqual(names(`    function f() external { ${check} total = 1; }`), ['f'], check);
  }
});

test('a lookup of the sender in a mapping, and a call that asks a role question, count in a require', () => {
  const extra = '    mapping(address => bool) public admins;\n    function hasRole(bytes32 role, address who) public view returns (bool) { return admins[who]; }\n';
  assert.deepEqual(names(`${extra}    function a() external { require(admins[msg.sender]); total = 1; }`), []);
  assert.deepEqual(names(`${extra}    function b() external { require(hasRole(0x00, msg.sender), "no"); total = 1; }`), []);
  assert.deepEqual(names(`${extra}    function c() external { require(!admins[msg.sender]); total = 1; }`), ['c']);
});

test('an if that reverts counts when it compares the sender with !=, and an if with == does not', () => {
  assert.deepEqual(names('    function a() external { if (msg.sender != owner) revert(); total = 1; }'), []);
  assert.deepEqual(names('    function b() external { if (msg.sender != owner) { revert(); } total = 1; }'), []);
  assert.deepEqual(names('    error No();\n    function c() external { if (owner != msg.sender) revert No(); total = 1; }'), []);
  assert.deepEqual(names('    function d() external { if (msg.sender == owner) revert(); total = 1; }'), ['d']);
  assert.deepEqual(names('    function e() external { if (msg.sender != owner) { total = 2; } total = 1; }'), ['e']);
  assert.deepEqual(names('    mapping(address => bool) public blocked;\n    function f() external { if (!blocked[msg.sender]) revert(); total = 1; }'), []);
});

test('a call to _checkOwner or to a modifier name written as a function counts', () => {
  assert.deepEqual(names('    function _checkOwner() internal view {}\n    function a() external { _checkOwner(); total = 1; }'), []);
  assert.deepEqual(names('    function _onlyOwner() internal view {}\n    function b() external { _onlyOwner(); total = 1; }'), []);
});

test('a modifier defined in the scanned files that compares the sender counts, and one that does not is a miss', () => {
  const checks = `    modifier keeper() { require(msg.sender == owner); _; }\n    modifier logged() { total += 1; _; }\n`;
  assert.deepEqual(names(`${checks}    function a() external keeper { items.push(1); }`), []);
  assert.deepEqual(names(`${checks}    function b() external logged { items.push(1); }`), ['b']);
});

test('the list of access modifiers can be replaced; the default names then stop counting', () => {
  const text = contract(`${STATE}    function a() external onlyGovernor { total = 1; }\n    function b() external onlyOwner { total = 1; }`);
  assert.deepEqual(ofCheck(text, ID).map((f) => f.subject), ['a']);
  assert.deepEqual(ofCheck(text, ID, { accessModifiers: ['onlyGovernor'] }).map((f) => f.subject), ['b']);
  assert.deepEqual(ofCheck(text, ID, { accessModifiers: ['onlyGovernor', 'onlyOwner'] }).map((f) => f.subject), []);
  assert.deepEqual(ofCheck(text, ID, { accessModifiers: ['onlyGovernor'] }).length, 1);
});

test('every kind of write to a state variable is a write: assignment, compound assignment, ++, --, delete, push, pop, a field, a tuple', () => {
  const kinds = {
    assign: 'total = 1;',
    plus: 'total += 1;',
    minus: 'total -= 1;',
    times: 'total *= 2;',
    shift: 'total <<= 1;',
    post: 'total++;',
    pre: '++total;',
    down: 'total--;',
    predown: '--total;',
    del: 'delete total;',
    push: 'items.push(1);',
    pop: 'items.pop();',
    element: 'items[0] = 1;',
    mapping: 'balances[address(1)] = 1;',
    nested: 'allowance[address(1)][address(2)] = 1;',
    owner: 'owner = address(1);',
    tuple: '(total, owner) = (1, address(2));'
  };
  for (const [name, code] of Object.entries(kinds)) assert.deepEqual(names(`    function f() external { ${code} }`), ['f'], name);
});

test('reading a state variable, comparing it, and using it as an argument are not writes', () => {
  for (const code of ['uint256 x = total;', 'require(total == 1);', 'emit E(total);', 'if (total > 1) { return; }', 'uint256 y = items.length;', 'bool b = total <= 2;', 'bool c = total >= 2;', 'uint256 z = balances[address(1)] + total;']) {
    assert.deepEqual(names(`    event E(uint256 v);\n    function f() external { ${code} }`), [], code);
  }
});

test('a local variable or a parameter with the name of a state variable hides it', () => {
  assert.deepEqual(names('    function a() external { uint256 total = 1; total = 2; }'), []);
  assert.deepEqual(names('    function b(uint256 total) external pure returns (uint256) { total = 2; return total; }'), []);
  assert.deepEqual(names('    function c(uint256 total) external { total = 2; }'), []);
  assert.deepEqual(names('    function d() external { total = 2; }'), ['d']);
});

test('constants and immutables are not state that can be written', () => {
  const text = contract('    uint256 public constant LIMIT = 5;\n    uint256 public immutable START;\n    constructor() { START = 1; }\n    function a() external returns (uint256) { return LIMIT + START; }');
  assert.deepEqual(ofCheck(text, ID), []);
});

test('a function that writes only entries indexed by the sender acts on the entry of the caller and is not reported', () => {
  assert.deepEqual(names('    function a() external payable { balances[msg.sender] += msg.value; }'), []);
  assert.deepEqual(names('    function b(address spender, uint256 v) external { allowance[msg.sender][spender] = v; }'), []);
  assert.deepEqual(names('    function c(address from, address to, uint256 v) external { allowance[from][msg.sender] -= v; balances[from] -= v; balances[to] += v; }'), []);
  assert.deepEqual(names('    function d() external { balances[_msgSender()] = 0; }\n    function _msgSender() internal view returns (address) { return msg.sender; }'), []);
});

test('a write to an entry that is not indexed by the sender is reported with medium confidence, and a scalar write next to one of the sender is reported with high', () => {
  const [a] = found('    function a(address to) external { balances[to] = 1; }');
  assert.equal(a.confidence, 'medium');
  assert.match(a.message, /writes entries of a mapping or an array \(balances, line \d+\)/);
  const [b] = found('    function b() external { balances[msg.sender] = 1; total += 1; }');
  assert.equal(b.confidence, 'high');
  assert.match(b.message, /writes a state variable/);
});

test('a write made through an internal function counts, and the check of the caller on the external function covers it', () => {
  const body = '    function _set(uint256 v) internal { total = v; }\n';
  assert.deepEqual(names(`${body}    function a(uint256 v) external { _set(v); }`), ['a']);
  assert.deepEqual(names(`${body}    function b(uint256 v) external onlyOwner { _set(v); }`), []);
  assert.deepEqual(names(`${body}    function c(uint256 v) external { _set(v); }\n    function d(uint256 v) external { _set(v); }`), ['c', 'd']);
  const chain = '    function _a() internal { total = 1; }\n    function _b() internal { _a(); }\n    function _c() internal { _b(); }\n';
  assert.deepEqual(names(`${chain}    function f() external { _c(); }`), ['f']);
  const [f] = found(`${chain}    function f() external { _c(); }`);
  assert.ok(f.message.includes('writes a state variable (through a function it calls), and has no access modifier'));
});

test('an internal function that writes entries, called with msg.sender, acts on the entry of the caller; called with another account it does not', () => {
  const body = '    function _move(address who, uint256 v) internal { balances[who] += v; }\n';
  assert.deepEqual(names(`${body}    function a(uint256 v) external { _move(msg.sender, v); }`), []);
  assert.deepEqual(names(`${body}    function b(address to, uint256 v) external { _move(to, v); }`), ['b']);
});

test('recursion between functions ends: the facts are passed along with a worklist', () => {
  const body = '    function _a() internal { _b(); total = 1; }\n    function _b() internal { _a(); }\n';
  assert.deepEqual(names(`${body}    function f() external { _b(); }`), ['f']);
});

test('selfdestruct and delegatecall make a function a state change, and an access check covers them', () => {
  assert.deepEqual(names('    function a(address payable to) external { selfdestruct(to); }'), ['a']);
  assert.deepEqual(names('    function b(address t, bytes calldata d) external { (bool ok, ) = t.delegatecall(d); require(ok); }'), ['b']);
  assert.deepEqual(names('    function c(address payable to) external onlyOwner { selfdestruct(to); }\n    modifier onlyOwner() { require(msg.sender == owner); _; }'), []);
  const [a] = found('    function a(address payable to) external { selfdestruct(to); }');
  assert.match(a.message, /calls selfdestruct/);
  const [b] = found('    function b(address t, bytes calldata d) external { (bool ok, ) = t.delegatecall(d); require(ok); }');
  assert.match(b.message, /uses delegatecall/);
});

test('a store in an assembly block is a write', () => {
  assert.deepEqual(names('    function a() external { assembly { sstore(0, 1) } }'), ['a']);
  assert.deepEqual(names('    function b() external pure returns (uint256 x) { assembly { x := 1 } }'), []);
  assert.deepEqual(names('    function c() external returns (uint256 x) { assembly { x := mload(0) } }'), []);
});

test('a write through a storage pointer to a state variable is a write', () => {
  const text = contract('    struct Position { uint256 amount; }\n    mapping(uint256 => Position) public positions;\n    function a(uint256 id) external { Position storage p = positions[id]; p.amount = 1; }\n    function b(uint256 id) external { Position memory p = positions[id]; p.amount = 1; }');
  assert.deepEqual(ofCheck(text, ID).map((f) => f.subject), ['a']);
  const reads = contract('    struct Position { uint256 amount; }\n    mapping(uint256 => Position) public positions;\n    function c(uint256 id) external returns (uint256) { Position storage p = positions[id]; return p.amount; }\n    function d(uint256 id) external { Position storage p = positions[id]; delete p.amount; }');
  assert.deepEqual(ofCheck(reads, ID).map((f) => f.subject), ['d']);
  const own = contract('    struct Position { uint256 amount; }\n    mapping(address => Position) public positions;\n    Position public config;\n    function a() external { Position storage p = positions[msg.sender]; p.amount = 1; }\n    function b(address who) external { Position storage p = positions[who]; p.amount = 1; }\n    function c() external { Position storage p = config; p.amount = 1; }');
  const found = ofCheck(own, ID);
  assert.deepEqual(found.map((f) => `${f.subject}:${f.confidence}`), ['b:medium', 'c:high']);
});

test('receive, fallback and the legacy unnamed fallback are read as functions of the contract', () => {
  assert.deepEqual(names('    receive() external payable { balances[msg.sender] += msg.value; }'), []);
  assert.deepEqual(names('    receive() external payable { total += msg.value; }'), ['receive']);
  assert.deepEqual(names('    fallback() external payable { total += 1; }'), ['fallback']);
});

test('an initialize function with no initializer modifier is a note, and with an initializer, an access check or a name that is not one it is not', () => {
  const [a] = found('    function initialize(address first) external { owner = first; }');
  assert.equal(a.severity, 'info');
  assert.match(a.message, /looks like an initializer and has no initializer modifier/);
  assert.deepEqual(names('    modifier initializer() { _; }\n    function initialize(address first) external initializer { owner = first; }'), []);
  assert.deepEqual(names('    modifier reinitializer(uint8 v) { _; }\n    function initializeV2(address first) external reinitializer(2) { owner = first; }'), []);
  assert.deepEqual(names('    modifier onlyOwner() { require(msg.sender == owner); _; }\n    function initialize(address first) external onlyOwner { owner = first; }'), []);
  assert.deepEqual(names('    function initialized(address first) external { owner = first; }'), ['initialized']);
  assert.equal(found('    function initialized(address first) external { owner = first; }')[0].severity, null);
  assert.deepEqual(names('    function initialize() external pure {}'), []);
});

test('libraries, interfaces and free functions are not looked at for this check', () => {
  const text = sol('uint256 constant LIMIT = 5;\nlibrary L { function f(uint256[] storage a) public { a.push(1); } }\ninterface I { function f() external; }\nfunction free() { }');
  assert.deepEqual(ofCheck(text, ID), []);
});

test('a base contract in another file is found by name: its state variables are writes, and its modifiers are checks', () => {
  const base = { file: 'Base.sol', text: sol('abstract contract Base {\n    uint256 internal count;\n    address internal admin;\n    modifier guarded() { require(msg.sender == admin); _; }\n}') };
  const child = { file: 'Child.sol', text: sol('import "./Base.sol";\ncontract Child is Base {\n    function a() external { count += 1; }\n    function b() external guarded { count += 1; }\n}') };
  assert.deepEqual(ofCheck([base, child], ID).map((f) => `${f.file}:${f.subject}`), ['Child.sol:a']);
  // without the base file, the names are not known and nothing is claimed
  assert.deepEqual(ofCheck([child], ID), []);
});

test('inheritance deeper than the limit is followed to the limit and no further', () => {
  const lines = ['abstract contract C0 { uint256 internal v; }'];
  for (let i = 1; i <= 70; i += 1) lines.push(`abstract contract C${i} is C${i - 1} {}`);
  lines.push('contract Last is C70 { function f() external { v = 1; } }');
  assert.deepEqual(ofCheck(sol(lines.join('\n')), ID), []);
  const shallow = ['abstract contract C0 { uint256 internal v; }'];
  for (let i = 1; i <= 10; i += 1) shallow.push(`abstract contract C${i} is C${i - 1} {}`);
  shallow.push('contract Last is C10 { function f() external { v = 1; } }');
  assert.deepEqual(ofCheck(sol(shallow.join('\n')), ID).map((f) => f.subject), ['f']);
});

test('the finding names the function at its own name and uses the rule level when none is set', () => {
  const [f] = found('    function     spaced()   external { total = 1; }');
  assert.equal(f.subject, 'spaced');
  assert.equal(f.severity, null);
  assert.equal(f.file, 'C.sol');
  assert.ok(HEAD.length > 0);
  assert.equal(scan(sol('contract Empty {}')).length, 0);
});

test('in code for old compilers the function named like its contract is the constructor and is not looked at', () => {
  const text = sol('contract Old {\n    address owner;\n    function Old() public { owner = msg.sender; }\n    function set() public { owner = msg.sender; }\n}');
  assert.deepEqual(ofCheck(text, ID).map((f) => f.subject), ['set']);
});

test('an if with == around the change is not read as a check of the caller, and the message does not say the change is made through another function', () => {
  const [f] = found('    function kill(address payable to) external { if (msg.sender == owner) selfdestruct(to); }');
  assert.equal(f.subject, 'kill');
  assert.ok(f.message.includes('calls selfdestruct, and has no access modifier'), f.message);
  assert.deepEqual(names('    function sweep(address payable to) external { to.transfer(1); }'), []);
});
