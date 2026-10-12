// The checks. The input is the parsed files (tokens, bracket tables, contracts) and the options; the output is a list of
// findings with a place. Everything is a heuristic over the text: nothing is compiled or run. Inheritance is resolved by the
// name of a base contract among the files given to the run, and a function is found by name in the contract, its bases and
// the free functions of its file. No function here calls itself: facts about functions are passed along the calls between
// them with a worklist, and every walk over tokens is a loop that jumps over a bracket pair with the match table.

import { ACCESS_MODIFIERS, INIT_MODIFIERS, LOCK_MODIFIERS } from './data.js';
import { readDeclaration, scanStatements } from './structure.js';
import { secretShape } from './secrets.js';

// Findings kept for one check, and the most inherited contracts followed from one contract.
export const FINDING_CAP = 1000;
export const CHAIN_MAX = 64;

const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '|=', '&=', '^=', '<<=', '>>=']);
const LOW_LEVEL = new Set(['call', 'delegatecall', 'staticcall', 'send']);
const SAFE_CALLS = new Set(['safeTransfer', 'safeTransferFrom', 'safeApprove', 'safeIncreaseAllowance', 'safeDecreaseAllowance']);
const BLOCK_VALUES = new Set(['timestamp', 'number', 'prevrandao', 'difficulty']);
const HASHES = new Set(['keccak256', 'sha256', 'ripemd160']);
const ROLE_CALLS = new Set(['hasRole', 'isOwner', 'isAdmin', 'isAuthorized', 'isAuthorised', 'canCall', '_checkRole', '_checkOwner', '_isOwner']);
const CHECK_CALLS = new Set(['_checkOwner', '_checkRole', '_requireOwner', '_requireAuth', '_onlyOwner', '_onlyRole', '_onlyAdmin']);
const USED_STARTS = new Set(['return', 'require', 'assert', 'delete', 'emit', 'revert']);
const MAX_CLIMB = 64;
const NOT_A_TYPE = new Set(['delete', 'else', 'do', 'return', 'emit', 'revert', 'new', 'throw']);

const isP = (t, v) => t !== undefined && t.k === 'pun' && t.v === v;
const isId = (t, v) => t !== undefined && t.k === 'id' && (v === undefined || t.v === v);

// The findings of a run, kept at most FINDING_CAP for each check; the rest are counted in omitted.
export function createCollector() {
  const findings = [];
  const counts = new Map();
  const omitted = new Map();
  const add = (finding) => {
    const seen = (counts.get(finding.id) ?? 0) + 1;
    counts.set(finding.id, seen);
    if (seen > FINDING_CAP) omitted.set(finding.id, (omitted.get(finding.id) ?? 0) + 1);
    else findings.push(finding);
  };
  return { findings, omitted, add };
}

// ---- the registry: contracts by name, and what can be found from a contract ----

function buildRegistry(models) {
  const byName = new Map();
  const modifiersByName = new Map();
  const structNames = new Set();
  for (const model of models) {
    const own = (c) => {
      c.model = model;
      c.index = new Map();
      for (const fn of c.functions) {
        fn.model = model;
        fn.contract = c;
        if (fn.kind === 'modifier') {
          const list = modifiersByName.get(fn.name);
          if (list === undefined) modifiersByName.set(fn.name, [fn]);
          else list.push(fn);
        } else if (fn.name !== null) {
          const list = c.index.get(fn.name);
          if (list === undefined) c.index.set(fn.name, [fn]);
          else list.push(fn);
        }
      }
    };
    for (const c of model.parsed.contracts) {
      own(c);
      const list = byName.get(c.name);
      if (list === undefined) byName.set(c.name, [c]);
      else list.push(c);
    }
    own(model.parsed.file);
    for (const name of model.typeNames) structNames.add(name);
  }
  return { byName, modifiersByName, structNames };
}

// The contract and the contracts it inherits from, nearest first, found by name, at most CHAIN_MAX.
function chainOf(registry, contract) {
  if (contract.chain !== undefined) return contract.chain;
  const chain = [contract];
  const seen = new Set(chain);
  for (let i = 0; i < chain.length && chain.length < CHAIN_MAX; i += 1) {
    for (const name of chain[i].bases) {
      for (const base of registry.byName.get(name) ?? []) {
        if (!seen.has(base) && chain.length < CHAIN_MAX) {
          seen.add(base);
          chain.push(base);
        }
      }
    }
  }
  contract.chain = chain;
  return chain;
}

function findVariable(registry, contract, name) {
  for (const c of chainOf(registry, contract)) {
    const v = c.stateVars.get(name);
    if (v !== undefined) return v;
  }
  return null;
}

function findFunctions(registry, contract, name) {
  const out = [];
  for (const c of chainOf(registry, contract)) {
    const list = c.index.get(name);
    if (list !== undefined) out.push(...list);
  }
  const free = contract.model.parsed.file.index.get(name);
  if (free !== undefined && !contract.free) out.push(...free);
  return out;
}

// Whether the name is a contract or an interface (a library or a struct is not): one of the files declares it, or, when none
// does, it is written the way interfaces are named, with an I and a capital letter.
function isContractLike(registry, name) {
  const list = registry.byName.get(name);
  if (list !== undefined) return list.some((c) => c.kind !== 'library');
  if (registry.structNames.has(name)) return false;
  return name.length > 1 && name[0] === 'I' && name[1] >= 'A' && name[1] <= 'Z';
}

// ---- helpers over tokens ----

