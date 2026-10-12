# solidity-risk-scan

Solidity risk scan. A first pass over Solidity code can be run before an audit: give it `.sol` files, or folders of them, and
it lists, with the file, line and column, functions that change state with no access check, low-level calls whose result is
ignored, external calls made before state is updated, `tx.origin` checks, `delegatecall` and `selfdestruct`, randomness taken
from block values, and loops over the length of a state array. It points reviewers at places to look. Every finding has its
id, level, confidence, message and place, and the run exits with a code a pipeline can act on.

**This is a pattern-based first pass, not an audit.** It reads the text of the files with a lexer and a light parser of its own.
It does not compile the code, run it, or follow it across files except by the name of a base contract, so it has false
positives (a function that is open on purpose is listed) and false negatives (a check written in a form it does not know is
missed). A clean run means only that none of the patterns of its checks were found in the text. It does not replace a manual
audit, and it says nothing about the logic of the contract, the price it trusts, or the people who hold its keys. Every check is
a heuristic of this tool. Each one names the kind of weakness it relates to from the OWASP Smart Contract Top 10, by name only;
no check is a rule of OWASP, and the tool is not made by or endorsed by OWASP.

The tool contacts nothing over the network, runs nothing, needs no key, reads no clock and writes nothing to disk.

- **One check per pattern.** Twelve checks, each with a level, a confidence, the name of the OWASP item it relates to, what it
  looks at, what to change and what it cannot see (`--list-checks`, `--explain <id>`). A finding can carry another level or
  confidence than the usual one of its check, and says why in its message.
- **A lexer and a parser of its own.** Comments, strings (including `unicode"..."` and `hex"..."`), numbers, identifiers,
  punctuation and assembly blocks are read strictly; a file the lexer cannot follow is a `file-unreadable` error with the line
  and column where it stopped, never a pass. Contracts, interfaces, libraries, state variables, modifiers, functions and
  statements are found with a table of matching brackets, so deep nesting costs time in proportion to size and no stack.
- **Access checks as they are written.** A modifier from the list (`onlyOwner`, `onlyRole`, `onlyAdmin`, `auth`,
  `requiresAuth`, or your own with `--access-modifiers`), a modifier of the scanned files that compares `msg.sender`, a
  `require` or `assert` that compares the sender, and an `if` that reverts count. `whenNotPaused` does not count.
- **Inheritance by name.** A base contract is found by name among the files of the run, up to 64 contracts deep, so state
  variables and modifiers of a base in another file are known. A base that is not in the files given is not seen.
- **Bounded.** Folders are walked with a stack of the tool's own to a depth and a number of files that are bounded; files,
  tokens and findings are bounded too. `node_modules`, `lib`, `.git`, `test`, `tests` and `*.t.sol` are left out of a walk
  (`--include-tests` puts the tests back), and a symbolic link out of the folder given is refused.
- **Never a secret.** A string or a comment shaped like a mnemonic, an extended private key, a private key in hex or a key in
  WIF is an error, and the value is never shown.
- Reports as text, markdown, JSON and SARIF, with an exit code for a pipeline: `0` no finding at or above the `--fail-on`
  level, `1` a finding at or above it, `2` usage or input error.
- Plain JavaScript, no dependencies, no clock and no network.

```
npm test
```

```
tests 230
pass 226
fail 0
skipped 4
```

These are the summary lines that `npm test` prints at the end on Windows. The skipped tests are the ones that need a symbolic
link or a device; they are guarded with `process.platform`, run on Linux and macOS, and none of them asserts a line.
`npm run test:coverage` runs the same tests with coverage; their time limits are four times wider when coverage is on.

## Quick start

Requires Node 22 or newer. There is nothing to install.

```
git clone https://github.com/INNERLUXES/solidity-risk-scan.git
cd solidity-risk-scan
node bin/solidity-risk-scan.js examples/bad
```

Or without a clone, in your own project:

```
npx --yes github:INNERLUXES/solidity-risk-scan contracts
```

To see why a check exists and what it cannot see:

```
node bin/solidity-risk-scan.js --explain call-before-state-write
```

`examples/` holds two made-up folders of contracts. Every contract, name and address in them is made up. The bad folder, in
`examples/bad`, holds a mistake of every check but `file-unreadable`, which fires only on a file the lexer cannot follow: a
vault that sends ether before it writes the balance, drops the result of a call, stores a result it never reads and leaves
state-changing functions open; a wallet that asks `tx.origin` who is calling; a shim that runs `delegatecall` on an address
given by the caller, once with and once without an access check, and ends itself; a draw that takes its randomness from the
block and loops over a list that grows; and an old registry with a floating pragma, no license line and a made-up phrase of
twelve words in a string. The good folder, in `examples/good`, passes at error, warning and info level: a base contract that
keeps an owner, an interface, a vault that writes state before it sends and holds a lock, a token whose functions change
only the entries of the caller, and a payout list with a library and a bounded batch.

