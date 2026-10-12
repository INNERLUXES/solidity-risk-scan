// The lightweight structure of one file: which brackets close which, which contracts, interfaces and libraries the file
// declares, their state variables, modifiers and functions (name, visibility, mutability, the modifiers applied, the range of
// the body in tokens) and the pragmas. Nothing here checks anything; it only finds where things are. It never recurses: the
// brackets are matched with a stack of indexes in one pass, and every walk is a loop that jumps over a bracket pair through
// the match table. Input that is not well formed gives a smaller model or a problem, never an exception.

export const KEYWORD_VISIBILITY = new Set(['public', 'external', 'internal', 'private']);
export const KEYWORD_MUTABILITY = new Set(['view', 'pure', 'payable', 'constant']);
const FUNCTION_LIKE = new Set(['function', 'constructor', 'receive', 'fallback', 'modifier']);
const CONTRACT_KINDS = new Set(['contract', 'interface', 'library']);
const STORAGE_WORDS = new Set(['memory', 'storage', 'calldata']);
const VAR_WORDS = new Set(['public', 'private', 'internal', 'constant', 'immutable', 'override', 'transient']);

const OPENERS = new Map([['(', ')'], ['[', ']'], ['{', '}']]);
const CLOSERS = new Set([')', ']', '}']);

// Matches every bracket in one pass. match[i] is the index of the other bracket of the pair (or -1); parent[i] is the index
// of the opening bracket around token i (or -1). Returns { match, parent, problem }; problem is null or { index, message }
// for a bracket that never closes, a closing bracket with no opening one, and a pair of two kinds.
export function matchBrackets(tokens) {
  const n = tokens.length;
  const match = new Int32Array(n).fill(-1);
  const parent = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let sp = 0;
  for (let i = 0; i < n; i += 1) {
    const t = tokens[i];
    if (t.k !== 'pun') {
      parent[i] = sp > 0 ? stack[sp - 1] : -1;
      continue;
    }
    if (OPENERS.has(t.v)) {
      parent[i] = sp > 0 ? stack[sp - 1] : -1;
      stack[sp] = i;
      sp += 1;
    } else if (CLOSERS.has(t.v)) {
      if (sp === 0) return { match, parent, problem: { index: i, message: `the bracket "${t.v}" closes nothing` } };
      const open = stack[sp - 1];
      if (OPENERS.get(tokens[open].v) !== t.v) return { match, parent, problem: { index: i, message: `the bracket "${t.v}" does not close the "${tokens[open].v}" opened at line ${tokens[open].line}, column ${tokens[open].col}` } };
      sp -= 1;
      match[open] = i;
      match[i] = open;
      parent[i] = sp > 0 ? stack[sp - 1] : -1;
    } else parent[i] = sp > 0 ? stack[sp - 1] : -1;
  }
  if (sp > 0) return { match, parent, problem: { index: stack[sp - 1], message: `the bracket "${tokens[stack[sp - 1]].v}" is never closed` } };
  return { match, parent, problem: null };
}

const isP = (t, v) => t !== undefined && t.k === 'pun' && t.v === v;
const isId = (t, v) => t !== undefined && t.k === 'id' && (v === undefined || t.v === v);

// The index after the statement that starts at j: past the next semicolon at the level of j, jumping over every bracket pair.
export function skipStatement(tokens, match, j, end) {
  let k = j;
  while (k < end) {
    const t = tokens[k];
    if (t.k === 'pun') {
      if (t.v === '(' || t.v === '[' || t.v === '{') {
        if (match[k] < 0) return end;
        k = match[k] + 1;
        continue;
      }
      if (t.v === ';') return k + 1;
      if (t.v === '}') return k;
    }
    k += 1;
  }
  return end;
}

// The parameters in the brackets open..close: [{ name, type, typeKey }] where type is the first word of the type and typeKey
// is 'address', a name or 'other'.
function readParams(tokens, match, open, close) {
  const out = [];
  let k = open + 1;
  let from = k;
  const flush = (to) => {
    if (to <= from) return;
    let name = null;
    const lastTok = tokens[to - 1];
    if (to - from >= 2 && lastTok.k === 'id' && !STORAGE_WORDS.has(lastTok.v) && lastTok.v !== 'payable') name = lastTok.v;
    const first = tokens[from];
    out.push({ name, type: first.v, typeKey: isP(tokens[from + 1], '.') ? 'other' : typeKeyOf(first.v), at: first });
  };
  while (k < close) {
    const t = tokens[k];
    if (t.k === 'pun' && (t.v === '(' || t.v === '[' || t.v === '{') && match[k] > 0) {
      k = match[k] + 1;
      continue;
    }
    if (isP(t, ',')) {
      flush(k);
      from = k + 1;
    }
    k += 1;
  }
  flush(close);
  return out;
}