// A table with the number of sender forms (msg.sender, _msgSender()) that start before each token, built once for a file.
function senderTable(model) {
  if (model.senders !== undefined) return model.senders;
  const { tokens } = model;
  const n = tokens.length;
  const table = new Int32Array(n + 1);
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    table[i] = count;
    const t = tokens[i];
    if (t.k === 'id' && !t.asm && !isP(tokens[i - 1], '.')) {
      if (t.v === 'msg' && isP(tokens[i + 1], '.') && isId(tokens[i + 2], 'sender')) count += 1;
      else if (t.v === '_msgSender' && isP(tokens[i + 1], '(') && isP(tokens[i + 2], ')')) count += 1;
    }
  }
  table[n] = count;
  model.senders = table;
  return table;
}

const sendersIn = (model, lo, hi) => (hi > lo ? senderTable(model)[hi] - senderTable(model)[lo] : 0);

// The index just past the sender form that starts at i, or -1 when none starts there.
function senderEnd(tokens, i) {
  const t = tokens[i];
  if (t === undefined || t.k !== 'id' || isP(tokens[i - 1], '.')) return -1;
  if (t.v === 'msg' && isP(tokens[i + 1], '.') && isId(tokens[i + 2], 'sender')) return i + 3;
  if (t.v === '_msgSender' && isP(tokens[i + 1], '(') && isP(tokens[i + 2], ')')) return i + 3;
  return -1;
}

// The end of the first argument of the call whose brackets are open..close: the first comma at the level of the arguments.
function firstArgumentEnd(tokens, match, open, close) {
  let k = open + 1;
  while (k < close) {
    const t = tokens[k];
    if (t.k === 'pun') {
      if (t.v === '(' || t.v === '[' || t.v === '{') {
        k = match[k] > 0 ? match[k] + 1 : close;
        continue;
      }
      if (t.v === ',') return k;
    }
    k += 1;
  }
  return close;
}

// The arguments of the call whose brackets are open..close, as [{ lo, hi }] token ranges.
function splitArguments(tokens, match, open, close) {
  const out = [];
  if (close === open + 1) return out;
  let from = open + 1;
  let k = from;
  while (k < close) {
    const t = tokens[k];
    if (t.k === 'pun') {
      if (t.v === '(' || t.v === '[' || t.v === '{') {
        k = match[k] > 0 ? match[k] + 1 : close;
        continue;
      }
      if (t.v === ',') {
        out.push({ lo: from, hi: k });
        from = k + 1;
      }
    }
    k += 1;
  }
  out.push({ lo: from, hi: close });
  return out;
}

// The number of arguments of the call whose brackets are open..close, counting only the first two.
function argumentCount(tokens, match, open, close) {
  if (close === open + 1) return 0;
  let count = 1;
  let k = open + 1;
  while (k < close) {
    const t = tokens[k];
    if (t.k === 'pun') {
      if (t.v === '(' || t.v === '[' || t.v === '{') {
        k = match[k] > 0 ? match[k] + 1 : close;
        continue;
      }
      if (t.v === ',') {
        count += 1;
        if (count >= 2) return count;
      }
    }
    k += 1;
  }
  return count;
}

// Whether the tokens lo..hi compare a sender form with == (or with != when notEqual is true), the other side not being tx.origin.
function comparesSender(tokens, model, lo, hi, ops) {
  if (sendersIn(model, lo, hi) === 0) return false;
  for (let k = lo; k < hi; k += 1) {
    const end = senderEnd(tokens, k);
    if (end < 0) continue;
    const before = tokens[k - 1];
    const after = tokens[end];
    if (after !== undefined && after.k === 'pun' && ops.includes(after.v) && end < hi) {
      if (!isId(tokens[end + 1], 'tx')) return true;
    }
    if (before !== undefined && before.k === 'pun' && ops.includes(before.v) && k > lo) {
      const origin = isId(tokens[k - 2], 'origin') && isP(tokens[k - 3], '.') && isId(tokens[k - 4], 'tx');
      if (!origin) return true;
    }
  }
  return false;
}

// Whether the tokens lo..hi are one lookup of the sender in a mapping, negated with ! or not: [!] name[msg.sender].
function isSenderLookup(tokens, match, lo, hi, negated) {
  let k = lo;
  if (isP(tokens[k], '!') !== negated) return false;
  if (negated) k += 1;
  if (!isId(tokens[k]) || !isP(tokens[k + 1], '[') || match[k + 1] !== hi - 1) return false;
  return senderEnd(tokens, k + 2) === hi - 1;
}

// Whether the tokens lo..hi call one of the functions that ask a role question.
function callsRoleFunction(tokens, lo, hi) {
  for (let k = lo; k < hi; k += 1) {
    const t = tokens[k];
    if (t.k === 'id' && ROLE_CALLS.has(t.v) && isP(tokens[k + 1], '(')) return true;
  }
  return false;
}

// Whether the statements of a body (tokens lo..hi) check who the caller is: a require or assert that compares the sender
// with something (or looks it up, or asks a role function), an if that reverts, or a call of a function made for it.
function hasAccessCheck(model, statements, accessNames) {
  const { tokens, match } = model;
  for (let n = 0; n < statements.length; n += 1) {
    const st = statements[n];
    const first = tokens[st.s];
    if (st.kind === 'simple' && first.k === 'id' && isP(tokens[st.s + 1], '(') && match[st.s + 1] > 0) {
      if (first.v === 'require' || first.v === 'assert') {
        const lo = st.s + 2;
        const hi = firstArgumentEnd(tokens, match, st.s + 1, match[st.s + 1]);
        if (comparesSender(tokens, model, lo, hi, ['==']) || (sendersIn(model, lo, hi) > 0 && isSenderLookup(tokens, match, lo, hi, false)) || callsRoleFunction(tokens, lo, hi)) return true;
      } else if (CHECK_CALLS.has(first.v) || accessNames.has(first.v)) return true;
    }
    if (st.kind === 'if') {
      const [lo, hi] = st.cond;
      const negated = isP(tokens[lo], '!');
      const gate = !hasEquals(tokens, lo, hi) && (comparesSender(tokens, model, lo, hi, ['!=']) || (negated && (isSenderLookup(tokens, match, lo, hi, true) || callsRoleFunction(tokens, lo, hi))));
      if (gate) {
        let from = st.after;
        let to = st.after;
        if (isP(tokens[st.after], '{') && match[st.after] > 0) {
          from = st.after + 1;
          to = match[st.after];
        } else if (statements[n + 1] !== undefined) {
          from = statements[n + 1].s;
          to = statements[n + 1].e;
        }
        for (let k = from; k < to; k += 1) if (isId(tokens[k], 'revert') || isId(tokens[k], '_revert')) return true;
      }
    }
  }
  return false;
}