## Usage

```
solidity-risk-scan <path...> [options]
```

```
--format <name>             text, markdown, json or sarif (default: text)
--json                      the same as --format json
--min-severity <level>      the lowest level of a finding that is shown: info, warning, error (default: info)
--fail-on <level>           the lowest level of a finding that fails the run: info, warning, error (default: error)
--access-modifiers <list>   the modifiers that count as a check of who calls, separated by commas
                            (default: onlyOwner,onlyRole,onlyAdmin,auth,requiresAuth)
--include-tests             also read folders named test and tests and files that end in .t.sol
--list-checks               list the checks with their level, confidence and OWASP item, and exit
--explain <id>              explain one check: what it looks at, what to change, what it cannot see, and exit
--help                      show the usage
--version                   show the version
```

[docs/inputs.md](docs/inputs.md) says which files are read and what the parser understands. The path in the report is
relative to the folder you run the command in, with forward slashes on every system, followed by the line and the column.

The report of the bad example starts with what was read, the findings in one line, and the checks with the number of findings
of each; then the findings, errors first, each with what to change:

```
solidity-risk-scan: examples/bad
files: 5 read, 0 not read, 178 lines
contracts: 5 contracts, 0 interfaces, 0 libraries; 29 functions
access modifiers: onlyOwner, onlyRole, onlyAdmin, auth, requiresAuth
findings: 34 (8 error, 20 warning, 6 info)

Checks (12)

  check                         level    confidence  findings
  file-unreadable               error    high        0
  state-change-no-access-check  warning  medium      10
  unchecked-low-level-call      error    high        4
  call-before-state-write       warning  medium      3
  tx-origin-auth                error    high        3
  delegatecall-use              warning  medium      4
  selfdestruct-use              warning  medium      2
  block-randomness              warning  medium      3
  unbounded-loop                warning  medium      2
  floating-pragma               info     high        1
  missing-spdx                  info     high        1
  secret-in-source              error    medium      1

```

A finding says what was found and where, how sure the check is, which kind of weakness it relates to, and what to change:

```
  WARNING  call-before-state-write       examples/bad/LeakyVault.sol:21:36
           The function withdraw makes a low-level call (.call) and writes state afterwards (to balances, line 23). A callee that calls back sees the state before the write.
           confidence: high; relates to: Reentrancy Attacks (a heuristic of this tool, not a rule of OWASP)
           fix: Write the state first and make the external call last (checks, effects, interactions), or guard the function with a reentrancy lock.
```

After the findings comes the table of files:

```
Files (5)

  file                           lines  contracts  functions  findings
  examples/bad/LeakyVault.sol    55     1          10         12
  examples/bad/LuckyDraw.sol     39     1          6          6
  examples/bad/OldRegistry.sol   12     1          1          4
  examples/bad/OriginWallet.sol  25     1          4          3
  examples/bad/UpgradeShim.sol   47     1          8          9

```

The end of the report holds the notes, if any, the notice and the result:

```
This report is a heuristic first pass over the text of the files. It points a reviewer at places to look; it is not an audit, it does not compile or run the code, and a clean report does not mean the code is safe.

RESULT: FAIL - 8 findings at or above error (8 error, 20 warning, 6 info)

```

The good example passes:

```

Files (5)

  file                           lines  contracts  functions  findings
  examples/good/IVault.sol       10     1          3          0
  examples/good/Ownable.sol      22     1          3          0
  examples/good/Payouts.sol      38     2          3          0
  examples/good/SimpleToken.sol  46     1          4          0
  examples/good/Vault.sol        49     1          5          0

This report is a heuristic first pass over the text of the files. It points a reviewer at places to look; it is not an audit, it does not compile or run the code, and a clean report does not mean the code is safe.

RESULT: PASS - no finding at or above error

```

`--explain` gives the reason of one check:

```
call-before-state-write

level: warning
confidence: medium
relates to: Reentrancy Attacks

what it looks at: in one function, an external call (a low-level call, transfer, send, a call through an address or contract variable, safeTransfer) comes before a write to a state variable, and the function has no nonReentrant modifier

why it exists: If the callee can call back before the state is updated, it sees the old state. The pattern of a call followed by a write is where that happens.

what to change: Write the state first and make the external call last (checks, effects, interactions), or guard the function with a reentrancy lock.

what it cannot see: It follows the order of the text of one function and the internal functions it calls by name. It does not know that a callee is trusted, that a call cannot call back, or that a lock exists in another form. Calls through variables whose type it cannot tell are not seen.

This check is a heuristic of this tool; it is not a rule of OWASP and it is not proof that the code is safe or unsafe. The tool is a pattern-based first pass over the text of Solidity files; it points a reviewer at places to look and it is not an audit.
```