const ELEMENTARY = new Set(['uint', 'int', 'bool', 'string', 'bytes', 'byte', 'address', 'fixed', 'ufixed', 'mapping', 'function', 'var']);
const isElementary = (w) => ELEMENTARY.has(w) || /^(?:u?int|bytes)\d+$/.test(w);

// The kind of a variable for the checks that follow calls: 'address', the name of a contract or interface, or 'other'.
export function typeKeyOf(word) {
  if (word === 'address') return 'address';
  if (isElementary(word)) return 'other';
  return word;
}

// Reads a function, constructor, receive, fallback or modifier whose keyword is at j. Returns { fn, next }, or null when the
// text is not one (a variable of a function type).
function readFunction(tokens, match, j, end, contract) {
  const kw = tokens[j].v;
  let k = j + 1;
  let name = kw;
  let nameAt = tokens[j];
  if ((kw === 'function' || kw === 'modifier') && isId(tokens[k])) {
    name = tokens[k].v;
    nameAt = tokens[k];
    k += 1;
  } else if (kw === 'function') name = null;
  let params = [];
  let paramsOpen = -1;
  if (isP(tokens[k], '(') && match[k] > 0) {
    paramsOpen = k;
    params = readParams(tokens, match, k, match[k]);
    k = match[k] + 1;
  }
  const fn = { kind: kw, name, nameAt, visibility: null, mutability: null, modifiers: [], params, returns: [], virtual: false, override: false, hasBody: false, bodyOpen: -1, bodyClose: -1, at: tokens[j], contract, paramsOpen };
  while (k < end) {
    const t = tokens[k];
    if (t.k === 'pun') {
      if (t.v === '{') {
        if (match[k] < 0) return null;
        fn.hasBody = true;
        fn.bodyOpen = k;
        fn.bodyClose = match[k];
        k = match[k] + 1;
        break;
      }
      if (t.v === ';') {
        k += 1;
        break;
      }
      if (t.v === '(' || t.v === '[') {
        k = match[k] > 0 ? match[k] + 1 : end;
        continue;
      }
      return null;
    }
    if (t.k === 'id') {
      if (KEYWORD_VISIBILITY.has(t.v)) fn.visibility = t.v;
      else if (KEYWORD_MUTABILITY.has(t.v)) fn.mutability = t.v === 'constant' ? 'view' : t.v;
      else if (t.v === 'virtual') fn.virtual = true;
      else if (t.v === 'override') {
        fn.override = true;
        if (isP(tokens[k + 1], '(') && match[k + 1] > 0) k = match[k + 1];
      } else if (t.v === 'returns') {
        if (isP(tokens[k + 1], '(') && match[k + 1] > 0) {
          fn.returns = readParams(tokens, match, k + 1, match[k + 1]);
          k = match[k + 1];
        }
      } else {
        let nameEnd = k;
        let modName = t.v;
        while (isP(tokens[nameEnd + 1], '.') && isId(tokens[nameEnd + 2])) {
          modName = tokens[nameEnd + 2].v;
          nameEnd += 2;
        }
        const mod = { name: modName, at: t, argsOpen: -1 };
        if (isP(tokens[nameEnd + 1], '(') && match[nameEnd + 1] > 0) {
          mod.argsOpen = nameEnd + 1;
          k = match[nameEnd + 1];
        } else k = nameEnd;
        fn.modifiers.push(mod);
      }
    }
    k += 1;
  }
  // function name () external; with no name and no body is a variable of a function type
  // in code for old compilers the constructor is the function that has the name of the contract
  if (kw === 'function' && name !== null && name === contract.name) fn.kind = 'constructor';
  if (kw === 'function' && fn.name === null && !fn.hasBody) return null;
  if (kw === 'function' && fn.name === null) {
    fn.kind = 'fallback';
    fn.name = 'fallback';
    fn.visibility = fn.visibility ?? 'external';
  }
  if (fn.kind === 'receive' || fn.kind === 'fallback') fn.visibility = fn.visibility ?? 'external';
  return { fn, next: k };
}