const hasEquals = (tokens, lo, hi) => {
  for (let k = lo; k < hi; k += 1) if (isP(tokens[k], '==')) return true;
  return false;
};

// ---- the facts of one function ----

function emptyFacts() {
  return { writes: [], extCalls: [], lowLevel: [], delegates: [], selfdestructs: [], origins: [], blockValues: [], edges: [], statements: [], locals: new Map(), asmWrites: [], hasBody: false };
}

// Collects what the function does, token by token. The checks read these facts afterwards.
function collectFacts(registry, fn, options) {
  const facts = emptyFacts();
  fn.facts = facts;
  if (!fn.hasBody) return facts;
  facts.hasBody = true;
  const { model } = fn;
  const { tokens, match } = model;
  const contract = fn.contract;
  const lo = fn.bodyOpen + 1;
  const hi = fn.bodyClose;
  const statements = scanStatements(tokens, match, lo, hi);
  facts.statements = statements;
  const stmtAt = new Int32Array(Math.max(hi - lo, 0)).fill(-1);
  statements.forEach((st, n) => {
    for (let k = st.s; k < st.e && k < hi; k += 1) stmtAt[k - lo] = n;
  });
  facts.stmtAt = stmtAt;
  facts.lo = lo;
  facts.hi = hi;

  // locals: parameters, return values and declared variables
  const locals = facts.locals;
  for (const p of fn.params) if (p.name !== null) locals.set(p.name, { typeKey: p.typeKey, storage: false });
  for (const p of fn.returns) if (p.name !== null) locals.set(p.name, { typeKey: p.typeKey, storage: false });
  const alias = new Map();
  const lengthAlias = new Map();
  const declare = (s, e, inLoopHead) => {
    for (const d of readDeclaration(tokens, match, s, e)) {
      locals.set(d.name, { typeKey: d.typeKey, storage: d.storage });
      if (d.initAt >= 0 && d.initAt < e) {
        const a = tokens[d.initAt];
        if (a.k === 'id' && !locals.has(a.v)) {
          const v = findVariable(registry, contract, a.v);
          if (v !== null && d.storage) {
            const chain = readChain(model, d.initAt);
            alias.set(d.name, { root: a.v, element: chain.element, caller: chain.caller });
          }
          if (!inLoopHead && v !== null && v.dynamicArray && isP(tokens[d.initAt + 1], '.') && isId(tokens[d.initAt + 2], 'length') && d.initAt + 3 === e) lengthAlias.set(d.name, a.v);
        }
      }
    }
  };
  for (const st of statements) {
    if (st.kind === 'simple') declare(st.s, st.e, false);
    else if (st.kind === 'for') {
      let semi = st.cond[0];
      while (semi < st.cond[1] && !isP(tokens[semi], ';')) {
        if (tokens[semi].k === 'pun' && (tokens[semi].v === '(' || tokens[semi].v === '[' || tokens[semi].v === '{') && match[semi] > 0) semi = match[semi] + 1;
        else semi += 1;
      }
      declare(st.cond[0], semi, true);
    }
  }
  facts.alias = alias;
  facts.lengthAlias = lengthAlias;

  const typeKeyOfName = (name) => {
    const l = locals.get(name);
    if (l !== undefined) return l.typeKey;
    const v = findVariable(registry, contract, name);
    return v === null ? null : v.typeKey;
  };

  for (let i = lo; i < hi; i += 1) {
    const t = tokens[i];
    if (t.k !== 'id' || t.asm) continue;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    const member = isP(prev, '.');
    const v = t.v;
    const stmtIndex = stmtAt[i - lo];

    if (!member && v === 'tx' && isP(next, '.') && isId(tokens[i + 2], 'origin')) {
      facts.origins.push({ pos: i, stmt: stmtIndex });
      continue;
    }
    if (!member && v === 'block' && isP(next, '.') && tokens[i + 2] !== undefined && tokens[i + 2].k === 'id' && BLOCK_VALUES.has(tokens[i + 2].v)) {
      facts.blockValues.push({ pos: i, name: `block.${tokens[i + 2].v}`, stmt: stmtIndex });
      continue;
    }
    if (!member && v === 'blockhash' && isP(next, '(')) {
      facts.blockValues.push({ pos: i, name: 'blockhash', stmt: stmtIndex });
      continue;
    }
    if (!member && (v === 'selfdestruct' || v === 'suicide') && isP(next, '(')) {
      facts.selfdestructs.push({ pos: i, stmt: stmtIndex });
      continue;
    }
    if (member && LOW_LEVEL.has(v) && (isP(next, '(') || isP(next, '{'))) {
      facts.lowLevel.push({ pos: i, member: v, stmt: stmtIndex });
      if (v === 'delegatecall') facts.delegates.push({ pos: i, stmt: stmtIndex, receiverEnd: i - 2 });
      if (v === 'call' || v === 'delegatecall') facts.extCalls.push({ pos: i, kind: 'low', what: `.${v}` });
      else if (v === 'send') facts.extCalls.push({ pos: i, kind: 'ether', what: '.send' });
      continue;
    }
    if (member && v === 'transfer' && isP(next, '(') && match[i + 1] > 0 && argumentCount(tokens, match, i + 1, match[i + 1]) === 1) {
      facts.lowLevel.push({ pos: i, member: 'transfer', stmt: stmtIndex });
      facts.extCalls.push({ pos: i, kind: 'ether', what: '.transfer' });
      continue;
    }
    if (SAFE_CALLS.has(v) && isP(next, '(')) {
      facts.extCalls.push({ pos: i, kind: 'safe', what: v });
      continue;
    }
    // a call through a variable of a contract or interface type: token.transfer(...)
    if (!member && isP(next, '.') && tokens[i + 2] !== undefined && tokens[i + 2].k === 'id' && isP(tokens[i + 3], '(')) {
      const key = typeKeyOfName(v);
      if (key !== null && key !== 'address' && key !== 'other' && isContractLike(registry, key) && !viewOnly(registry, key, tokens[i + 2].v)) {
        facts.extCalls.push({ pos: i + 2, kind: 'iface', what: `${v}.${tokens[i + 2].v}` });
      }
    }
    // a call through a cast: IERC20(token).transfer(...)
    if (!member && isP(next, '(') && match[i + 1] > 0 && isContractLike(registry, v) && isP(tokens[match[i + 1] + 1], '.') && tokens[match[i + 1] + 2] !== undefined && tokens[match[i + 1] + 2].k === 'id' && isP(tokens[match[i + 1] + 3], '(') && !isId(prev, 'new')) {
      const method = tokens[match[i + 1] + 2].v;
      if (!viewOnly(registry, v, method)) facts.extCalls.push({ pos: match[i + 1] + 2, kind: 'iface', what: `${v}(...).${method}` });
    }
    // a call of a function of this contract (or a base, or a free function) by name
    if (!member && isP(next, '(') && match[i + 1] > 0 && !isId(prev, 'emit') && !isId(prev, 'revert') && !isId(prev, 'new') && !locals.has(v)) {
      const targets = findFunctions(registry, contract, v).filter((f) => f.kind === 'function' && f.hasBody);
      if (targets.length > 0) facts.edges.push({ pos: i, name: v, targets, passesSender: sendersIn(model, i + 2, match[i + 1]) > 0 });
    }
    // a write to a state variable
    // the name in a declaration (`Position storage p = ...`) follows a type or a storage location and is not a write
    const declares = prev !== undefined && prev.k === 'id' && !NOT_A_TYPE.has(prev.v);
    if (!member && !declares) {
      let root = null;
      let through = null;
      const local = locals.get(v);
      if (local !== undefined) {
        if (alias.has(v)) {
          through = alias.get(v);
          root = through.root;
        }
      } else {
        const variable = findVariable(registry, contract, v);
        if (variable !== null && !variable.isConst) root = v;
      }
      if (root !== null) readWrite(model, facts, i, root, stmtIndex, through);
    }
  }

  // assembly blocks: a store to storage is a write; delegatecall and selfdestruct are found by name
  for (const st of statements) {
    if (st.kind !== 'asm') continue;
    for (let k = st.open + 1; k < st.e - 1; k += 1) {
      const t = tokens[k];
      if (t.k !== 'id' || isP(tokens[k - 1], '.')) continue;
      if (t.v === 'sstore' && isP(tokens[k + 1], '(')) facts.asmWrites.push({ pos: k, name: 'sstore', element: false, caller: false, via: null });
      else if (t.v === 'delegatecall' && isP(tokens[k + 1], '(') && match[k + 1] > 0) {
        facts.delegates.push({ pos: k, stmt: -1, asm: true, open: k + 1 });
        facts.extCalls.push({ pos: k, kind: 'low', what: 'delegatecall' });
      } else if (t.v === 'selfdestruct' && isP(tokens[k + 1], '(')) facts.selfdestructs.push({ pos: k, stmt: -1 });
    }
  }
  facts.writes.push(...facts.asmWrites);
  facts.writes.sort((a, b) => a.pos - b.pos);
  return facts;
}

