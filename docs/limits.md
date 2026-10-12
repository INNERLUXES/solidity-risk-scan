# Limits

solidity-risk-scan is a pattern-based first pass over the text of Solidity files. It has false positives and false negatives, it
points a reviewer at places to look, and it is not an audit. This document says what that means: what the tool cannot see,
where it can be wrong, and the limits of the work it does.

## What a clean result means

A run with no finding at or above the fail-on level means that none of the patterns the checks look for were found in the text
of the files that were read. It does not mean the code is safe. It does not mean the logic is right, that the contract does
what its authors meant, that a price it trusts cannot be moved, that its keys are held well, or that it has been tested.
Nothing in the tool compiles the code, runs it, or compares it with a specification.

## What the tool cannot see

- **Intent.** The tool does not know what a function is meant to do. A function that is open on purpose (a vote, a
  registration) is listed by `state-change-no-access-check`; a function that is open by mistake and writes only the entry of
  the caller is not.
- **The compiler.** There is no type checker. A type is the first word of its declaration. Overloads, the order of
  inheritance, imports that rename, remappings, the pragma and the version of the compiler are not resolved.
- **Inheritance across files, except by name.** A base contract is found by its name among the files given to the run. The
  contracts in a chain are followed up to 64 deep. A base that is not in those files (an import from a library such as
  OpenZeppelin that was left out, because `lib` and `node_modules` are not walked) is not seen: its state variables are not
  known as state, its modifiers are not known, and its functions are not followed. Two contracts with the same name are both
  taken as the base.
- **Calls through types it does not know.** A call through a variable is an external call when the variable is an `address`
  (the low-level members) or its type is a contract or interface declared in the files, or is named like an interface: an `I`
  and a capital letter. A call through any other unknown type is not seen. A function that an interface declares `view` or
  `pure` is not counted, and a function of an interface that is not in the files is counted.
- **Writes it cannot trace.** A write through a storage pointer that is not declared in the same function with `storage` and set
  from a state variable, a write by a library function that takes a storage pointer, a write in another contract, and a write in
  a modifier are not seen as writes of the function. A write in a function called through a function pointer is not seen.
- **Access control written some other way.** A check by signature, by a role system whose check is in a base contract that is
  not in the files, by a custom error raised in a function of another contract, or by a modifier whose name is not on the list
  and whose body does not compare the sender, is not seen as a check.
- **Functions that move value without writing state.** A function that sends ether or tokens and writes no state variable (a sweep to an address the caller gives) is not a state change for `state-change-no-access-check`, and is listed only if another check finds something in it.
- **A guard that wraps the change.** `if (msg.sender == owner) { ... }` around the writes is not read as a check of the caller; only an `if` that reverts when the sender is not allowed is. The function is listed.
- **Self-service writes.** A function whose writes are all to entries indexed by the sender is read as acting on the caller's
  own entry. A function that writes `balances[msg.sender]` and also `balances[someone else]` is treated the same way (a token
  transfer). The tool cannot tell that apart from a bug that lets the caller write the entry of another account.
- **Order in a loop.** The order of a call and a write is the order in the text of the function. A call late in a loop body and
  a write earlier in the same loop body are not seen as a call before a write.
- **Randomness that passes through a variable.** A block value stored first and hashed later is not seen.
- **The size of an array.** `unbounded-loop` lists a loop over a state array whether or not the array can grow without limit.
- **Everything that is not a pattern.** Price oracle manipulation, flash loans, integer arithmetic, signature replay, upgrade
  safety, front-running, gas griefing, rounding, and errors of logic.
- **Assembly.** An assembly block is read only for `sstore`, `delegatecall` and `selfdestruct` by name.
- **What is not text.** Compiled output, ABI files, and anything that is not Solidity.

## Where it can be wrong

- A **false positive** is a finding that is not a problem. The check of who calls is the noisiest, because a function open on
  purpose cannot be told from one that is open by mistake. The confidence of a finding is the check's own estimate from the form
  that matched; it is not a probability.
- A **false negative** is a problem that is not found. Every item of the list above is one. Do not read a clean report as a
  finding that the code is safe.
- A **wrong place**: the line and column of a finding are those of the token the check looked at (the name of the function, the
  member of the call, the array in the condition), in UTF-16 units from 1.

## Secrets

The search for keys looks at strings and comments of 47 to 4,000 characters for four shapes: a mnemonic, an extended private
key, a private key in hex and a private key in WIF. The shapes are loose, so a value that is not a key can be listed. A key in a
form that is not one of the shapes, split over several strings, or written as a number in hex in the code (it has the shape of a
hash constant) is not found. A value that is found is never written to a report or an error message.

## Limits of the work

| What | Limit |
| --- | --- |
| Size of a file | 16 MB |
| Tokens in a file | 2,000,000 |
| Tokens in all the files of a run | 3,000,000 |
| Bytes in all the files of a run | 256 MB |
| Files from a walk | 5,000 |
| Directory entries from a walk | 200,000 |
| Depth of a walk | 64 folders |
| Findings of one check that are listed | 1,000 |
| Contracts followed along a chain of bases | 64 |
| Brackets looked at when a block value is searched for a hash | 64 |
| Names in `--access-modifiers` | 50 |

A file or a folder past a limit is a `file-unreadable` finding, so a run never passes on part of its input without saying so. The
findings of one check past 1,000 are counted and noted.

The work is linear in the size of the input, except for the passing of facts along calls, which visits each function a small
number of times. No function calls itself, and no pattern is built from the input. A test with a hundred thousand nested
braces, parentheses and brackets, a million tokens, lines of millions of characters, chains and rings of functions and of
contracts checks the time, with limits that widen under coverage only.