// Reads a state variable declaration that starts at j and ends at the next semicolon.
function readStateVariable(tokens, match, j, end) {
  const stop = skipStatement(tokens, match, j, end);
  const last = stop > j && isP(tokens[stop - 1], ';') ? stop - 1 : stop;
  // the declarator ends at the first "=" at the level of the declaration
  let eq = last;
  for (let k = j; k < last; k += 1) {
    const t = tokens[k];
    if (t.k === 'pun') {
      if (t.v === '(' || t.v === '[' || t.v === '{') {
        if (match[k] < 0) break;
        k = match[k];
        continue;
      }
      if (t.v === '=') {
        eq = k;
        break;
      }
    }
  }
  let nameAt = eq - 1;
  if (nameAt < j || tokens[nameAt].k !== 'id') return { next: stop, variable: null };
  const name = tokens[nameAt].v;
  let isConst = false;
  let dynamicArray = false;
  let isMapping = false;
  let first = null;
  let firstAt = j;
  for (let k = j; k < nameAt; k += 1) {
    const t = tokens[k];
    if (t.k === 'id') {
      if (t.v === 'constant' || t.v === 'immutable') isConst = true;
      if (VAR_WORDS.has(t.v)) {
        if (t.v === 'override' && isP(tokens[k + 1], '(') && match[k + 1] > 0) k = match[k + 1];
        continue;
      }
      if (first === null) {
        first = t.v;
        firstAt = k;
      }
      if (t.v === 'mapping') {
        isMapping = true;
        if (isP(tokens[k + 1], '(') && match[k + 1] > 0) k = match[k + 1];
      }
    } else if (t.k === 'pun' && t.v === '[' && match[k] > 0) {
      if (match[k] === k + 1) dynamicArray = true;
      k = match[k];
    } else if (t.k === 'pun' && t.v === '(' && match[k] > 0) k = match[k];
  }
  if (first === null) return { next: stop, variable: null };
  const dotted = isP(tokens[firstAt + 1], '.');
  const variable = { name, type: first, typeKey: dotted ? 'other' : typeKeyOf(first), isMapping, isConst, dynamicArray: dynamicArray || (first === 'bytes' && !isMapping), at: tokens[nameAt], contract: null };
  return { next: stop, variable };
}

// Reads the contracts, interfaces and libraries of a file, its free functions and its pragmas.
// Returns { contracts, freeFunctions, pragmas }.
export function parseFile(tokens, match) {
  const n = tokens.length;
  const contracts = [];
  const freeFunctions = [];
  const pragmas = [];
  const typeNames = new Set();
  const file = { name: null, kind: 'file', bases: [], stateVars: new Map(), functions: freeFunctions, modifiers: new Map(), at: tokens[0], free: true };
  let i = 0;
  while (i < n) {
    const t = tokens[i];
    if (t.k !== 'id') {
      i += 1;
      continue;
    }
    if (t.v === 'pragma' && tokens[i + 1] !== undefined && tokens[i + 1].k === 'pragma') {
      pragmas.push({ at: t, text: tokens[i + 1].v, textAt: tokens[i + 1] });
      i += 3;
      continue;
    }
    if (t.v === 'import' || t.v === 'using' || t.v === 'error' || t.v === 'event' || t.v === 'type') {
      if (t.v === 'type' && isId(tokens[i + 1])) typeNames.add(tokens[i + 1].v);
      i = skipStatement(tokens, match, i, n);
      continue;
    }
    if (t.v === 'struct' || t.v === 'enum') {
      if (isId(tokens[i + 1])) typeNames.add(tokens[i + 1].v);
      let k = i + 1;
      while (k < n && !isP(tokens[k], '{') && !isP(tokens[k], ';')) k += 1;
      i = k < n && isP(tokens[k], '{') && match[k] > 0 ? match[k] + 1 : k + 1;
      continue;
    }
    if (t.v === 'function' && !t.asm) {
      const r = readFunction(tokens, match, i, n, file);
      if (r !== null) {
        freeFunctions.push(r.fn);
        i = r.next;
        continue;
      }
      i = skipStatement(tokens, match, i, n);
      continue;
    }
    let kindAt = i;
    if (t.v === 'abstract' && isId(tokens[i + 1], 'contract')) kindAt = i + 1;
    if (CONTRACT_KINDS.has(tokens[kindAt].v) && isId(tokens[kindAt + 1])) {
      const kind = tokens[kindAt].v;
      const name = tokens[kindAt + 1].v;
      const bases = [];
      let k = kindAt + 2;
      let afterIs = false;
      while (k < n && !isP(tokens[k], '{') && !isP(tokens[k], ';')) {
        const u = tokens[k];
        if (u.k === 'pun' && u.v === '(' && match[k] > 0) {
          k = match[k] + 1;
          continue;
        }
        if (u.k === 'id' && u.v === 'is') afterIs = true;
        else if (u.k === 'id' && afterIs) {
          let baseName = u.v;
          while (isP(tokens[k + 1], '.') && isId(tokens[k + 2])) {
            baseName = tokens[k + 2].v;
            k += 2;
          }
          bases.push(baseName);
        }
        k += 1;
      }
      if (k >= n || !isP(tokens[k], '{') || match[k] < 0) {
        i = k + 1;
        continue;
      }
      const contract = { name, kind, bases, abstract: tokens[i].v === 'abstract', stateVars: new Map(), functions: [], modifiers: new Map(), at: tokens[kindAt + 1], bodyOpen: k, bodyClose: match[k], free: false };
      readContractBody(tokens, match, contract, typeNames);
      contracts.push(contract);
      i = match[k] + 1;
      continue;
    }
    i += 1;
  }
  return { contracts, freeFunctions, pragmas, file, typeNames };
}