// Whether every function of that name in the contract or interface is view or pure (so calling it changes no state).
function viewOnly(registry, typeName, method) {
  const list = registry.byName.get(typeName);
  if (list === undefined) return false;
  let found = false;
  for (const c of list) {
    for (const chainContract of chainOf(registry, c)) {
      for (const f of chainContract.index.get(method) ?? []) {
        found = true;
        if (f.mutability !== 'view' && f.mutability !== 'pure') return false;
      }
    }
  }
  return found;
}

// Reads the chain after a name at token i: indexes, fields, and a push or pop. Returns the index after the chain, whether it
// holds an index (an entry), whether an index holds the sender, and whether it ends in a push or pop.
function readChain(model, i) {
  const { tokens, match } = model;
  let j = i + 1;
  let element = false;
  let caller = false;
  let pushed = false;
  while (j < tokens.length) {
    const t = tokens[j];
    if (isP(t, '[') && match[j] > 0) {
      element = true;
      if (sendersIn(model, j + 1, match[j]) > 0) caller = true;
      j = match[j] + 1;
    } else if (isP(t, '.') && isId(tokens[j + 1])) {
      if ((tokens[j + 1].v === 'push' || tokens[j + 1].v === 'pop') && isP(tokens[j + 2], '(')) {
        pushed = true;
        break;
      }
      j += 2;
    } else break;
  }
  return { j, element, caller, pushed };
}