The output of both examples in all formats, the list of checks, and the explanation above are saved in `examples/output`.

## How files are found and read

1. A path that is a file is read, whatever its name. A path that is a folder is walked with a stack of the tool's own, in the
   order of the names, to 64 folders deep and 5,000 files. The folders `node_modules`, `lib` and `.git` are always left out of a
   walk, and so are the folders `test` and `tests` and the files ending in `.t.sol` unless `--include-tests` is given. Only
   files ending in `.sol` are taken from a folder. A path that does not exist, a link given as a path, and a device are refused
   with exit code `2` and no report; a folder with no Solidity file in it is refused too.
2. Inside a folder, a symbolic link to a file whose real path is inside the folder is read once, under its own name; a link
   to a place outside the folder is refused with a note, and a link to a folder is not followed.
3. A file is read as UTF-8 (a byte order mark is dropped) or as UTF-16 with a byte order mark, up to 16 MB. A file that is not
   text, holds a null byte or is too large is a `file-unreadable` finding, and the other files are still read.
4. The lexer turns the text into at most 2,000,000 tokens. A comment or a string never closed, a character that Solidity does
   not use outside a string, a pragma with no semicolon, and brackets that do not match are `file-unreadable` findings with the
   line and column where the reader stopped. Nothing in such a file is checked.
5. The parser finds the contracts, interfaces and libraries of the file, their bases, state variables, modifiers and functions
   with their visibility, mutability and modifiers, and the statements of each body. All the files of the run are parsed before
   any check runs, so that a base contract in another file is known by its name.
6. The checks run on each function. Facts about a function (it writes state, it makes an external call, it reaches
   `selfdestruct`) are passed along the calls between functions of a contract and its bases by name, with a worklist and no
   recursion.

[docs/method.md](docs/method.md) says what each check reads and what it cannot see.

## What it checks

| Check | Level | Confidence | OWASP item | What it reports |
| --- | --- | --- | --- | --- |
| `file-unreadable` | error | high | - | a file the tool could not read or follow (not UTF-8, too large, a comment or string never closed, a character Solidity does not use, brackets that do not match, too many tokens), so nothing in it was checked |
| `state-change-no-access-check` | warning | medium | Access Control Vulnerabilities | a public or external function that is not view or pure and writes a state variable, or calls selfdestruct or delegatecall, with no access modifier from the list and no comparison of msg.sender in its body |
| `unchecked-low-level-call` | error | high | Unchecked External Calls | a low-level call, delegatecall, staticcall or send whose bool result is not used; also a note on transfer and send, which pass a fixed gas stipend |
| `call-before-state-write` | warning | medium | Reentrancy Attacks | in one function, an external call (a low-level call, transfer, send, a call through an address or contract variable, safeTransfer) comes before a write to a state variable, and the function has no nonReentrant modifier |
| `tx-origin-auth` | error | high | Access Control Vulnerabilities | tx.origin used in a comparison, a require, an assert, an if or a while |
| `delegatecall-use` | warning | medium | Unchecked External Calls | delegatecall, which runs code of another contract with the storage of this one; an error when the target is a parameter of the function, info when the function has an access check |
| `selfdestruct-use` | warning | medium | Access Control Vulnerabilities | selfdestruct (or suicide), which removes the code of the contract and sends its balance away; info when the function has an access check |
| `block-randomness` | warning | medium | Insecure Randomness | block.timestamp, block.number, block.prevrandao, block.difficulty or blockhash used inside keccak256, sha256 or abi.encode, or in a statement with % |
| `unbounded-loop` | warning | medium | Denial of Service (DoS) Attacks | a for or while loop whose condition compares with the length of a state array |
| `floating-pragma` | info | high | - | pragma solidity with ^, >, <, ~ or a range, so the file builds with more than one compiler version |
| `missing-spdx` | info | high | - | no SPDX-License-Identifier comment in the file |
| `secret-in-source` | error | medium | - | a string or a comment shaped like a mnemonic, an extended private key, a private key in hex or a key in WIF |