function readContractBody(tokens, match, contract, typeNames) {
  let j = contract.bodyOpen + 1;
  const end = contract.bodyClose;
  while (j < end) {
    const t = tokens[j];
    if (t.k !== 'id') {
      j += 1;
      continue;
    }
    if (FUNCTION_LIKE.has(t.v)) {
      const r = readFunction(tokens, match, j, end, contract);
      if (r !== null) {
        if (r.fn.kind === 'modifier') {
          const list = contract.modifiers.get(r.fn.name);
          if (list === undefined) contract.modifiers.set(r.fn.name, [r.fn]);
          else list.push(r.fn);
        }
        contract.functions.push(r.fn);
        j = Math.max(r.next, j + 1);
        continue;
      }
    }
    if (t.v === 'event' || t.v === 'error' || t.v === 'using' || t.v === 'type') {
      if (t.v === 'type' && isId(tokens[j + 1])) typeNames.add(tokens[j + 1].v);
      j = skipStatement(tokens, match, j, end);
      continue;
    }
    if (t.v === 'struct' || t.v === 'enum') {
      if (isId(tokens[j + 1])) typeNames.add(tokens[j + 1].v);
      let k = j + 1;
      while (k < end && !isP(tokens[k], '{') && !isP(tokens[k], ';')) k += 1;
      j = k < end && isP(tokens[k], '{') && match[k] > 0 ? match[k] + 1 : k + 1;
      continue;
    }
    const { next, variable } = readStateVariable(tokens, match, j, end);
    if (variable !== null) {
      variable.contract = contract;
      if (!contract.stateVars.has(variable.name)) contract.stateVars.set(variable.name, variable);
    }
    j = Math.max(next, j + 1);
  }
}

const NOT_DECL = new Set(['return', 'emit', 'revert', 'delete', 'require', 'assert', 'if', 'else', 'for', 'while', 'do', 'new', 'this', 'super', 'abi', 'msg', 'block', 'tx', 'unchecked', 'try', 'catch', 'assembly', 'break', 'continue', 'throw', 'selfdestruct', 'suicide', 'keccak256', 'type', 'payable']);