// Records a write when the chain after a state variable at token i (or after a local that points into one, `through`) is
// followed by an assignment, an increment, a delete or a push or pop.
function readWrite(model, facts, i, root, stmtIndex, through) {
  const { tokens, match } = model;
  const chain = readChain(model, i);
  const { j, pushed } = chain;
  const element = chain.element || (through !== null && through.element);
  const caller = chain.caller || (through !== null && through.caller);
  const after = tokens[j];
  const before = tokens[i - 1];
  let write = pushed;
  if (!write && after !== undefined && after.k === 'pun' && (ASSIGN.has(after.v) || after.v === '++' || after.v === '--')) write = true;
  if (!write && before !== undefined && ((isId(before, 'delete')) || isP(before, '++') || isP(before, '--'))) write = true;
  if (!write && stmtIndex >= 0) {
    const st = facts.statements[stmtIndex];
    if (st.kind === 'simple' && isP(tokens[st.s], '(') && match[st.s] > i && isP(tokens[match[st.s] + 1], '=')) write = true;
  }
  if (write) facts.writes.push({ pos: i, name: root, element, caller, via: null });
}

// ---- facts passed along calls ----

// What a function does, with what the functions it calls do: writes (scalar, element, element of the caller), a danger
// (selfdestruct, delegatecall), an external call.
function propagate(fns) {
  const callers = new Map();
  for (const fn of fns) {
    const f = fn.facts;
    fn.sum = {
      scalar: f.writes.some((w) => !w.element),
      element: f.writes.some((w) => w.element),
      caller: f.writes.some((w) => w.element && w.caller),
      danger: f.selfdestructs.length > 0 || f.delegates.length > 0,
      ext: f.extCalls.length > 0
    };
  }
  for (const fn of fns) {
    for (const e of fn.facts.edges) {
      for (const target of e.targets) {
        let list = callers.get(target);
        if (list === undefined) {
          list = [];
          callers.set(target, list);
        }
        list.push({ caller: fn, passesSender: e.passesSender });
      }
    }
  }
  const queue = fns.filter((fn) => fn.sum.scalar || fn.sum.element || fn.sum.danger || fn.sum.ext);
  const queued = new Set(queue);
  for (let q = 0; q < queue.length; q += 1) {
    const callee = queue[q];
    queued.delete(callee);
    const s = callee.sum;
    for (const { caller, passesSender } of callers.get(callee) ?? []) {
      const c = caller.sum;
      const before = `${c.scalar}${c.element}${c.caller}${c.danger}${c.ext}`;
      c.scalar ||= s.scalar;
      c.element ||= s.element;
      c.caller ||= s.caller || (passesSender && s.element);
      c.danger ||= s.danger;
      c.ext ||= s.ext;
      if (before !== `${c.scalar}${c.element}${c.caller}${c.danger}${c.ext}` && !queued.has(caller)) {
        queued.add(caller);
        queue.push(caller);
      }
    }
  }
}

// ---- the checks ----

const place = (token) => ({ line: token.line, column: token.col });