A finding can have a level other than the one of its check: `delegatecall-use` is an error when the target is a parameter of the
function and info when the function has an access check; `selfdestruct-use` is info with an access check;
`unchecked-low-level-call` is info for the gas stipend of `transfer` and `send`; `state-change-no-access-check` is info for an
`initialize` function with no initializer modifier; `tx-origin-auth` is a warning when `tx.origin` is compared with
`msg.sender`. The OWASP item is named so that a reviewer can find the kind of weakness in the list; the check is a heuristic
of this tool and not a rule of OWASP.

## What is not checked

- Whether the code is correct. The tool has no idea what a contract is meant to do, so a function open on purpose is listed
  and a flaw in the logic is not.
- Anything that needs the compiler: types that are inferred, overloads, the real inheritance order, imports that rename or
  remap, the version of the compiler. Inheritance is resolved only by the name of the base contract among the files of the
  run; a base that is not in them is not seen, and two contracts of the same name in different files are both followed.
- A call through a variable whose type the tool cannot tell. A call through a variable of type `address` is seen for the
  low-level members; a call through a variable of a contract or interface type is seen when that type is declared in the files
  or is named like an interface (an `I` and a capital letter). A call through an unknown type is not seen.
- Writes the tool cannot trace: through a pointer it cannot follow, through a function of a contract at an address, through a
  library function that takes a storage pointer, through `delegatecall`, in a modifier.
- Price oracles, flash loans, integer arithmetic, signatures and replay, upgrade safety, front-running, gas griefing, and every
  weakness that is not one of the patterns above.
- Access control that is written some other way: a signature, a check in a base contract that is not in the files, a custom
  error raised by a function of another contract.
- Files that are not Solidity, and Solidity that the lexer or the parser does not follow; Yul is read only as a region in
  which a store, a `delegatecall` or a `selfdestruct` is found by name.

## Formats

`--format text` (the default) is for a terminal. `--format markdown` is for a job summary or a pull request and escapes what
markdown gives a meaning to. `--json` (or `--format json`) gives one object with the inputs, the files read, the totals, every
check with its number of findings, every finding with its id, level, confidence, file, line, column, message, fix, OWASP item
and subject, the notes and the result. `--format sarif` gives SARIF 2.1.0 for code scanning, with one result for each finding
and its file, line and column. `--list-checks` and `--explain` give text, markdown or JSON.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | no finding at or above the `--fail-on` level (default `error`) |
| `1` | a finding at or above the `--fail-on` level |
| `2` | a usage error, or a path the tool cannot read at all (no result) |

A finding below `--min-severity` is not shown but still counts for the result.

## Limits

A file is read whole, up to 16 MB and 2,000,000 tokens; all the files of a run together are read up to 256 MB and 3,000,000
tokens, and a file past that is a `file-unreadable` finding, not a skipped file. A walk reads at most 5,000 files and 200,000
directory entries, and a folder that went past that is a `file-unreadable` finding too. At most 1,000 findings of one check are
listed, and the rest are counted and noted. Inheritance is followed 64 contracts deep. [docs/limits.md](docs/limits.md) says what
the tool cannot see.

## Architecture

| File | What it does |
| --- | --- |
| `src/files.js` | the bounded reading of a file: a regular file, no link, UTF-8 or UTF-16 |
| `src/walk.js` | the files of a folder, found with a stack and bounded |
| `src/lexer.js` | the lexer: tokens with their line and column, assembly regions |
| `src/structure.js` | the table of matching brackets, contracts, state variables, functions and statements |
| `src/analyze.js` | the facts about each function, the facts passed along calls, and the checks |
| `src/rules.js`, `src/data.js` | the checks with their levels, fixes and reasons, and the notice |
| `src/secrets.js` | the search for private keys and seeds in strings and comments |
| `src/check.js`, `src/report.js`, `src/cli.js` | a run, the formats and the command line |
| `src/size.js`, `src/text.js` | numbers and lists as the reports show them, and text from the input made safe to print |

## Where the ideas come from

The patterns are the ones reviewers of smart contracts look for first and that can be found in the text: a function anyone can
call that changes state, a call whose result is dropped, an external call before a state write, `tx.origin` used to decide who is
calling, a `delegatecall` or `selfdestruct` that is reachable, randomness drawn from the block, and a loop over a list that
grows. [docs/context.md](docs/context.md) says how the names of the OWASP items are used and what the tool does not claim.

## Background

This tool is one of the small open source checks that INNERLUXES publishes next to its work on blockchain security. If you are
planning an audit of a smart contract, the page
[Smart Contract Audit Services for Blockchain Security](https://innerluxes.dev/blockchain/security/audit/smart-contract)
describes that work, and a run of this tool before the audit gives the reviewers a first list of places to look.

## License

MIT. See [LICENSE](LICENSE).