// The statements of the body tokens lo..hi (exclusive), flat: control heads (if, for, while) with their condition, the other
// statements ending at a semicolon, and an assembly block as one statement. A block is not a statement of its own; its
// braces are skipped and the statements inside it follow in order. Returns [{ s, e, kind, cond }] where kind is 'simple',
// 'if', 'for', 'while', 'try' or 'asm', e is exclusive, and cond is [lo, hi) of a head, with after = the index after the head.
export function scanStatements(tokens, match, lo, hi) {
  const out = [];
  let j = lo;
  while (j < hi) {
    const t = tokens[j];
    if (t.k === 'pun' && (t.v === '{' || t.v === '}' || t.v === ';')) {
      j += 1;
      continue;
    }
    if (t.k === 'id') {
      const v = t.v;
      if ((v === 'if' || v === 'for' || v === 'while') && isP(tokens[j + 1], '(') && match[j + 1] > 0) {
        const close = match[j + 1];
        out.push({ s: j, e: close + 1, kind: v, cond: [j + 2, close], after: close + 1 });
        j = close + 1;
        continue;
      }
      if (v === 'else' || v === 'do' || v === 'unchecked') {
        j += 1;
        continue;
      }
      if (v === 'catch') {
        j += 1;
        if (isId(tokens[j]) && isP(tokens[j + 1], '(')) j += 1;
        if (isP(tokens[j], '(') && match[j] > 0) j = match[j] + 1;
        continue;
      }
      if (v === 'assembly') {
        let k = j + 1;
        while (k < hi && !(tokens[k].k === 'pun' && tokens[k].v === '{')) k += 1;
        if (k < hi && tokens[k].close !== undefined) {
          out.push({ s: j, e: tokens[k].close + 1, kind: 'asm', open: k });
          j = tokens[k].close + 1;
          continue;
        }
      }
      if (v === 'try') {
        let k = j + 1;
        while (k < hi && !isP(tokens[k], '{')) {
          if (tokens[k].k === 'pun' && (tokens[k].v === '(' || tokens[k].v === '[') && match[k] > 0) k = match[k] + 1;
          else k += 1;
        }
        out.push({ s: j, e: k, kind: 'try' });
        j = k;
        continue;
      }
    }
    let k = j;
    while (k < hi) {
      const u = tokens[k];
      if (u.k === 'pun') {
        if (u.v === '(' || u.v === '[' || u.v === '{') {
          k = match[k] > 0 ? match[k] + 1 : hi;
          continue;
        }
        if (u.v === ';' || u.v === '}') break;
      }
      k += 1;
    }
    out.push({ s: j, e: k, kind: 'simple' });
    j = k + 1;
  }
  return out;
}

// Reads a declaration of local variables in the tokens s..e (exclusive): [{ name, typeKey, storage }], or [] when the tokens are
// not one. Handles `T name`, `T memory name`, `address payable name`, `T[] storage name` and `(T a, T b) = ...`.
export function readDeclaration(tokens, match, s, e) {
  const t = tokens[s];
  if (t === undefined || s >= e) return [];
  if (t.k === 'pun' && t.v === '(' && match[s] > 0 && match[s] < e) {
    if (!isP(tokens[match[s] + 1], '=')) return [];
    const out = [];
    let from = s + 1;
    const close = match[s];
    const flush = (to) => {
      if (to - from >= 2 && tokens[to - 1].k === 'id' && tokens[from].k === 'id') {
        const word = tokens[to - 1].v;
        if (!STORAGE_WORDS.has(word) && word !== 'payable') out.push({ name: word, typeKey: typeKeyOf(tokens[from].v), storage: tokens.slice(from, to).some((x) => x.v === 'storage') });
      }
    };
    for (let k = s + 1; k < close; k += 1) {
      const u = tokens[k];
      if (u.k === 'pun' && (u.v === '(' || u.v === '[') && match[k] > 0) {
        k = match[k];
        continue;
      }
      if (isP(u, ',')) {
        flush(k);
        from = k + 1;
      }
    }
    flush(close);
    return out;
  }
  if (t.k !== 'id' || NOT_DECL.has(t.v)) return [];
  let k = s + 1;
  while (isP(tokens[k], '.') && isId(tokens[k + 1]) && k + 1 < e) k += 2;
  if (isId(tokens[k], 'payable')) k += 1;
  while (isP(tokens[k], '[') && match[k] > 0) k = match[k] + 1;
  let storage = false;
  if (tokens[k] !== undefined && tokens[k].k === 'id' && STORAGE_WORDS.has(tokens[k].v)) {
    storage = tokens[k].v === 'storage';
    k += 1;
  }
  const name = tokens[k];
  if (k >= e || name === undefined || name.k !== 'id' || NOT_DECL.has(name.v) || STORAGE_WORDS.has(name.v)) return [];
  if (k + 1 < e && !isP(tokens[k + 1], '=')) return [];
  return [{ name: name.v, typeKey: isP(tokens[s + 1], '.') ? 'other' : typeKeyOf(t.v), storage, initAt: k + 1 < e ? k + 2 : -1 }];
}