function runFunctionChecks(registry, fn, options, add, file) {
  const f = fn.facts;
  if (!f.hasBody) return;
  const { model } = fn;
  const { tokens, match, parent } = model;
  const subject = fn.kind === 'function' ? fn.name : fn.kind === 'modifier' ? `modifier ${fn.name}` : fn.kind;
  const label = fn.kind === 'function' || fn.kind === 'modifier' ? `${fn.kind === 'modifier' ? 'The modifier' : 'The function'} ${fn.name}` : `The ${fn.kind} function`;
  const at = (pos) => place(tokens[pos]);
  const make = (id, pos, message, extra = {}) => add({ id, file, ...at(pos), message, subject, confidence: extra.confidence ?? null, severity: extra.severity ?? null });

  // 2: unchecked low-level calls
  const pendingBools = [];
  for (const call of f.lowLevel) {
    const stipend = call.member === 'transfer' || call.member === 'send';
    const discarded = call.member === 'transfer' ? false : isDiscarded(model, f, call, pendingBools);
    if (discarded) make('unchecked-low-level-call', call.pos, `${label} makes a .${call.member}() call and does not use the bool it returns, so a failed call goes unnoticed.`, { confidence: 'high' });
    else if (stipend) make('unchecked-low-level-call', call.pos, `${label} calls .${call.member}(), which passes a fixed gas stipend to the recipient; a recipient that is a contract may need more, and then the call fails.`, { severity: 'info', confidence: 'high' });
  }
  if (pendingBools.length > 0) {
    const names = new Map();
    for (const p of pendingBools) {
      const list = names.get(p.name);
      if (list === undefined) names.set(p.name, [p]);
      else list.push(p);
    }
    for (let i = f.lo; i < f.hi; i += 1) {
      const t = tokens[i];
      if (t.k === 'id' && names.has(t.v)) for (const p of names.get(t.v)) if (i > p.after) p.used = true;
    }
    for (const p of pendingBools) {
      if (!p.used) make('unchecked-low-level-call', p.pos, `${label} stores the bool of a .${p.member}() call in ${p.name} and never reads it, so a failed call goes unnoticed.`, { confidence: 'medium' });
    }
  }

  // 4: tx.origin
  for (const o of f.origins) {
    const st = o.stmt >= 0 ? f.statements[o.stmt] : null;
    const first = st === null ? null : tokens[st.s];
    const compared = isP(tokens[o.pos - 1], '==') || isP(tokens[o.pos - 1], '!=') || isP(tokens[o.pos + 3], '==') || isP(tokens[o.pos + 3], '!=');
    const inCondition = st !== null && (st.kind === 'if' || st.kind === 'while' || (st.kind === 'simple' && first.k === 'id' && (first.v === 'require' || first.v === 'assert')));
    if (!compared && !inCondition) continue;
    const withSender = (isP(tokens[o.pos - 1], '==') || isP(tokens[o.pos - 1], '!=')) ? senderEnd(tokens, o.pos - 1 - 3) >= 0 : (senderEnd(tokens, o.pos + 4) >= 0 && (isP(tokens[o.pos + 3], '==') || isP(tokens[o.pos + 3], '!=')));
    if (withSender) make('tx-origin-auth', o.pos, `${label} compares tx.origin with msg.sender. This is often used to keep contracts out, and it is listed because tx.origin is the account that started the transaction, not the caller.`, { confidence: 'low', severity: 'warning' });
    else make('tx-origin-auth', o.pos, `${label} uses tx.origin in a condition. A contract the owner is tricked into calling can pass this check as the owner; use msg.sender.`, { confidence: 'high' });
  }

  // 5: delegatecall and selfdestruct
  const guarded = fn.guarded === true;
  for (const d of f.delegates) {
    let param = false;
    if (d.asm) {
      const args = splitArguments(tokens, match, d.open, match[d.open]);
      if (args.length > 1 && args[1].hi - args[1].lo === 1 && tokens[args[1].lo].k === 'id' && fn.params.some((p) => p.name === tokens[args[1].lo].v)) param = true;
    } else if (d.receiverEnd >= 0) {
      const r = tokens[d.receiverEnd];
      if (r !== undefined && r.k === 'id' && fn.params.some((p) => p.name === r.v)) param = true;
      else if (r !== undefined && isP(r, ')') && match[d.receiverEnd] > 0) {
        const open = match[d.receiverEnd];
        if (open + 2 === d.receiverEnd && tokens[open + 1].k === 'id' && fn.params.some((p) => p.name === tokens[open + 1].v)) param = true;
      }
    }
    if (param) make('delegatecall-use', d.pos, `${label} uses delegatecall on an address that is a parameter of the function. Whoever calls it chooses the code that runs with the storage and the balance of this contract.`, { severity: 'error', confidence: 'high' });
    else if (guarded) make('delegatecall-use', d.pos, `${label} uses delegatecall and has an access check. The code at the target runs with the storage and the balance of this contract.`, { severity: 'info', confidence: 'medium' });
    else make('delegatecall-use', d.pos, `${label} uses delegatecall and has no sign of an access check. The code at the target runs with the storage and the balance of this contract.`, { severity: 'warning', confidence: 'medium' });
  }
  for (const s of f.selfdestructs) {
    if (guarded) make('selfdestruct-use', s.pos, `${label} calls selfdestruct and has an access check. The contract can be ended, and its balance sent, by whoever passes the check.`, { severity: 'info', confidence: 'medium' });
    else make('selfdestruct-use', s.pos, `${label} calls selfdestruct and has no sign of an access check. The contract can be ended, and its balance sent, by whoever calls it.`, { severity: 'warning', confidence: 'medium' });
  }

  // 6: randomness from block values
  const reportedStatements = new Set();
  for (const b of f.blockValues) {
    if (reportedStatements.has(b.stmt) && b.stmt >= 0) continue;
    const st = b.stmt >= 0 ? f.statements[b.stmt] : null;
    let inHash = false;
    let o = parent[b.pos];
    for (let step = 0; step < MAX_CLIMB && o >= f.lo; step += 1) {
      const t = tokens[o];
      if (isP(t, '(')) {
        const before = tokens[o - 1];
        if (before !== undefined && before.k === 'id') {
          if (HASHES.has(before.v)) inHash = true;
          else if (before.v.startsWith('encode') && isP(tokens[o - 2], '.') && isId(tokens[o - 3], 'abi')) inHash = true;
        }
      }
      if (inHash || isP(t, '{')) break;
      o = parent[o];
    }
    let withModulo = false;
    if (st !== null) {
      for (let k = st.s; k < st.e; k += 1) {
        if (isP(tokens[k], '%') || isP(tokens[k], '%=')) {
          withModulo = true;
          break;
        }
        if (tokens[k].k === 'pun' && tokens[k].v === '{' && match[k] > 0 && k > st.s) k = match[k];
      }
    }
    if (!inHash && !withModulo) continue;
    if (b.stmt >= 0) reportedStatements.add(b.stmt);
    const how = inHash && withModulo ? 'is hashed and reduced with %' : inHash ? 'is hashed' : 'is used with %';
    make('block-randomness', b.pos, `${label} uses ${b.name}, which ${how}. If this is meant to be random, the one who builds the block, or a contract that calls in the same block, can influence it.`, { confidence: inHash && withModulo ? 'high' : inHash ? 'medium' : 'low' });
  }

  // 7: loops over the length of a state array
  for (let n = 0; n < f.statements.length; n += 1) {
    const st = f.statements[n];
    if (st.kind !== 'for' && st.kind !== 'while') continue;
    let lo = st.cond[0];
    let hiC = st.cond[1];
    if (st.kind === 'for') {
      let semi = lo;
      let count = 0;
      let k = lo;
      let condLo = lo;
      while (k < hiC) {
        const t = tokens[k];
        if (t.k === 'pun' && (t.v === '(' || t.v === '[' || t.v === '{') && match[k] > 0) {
          k = match[k] + 1;
          continue;
        }
        if (isP(t, ';')) {
          count += 1;
          if (count === 1) condLo = k + 1;
          if (count === 2) {
            semi = k;
            break;
          }
        }
        k += 1;
      }
      if (count < 2) semi = hiC;
      lo = condLo;
      hiC = semi;
    }
    let array = null;
    let arrayAt = -1;
    for (let k = lo; k < hiC; k += 1) {
      const t = tokens[k];
      if (t.k !== 'id' || isP(tokens[k - 1], '.')) continue;
      if (isP(tokens[k + 1], '.') && isId(tokens[k + 2], 'length') && !f.locals.has(t.v)) {
        const variable = findVariable(registry, fn.contract, t.v);
        if (variable !== null && variable.dynamicArray) {
          array = t.v;
          arrayAt = k;
          break;
        }
      }
      if (f.lengthAlias.has(t.v)) {
        array = f.lengthAlias.get(t.v);
        arrayAt = k;
        break;
      }
    }
    if (array === null) continue;
    let bodyLo = st.after;
    let bodyHi = st.after;
    if (isP(tokens[st.after], '{') && match[st.after] > 0) {
      bodyLo = st.after + 1;
      bodyHi = match[st.after];
    } else if (f.statements[n + 1] !== undefined) {
      bodyLo = f.statements[n + 1].s;
      bodyHi = f.statements[n + 1].e;
    }
    const callInside = f.extCalls.some((c) => c.pos >= bodyLo && c.pos < bodyHi);
    make('unbounded-loop', arrayAt, `${label} loops up to the length of the state array ${array}${callInside ? ' and makes an external call in the loop' : ''}. If anyone can make the array longer, the loop can cost more gas than a block holds.`, { confidence: callInside ? 'high' : 'medium' });
  }
}

