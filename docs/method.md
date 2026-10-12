# Method

solidity-risk-scan is a pattern-based first pass over the text of Solidity files. It points a reviewer at places to look; it is
not an audit. Every check below is a heuristic of this tool, with false positives and false negatives. None is a rule of
OWASP, and none is a proof that code is safe or unsafe. Each check names, by name only, the item of the OWASP Smart Contract
Top 10 that it relates to, so that a reviewer can find the kind of weakness in that list.

This document says what each check reads and what it cannot see. `--explain <id>` prints the same in the terminal.

## How a function is read

For each function with a body the tool collects facts in one pass over its tokens, skipping assembly blocks:

- the **locals**: parameters, return values and declared variables, with a type key (`address`, the name of a type, or other);
  a local with the name of a state variable hides it; a local declared with `storage` and set from a state variable is an alias
  of it; a local set from `array.length` of a state array is an alias of that length (outside the head of a loop);
- the **writes** to state variables: an assignment or a compound assignment, `++` and `--`, `delete`, a `push` or `pop`, and
  the names in a tuple on the left of `=`, after an index and field chain (`a[x].b = 1`); each write is a scalar write or a
  write to an entry (it has an index), and an entry write is of the caller when an index holds `msg.sender` or `_msgSender()`;
  a `sstore` in assembly is a scalar write; `constant` and `immutable` variables are not written;
- the **external calls**: a low-level `.call` or `.delegatecall` (a call), `.send` and `.transfer` with one argument (ether), a
  `safeTransfer` family function, a call through a variable of a contract or interface type, and a call through a cast to one
  (`IToken(x).transfer(...)`); a function that the interface declares `view` or `pure` is not counted;
- the **calls to functions of the same contract**, its bases and the free functions of the file, found by name.

Facts are then passed along the calls with a worklist: a function that calls a function that writes state is read as writing
state, one that calls a function that makes an external call is read as making one, and the same for `selfdestruct` and
`delegatecall`. A call to `f(msg.sender)` makes an entry write of the callee an entry write of the caller. No function calls
itself, and a ring of functions that call each other ends.

A **type is a contract or an interface** when one of the scanned files declares it as one, or, when no file declares it and it is
not a struct, an enum or a value type of the files, when it is written like an interface: an `I` followed by a capital letter.
Any other unknown type is not followed.

## A check of who calls

A function has a check of the caller when any of these holds:

- it has a modifier from the list (`onlyOwner`, `onlyRole`, `onlyAdmin`, `auth`, `requiresAuth`, or the names given with
  `--access-modifiers`, which replace the list);
- it has a modifier that is defined in the scanned files and whose body has such a check (by name, in any file);
- its body has `require(...)` or `assert(...)` whose first argument compares `msg.sender` (or `_msgSender()`) with something
  using `==`, on either side, other than `tx.origin`; or is one lookup of the sender in a mapping, such as
  `require(admins[msg.sender])`; or calls `hasRole`, `isOwner`, `isAdmin`, `isAuthorized`, `canCall`, `_checkRole` or
  `_checkOwner`;
- it has an `if` whose condition compares the sender with `!=` (or is a negated lookup or role call) and has no `==`, and whose
  body reverts;
- it calls `_checkOwner()`, `_checkRole()`, `_requireOwner()`, `_requireAuth()`, `_onlyOwner()`, `_onlyRole()`, `_onlyAdmin()` or
  a function named like a modifier of the list.

`whenNotPaused` is not one: it stops everyone alike and says nothing about who may call. `msg.sender != address(0)`, a comparison
with `tx.origin` and a test of a balance are not checks of who calls either.

## The checks

### state-change-no-access-check

**Looks at.** A function that is `public` or `external` (or has no visibility), is not `view` or `pure`, is in a contract (not in
a library, an interface or at the top of a file), and writes a state variable, directly or through functions it calls, or calls
`selfdestruct` or `delegatecall`, with no check of the caller. The constructor is not looked at. Level warning; confidence high
when a scalar variable is written or `selfdestruct` or `delegatecall` is reached, medium when only entries of mappings or arrays
are written.

**Self-service.** A function whose writes are all to entries of mappings or arrays and at least one of which is indexed by the
sender is read as acting on the caller's own entry, and is not listed (`deposit`, `approve`, `transfer` of a token). This hides
a transfer function that also lets the caller write the entry of someone else; the tool cannot tell.

**Initializers.** A function named `init` or `initialize...` that writes state and has no `initializer`, `reinitializer` or
`onlyInitializing` modifier and no check of the caller is a note (info): it may be called by anyone, and more than once.

**Cannot see.** The intent. A function that is open on purpose is listed. A check made some other way (a signature, a check in
a base contract that is not in the files, a call to a function that reverts) is not seen. Writes through a pointer it cannot
trace or in another contract are not seen.

### unchecked-low-level-call

