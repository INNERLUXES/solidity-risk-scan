# Context

solidity-risk-scan is a pattern-based first pass over the text of Solidity files. It points a reviewer at places to look; it is
not an audit. This document says where the idea of the tool sits, and how it uses the names of the OWASP Smart Contract Top 10.
It quotes no list and no rule, and it does not say that code that passes meets any of them.

## Why a first pass before an audit

An audit is done by people who read the code with the specification in mind. Before they start, there is a set of patterns that
can be found without any of that: a function that changes state and has no check of who calls, a call whose result is dropped, a
call made before the state is written, `tx.origin` used to decide who is calling, a reachable `delegatecall` or `selfdestruct`,
randomness drawn from the block, and a loop over a list that grows. These are cheap to find, cheap to fix before the audit, and
they are the first places a reviewer would look. A run of this tool gives the reviewers that list, and takes up less of their
time than finding them by reading.

The tool reads the text of the files and nothing else. It is not a replacement for the compiler, for a test suite, for a
fuzzer, for a formal tool, or for a person.

## The names of OWASP items

Each check carries the name of the item of the OWASP Smart Contract Top 10 that its pattern relates to:

| Check | OWASP item |
| --- | --- |
| `state-change-no-access-check` | Access Control Vulnerabilities |
| `tx-origin-auth` | Access Control Vulnerabilities |
| `selfdestruct-use` | Access Control Vulnerabilities |
| `unchecked-low-level-call` | Unchecked External Calls |
| `delegatecall-use` | Unchecked External Calls |
| `call-before-state-write` | Reentrancy Attacks |
| `block-randomness` | Insecure Randomness |
| `unbounded-loop` | Denial of Service (DoS) Attacks |

The other checks (`floating-pragma`, `missing-spdx`, `secret-in-source`, `file-unreadable`) relate to no item.

The name is there so that a reviewer can find the kind of weakness in the list and read about it. It is a label for the kind of
weakness, nothing more:

- Every check is a heuristic of this tool. None is a rule of OWASP, and OWASP did not write, review or endorse any of them.
- A finding is not a statement that the item applies to the code, and the absence of findings is not a statement that it does
  not. The items are broader than the patterns: Access Control Vulnerabilities cover much more than a missing modifier.
- The tool does not print the date or the edition of the list. The list changes, and the names of its items may change with
  it; the labels of the tool are kept as they are until a release changes them.

## What the tool does not claim

- That a clean run is a sign the code is safe or has been reviewed.
- That a finding is a vulnerability. A finding is a place to look.
- That the tool covers any list, standard or framework. It covers the twelve checks it has, and `--list-checks` lists them.
- That its confidence is a probability.