// Whether the result of a low-level call is thrown away. A named bool in a tuple that is never read is added to pending.
function isDiscarded(model, f, call, pending) {
  const { tokens, match, parent } = model;
  const st = call.stmt >= 0 ? f.statements[call.stmt] : null;
  if (st === null || st.kind !== 'simple') return false;
  const first = tokens[st.s];
  if (first.k === 'id' && USED_STARTS.has(first.v)) return false;
  const o = parent[call.pos];
  if (o >= st.s && o >= 0 && (isP(tokens[o], '(') || isP(tokens[o], '['))) {
    // nested in brackets: inside an argument, so the result is used, unless this is the tuple of a destructuring we look at below
    if (!(isP(first, '(') && o === st.s)) return false;
  }
  // a depth-0 assignment
  let eq = -1;
  for (let k = st.s; k < st.e; k += 1) {
    const t = tokens[k];
    if (t.k === 'pun') {
      if (t.v === '(' || t.v === '[' || t.v === '{') {
        k = match[k] > 0 ? match[k] : st.e;
        continue;
      }
      if (ASSIGN.has(t.v)) {
        eq = k;
        break;
      }
    }
  }
  if (eq < 0) return true;
  if (isP(first, '(') && match[st.s] === eq - 1) {
    const close = match[st.s];
    const end = firstArgumentEnd(tokens, match, st.s, close);
    if (end === st.s + 1) return true;
    if (end === st.s + 2 && isId(tokens[st.s + 1], 'bool')) return true;
    if (end === st.s + 3 && isId(tokens[st.s + 1], 'bool') && tokens[st.s + 2].k === 'id') {
      pending.push({ name: tokens[st.s + 2].v, pos: call.pos, after: st.e, member: call.member, used: false });
      return false;
    }
    return false;
  }
  return false;
}

// Check 1 and check 3 need what the called functions do, so they run after the facts are passed along.
function runCallChecks(registry, fn, options, add, file, access, locks) {
  const f = fn.facts;
  if (!f.hasBody || fn.kind === 'modifier' || fn.kind === 'constructor') return;
  const { model } = fn;
  const { tokens } = model;
  const subject = fn.kind === 'function' ? fn.name : fn.kind;
  const label = fn.kind === 'function' ? `The function ${fn.name}` : `The ${fn.kind} function`;
  const at = (pos) => place(tokens[pos]);
  const view = fn.mutability === 'view' || fn.mutability === 'pure';
  if (view) return;
  const visible = fn.visibility === 'public' || fn.visibility === 'external' || (fn.visibility === null && fn.kind === 'function');
  const mods = fn.modifiers.map((m) => m.name);

  // 3: an external call before a write to a state variable
  if (!mods.some((m) => locks.has(m))) {
    const calls = [];
    const writes = [];
    for (const c of f.extCalls) calls.push({ pos: c.pos, kind: c.kind, what: c.what, via: null });
    for (const w of f.writes) writes.push({ pos: w.pos, name: w.name, via: null });
    for (const e of f.edges) {
      const writer = e.targets.find((t) => t.sum.scalar || t.sum.element);
      const caller = e.targets.find((t) => t.sum.ext);
      if (writer !== undefined) writes.push({ pos: e.pos, name: writer.name, via: e.name });
      if (caller !== undefined) calls.push({ pos: e.pos, kind: 'low', what: `${e.name}()`, via: e.name });
    }
    if (calls.length > 0 && writes.length > 0) {
      calls.sort((a, b) => a.pos - b.pos);
      let last = writes[0];
      for (const w of writes) if (w.pos > last.pos) last = w;
      const call = calls.find((c) => c.pos < last.pos);
      if (call !== undefined) {
        const next = writes.filter((w) => w.pos > call.pos).sort((a, b) => a.pos - b.pos)[0];
        const writeText = next.via !== null ? `through ${next.via}()` : `to ${next.name}`;
        const nextTok = tokens[next.pos];
        const kindText = call.kind === 'low' ? 'a low-level call' : call.kind === 'ether' ? 'a transfer of ether' : call.kind === 'safe' ? 'a token transfer' : 'a call to another contract';
        add({ id: 'call-before-state-write', file, ...at(call.pos), message: `${label} makes ${kindText} (${call.what}) and writes state afterwards (${writeText}, line ${nextTok.line}). A callee that calls back sees the state before the write.`, subject, confidence: call.kind === 'low' ? 'high' : call.kind === 'ether' ? 'low' : 'medium', severity: null });
      }
    }
  }

  // 1: a state change that anyone can make
  if (!visible || fn.contract.kind !== 'contract') return;
  const direct = f.writes.length > 0 || f.selfdestructs.length > 0 || f.delegates.length > 0;
  const s = fn.sum;
  const changes = direct || s.scalar || s.element || s.danger;
  if (!changes) return;
  if (fn.guarded === true) return;
  const isInit = fn.name !== null && (fn.name === 'init' || (fn.name.startsWith('initialize') && !(fn.name[10] >= 'a' && fn.name[10] <= 'z')));
  if (isInit) {
    if (mods.some((m) => INIT_MODIFIERS.includes(m))) return;
    add({ id: 'state-change-no-access-check', file, ...place(fn.nameAt ?? fn.at), message: `${label} looks like an initializer and has no initializer modifier, so it may be called by anyone, and more than once.`, subject, confidence: 'medium', severity: 'info' });
    return;
  }
  // a function that writes only entries indexed by the sender acts on the caller's own entry
  const danger = f.selfdestructs.length > 0 || f.delegates.length > 0 || s.danger;
  if (!danger && !s.scalar && s.element && s.caller) return;
  const what = f.selfdestructs.length > 0 ? 'calls selfdestruct' : f.delegates.length > 0 ? 'uses delegatecall' : danger ? 'reaches selfdestruct or delegatecall through a function it calls' : s.scalar ? 'writes a state variable' : 'writes entries of a mapping or an array';
  const first = f.writes[0];
  const direct2 = f.selfdestructs.length > 0 || f.delegates.length > 0;
  const where = first !== undefined ? ` (${first.name}, line ${tokens[first.pos].line})` : direct2 ? '' : ' (through a function it calls)';
  add({ id: 'state-change-no-access-check', file, ...place(fn.nameAt ?? fn.at), message: `${label} is ${fn.visibility ?? 'public'}, ${what}${where}, and has no access modifier from the list and no comparison of msg.sender.`, subject, confidence: danger || (s.scalar && direct) ? 'high' : 'medium', severity: null });
}