**Looks at.** `.call`, `.delegatecall`, `.staticcall` and `.send` (with `{value: ...}` options or not) in a statement that
throws the result away: the statement has no assignment and the call is not inside brackets, a `require`, an `assert`, a
`return` or an `if`; or a tuple in which the bool is left out (`(, bytes memory d) = ...`, `(bool, ) = ...`) or named and
never read afterwards in the function. Level error; confidence high, or medium for a named bool that is never read.
`.transfer(x)` with one argument and `.send` whose result is used are a note (info) for the fixed gas stipend.

**Cannot see.** A result stored in a variable that is never read, except for a bool in a tuple. A result passed on through
another variable is taken as used.

### call-before-state-write

**Looks at.** In one function (not a constructor, a modifier, a `view` or a `pure` function), an external call followed in the
text by a write to a state variable, with no `nonReentrant`, `noReentrancy`, `noReentrant` or `nonreentrant` modifier. Calls and
writes through functions of the same contract count at the place of the call. Level warning; confidence high for a low-level
call, medium for a call through a contract variable or `safeTransfer`, low for `.transfer` and `.send`. One finding for a
function, at the first call that has a write after it.

**Cannot see.** That a callee is trusted or cannot call back, a lock written in another form, the order in a loop (a call
late in a loop body and a write earlier in it), or a call through a variable whose type it cannot tell.

### tx-origin-auth

**Looks at.** `tx.origin` in an `if`, a `while`, a `require`, an `assert`, or next to `==` or `!=`. Level error, confidence
high. `tx.origin` compared with `msg.sender` (either side) is a warning with low confidence: it is a common way to keep
contracts out, and is listed because `tx.origin` is the account that started the transaction, not the caller.

**Cannot see.** `tx.origin` used some other way (stored, emitted) is not listed.

### delegatecall-use

**Looks at.** `.delegatecall` and `delegatecall(` in assembly. It is an error (high) when the address is a parameter of the
function, written directly, through `address(...)` or `payable(...)`, or as the second argument of `delegatecall(` in assembly.
Otherwise it is a warning (medium), and info when the function has a check of the caller.

**Cannot see.** Where the target comes from beyond a parameter of the same function; whether a proxy is built correctly.

### selfdestruct-use

**Looks at.** `selfdestruct(` and `suicide(`, also in assembly. Warning (medium), info when the function has a check of the
caller.

**Cannot see.** Who can reach the function when the check is written in a form it does not know.

### block-randomness

**Looks at.** `block.timestamp`, `block.number`, `block.prevrandao`, `block.difficulty` and `blockhash(` used inside the
arguments of `keccak256`, `sha256`, `ripemd160` or `abi.encode...` (looking up to 64 brackets out), or in a statement that has
`%`. Warning; confidence high when both, medium for a hash alone, low for `%` alone. One finding for a statement.

**Cannot see.** A block value passed through a variable first; a use that has nothing to do with randomness (a period, a
bucket of time) is listed with low confidence.

### unbounded-loop

**Looks at.** A `for` (the condition between its two semicolons) or `while` whose condition holds `name.length` where `name` is
a state variable that is a dynamic array or `bytes`, or a local set from that length in its declaration. Warning; confidence
high when the body makes an external call, medium otherwise.

**Cannot see.** Whether the array can grow without limit: an array that only the owner fills is listed too. A bound that
comes through a function call is not seen.

### floating-pragma and missing-spdx

**Looks at.** The text of each `pragma solidity` up to its semicolon: a range is anything that is not one version, written
`0.8.24` or `=0.8.24`. And the text of the comments for `SPDX-License-Identifier:`. Both are info.

**Cannot see.** Which compiler version your build uses; whether the identifier is valid.

### secret-in-source

**Looks at.** The body of every string (not `hex"..."`) and every comment of 47 to 4,000 characters, for the shapes of
`src/secrets.js`: a mnemonic of 12, 15, 18, 21 or 24 words of 3 to 8 lowercase letters, an extended private key, a private key
in hex (64 digits, with or without `0x`) and a private key in WIF. Error, confidence medium. The value is never shown.

**Cannot see.** A key split over several strings; a key written as a number in hex in the code, which has the shape of a hash
constant and is left alone.

### file-unreadable

**Looks at.** A file that could not be read (not text, too large, a link), could not be followed by the lexer, has brackets that
do not match, has too many tokens, or sits in a folder that went past a limit of the walk. Error, confidence high. Nothing in
the file is checked.

## Levels and confidence

Levels follow what a reviewer should do: an **error** is a pattern that is wrong in almost every use (a dropped result of a
low-level call, `tx.origin` as the check of who calls, a key in a file); a **warning** is a pattern that needs a decision and is
often right; an **info** is a note. **Confidence** says how likely it is that the finding is what it looks like: it is the
check's own estimate from the form that matched, and it is not a probability. `--fail-on` and `--min-severity` work on the
level.