// ---- the file checks ----

function runFileChecks(model, add, file) {
  const { tokens, parsed } = model;
  const make = (id, line, column, message, extra = {}) => add({ id, file, line, column, message, subject: null, confidence: extra.confidence ?? null, severity: extra.severity ?? null });
  for (const p of parsed.pragmas) {
    if (!p.text.startsWith('solidity')) continue;
    const range = p.text.slice('solidity'.length).trim();
    if (!isPinned(range)) make('floating-pragma', p.at.line, p.at.col, `The pragma "solidity ${range}" allows more than one compiler version. Pin the version you test and deploy with.`, { confidence: 'high' });
  }
  if (!model.spdx) make('missing-spdx', 1, 1, 'The file has no SPDX-License-Identifier comment.', { confidence: 'high' });
  for (const t of tokens) {
    if (t.k === 'str' && t.pre !== 'hex' && t.n >= 47 && t.n <= 4000 && secretShape(t.v) !== null) {
      make('secret-in-source', t.line, t.col, `A string is shaped like ${secretShape(t.v)}. The tool never reads a key and the value is not shown.`, { confidence: 'medium' });
    }
  }
  for (const c of model.comments) {
    const shape = secretShape(c.text);
    if (shape !== null) make('secret-in-source', c.line, c.column, `A comment is shaped like ${shape}. The tool never reads a key and the value is not shown.`, { confidence: 'medium' });
  }
}

// A pragma range that names one version: 0.8.24 or =0.8.24.
function isPinned(range) {
  const body = range.startsWith('=') ? range.slice(1).trim() : range;
  const parts = body.split('.');
  if (parts.length !== 3) return false;
  return parts.every((p) => p.length > 0 && p.length < 4 && [...p].every((c) => c >= '0' && c <= '9'));
}

// ---- a run ----

// models: the parsed files, each { file, tokens, match, parent, parsed, spdx, comments, typeNames }. Returns { findings, omitted }.
export function analyze(models, options = {}) {
  const accessNames = new Set(options.accessModifiers ?? ACCESS_MODIFIERS);
  const locks = new Set(LOCK_MODIFIERS);
  const collector = createCollector();
  const registry = buildRegistry(models);
  const everyFunction = [];
  for (const model of models) {
    const lists = [model.parsed.file, ...model.parsed.contracts];
    for (const c of lists) for (const fn of c.functions) everyFunction.push(fn);
  }
  for (const fn of everyFunction) collectFacts(registry, fn, options);
  propagate(everyFunction.filter((fn) => fn.kind !== 'modifier'));
  for (const fn of everyFunction) if (fn.kind === 'modifier') fn.sum = { scalar: false, element: false, caller: false, danger: false, ext: false };

  // which functions have a check of the caller: an access modifier, a custom modifier that checks the sender, or a check in the body
  const customCache = new Map();
  const modifierChecks = (name) => {
    if (customCache.has(name)) return customCache.get(name);
    let result = false;
    for (const m of registry.modifiersByName.get(name) ?? []) {
      if (m.facts.hasBody && hasAccessCheck(m.model, m.facts.statements, accessNames)) result = true;
    }
    customCache.set(name, result);
    return result;
  };
  for (const fn of everyFunction) {
    if (!fn.facts.hasBody) continue;
    fn.guarded = fn.modifiers.some((m) => accessNames.has(m.name) || modifierChecks(m.name)) || hasAccessCheck(fn.model, fn.facts.statements, accessNames);
  }

  for (const model of models) {
    runFileChecks(model, collector.add, model.file);
    for (const c of [model.parsed.file, ...model.parsed.contracts]) {
      for (const fn of c.functions) {
        runFunctionChecks(registry, fn, options, collector.add, model.file);
        runCallChecks(registry, fn, options, collector.add, model.file, accessNames, locks);
      }
    }
  }
  return { findings: collector.findings, omitted: collector.omitted };
}
