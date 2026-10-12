# Changes

## 1.0.0

First release.

- Reads Solidity files, or the Solidity files in folders, and lists with the file, line and column where a pattern of its checks
  is found in the text. The tool is a pattern-based first pass with false positives and false negatives; it points a reviewer
  at places to look and it is not an audit. It reads the files, contacts nothing over the network, fetches nothing, runs
  nothing, compiles nothing, needs no key, follows no symbolic link out of a folder, reads no clock and writes nothing to disk.
- A strict lexer of its own, with no dependency and no recursion: comments, strings (including `unicode"..."` and `hex"..."`),
  numbers, identifiers, punctuation and assembly blocks as regions, with the line and column of every token, a limit of
  tokens, and a pragma read as raw text. The bounded reading of a file, the search for keys and seeds, and the helpers of the
  sibling tools are kept unchanged.
- A light parser of its own: a table of matching brackets built with a stack of indexes, contracts, interfaces and libraries
  with their bases, state variables, modifiers, functions (name, visibility, mutability, modifiers applied, body range),
  free functions, and the statements of a body. Inheritance is resolved by the name of the base contract among the files of
  the run.
- Twelve checks, each with a level, a confidence, the name of the OWASP Smart Contract Top 10 item it relates to (by name only;
  every check is a heuristic of this tool and none is a rule of OWASP), what to change, why it exists and what it cannot see:
  `state-change-no-access-check`, `unchecked-low-level-call`, `call-before-state-write`, `tx-origin-auth`,
  `delegatecall-use`, `selfdestruct-use`, `block-randomness`, `unbounded-loop`, `floating-pragma`, `missing-spdx`,
  `secret-in-source` and `file-unreadable`.
- Facts about functions (writes state, makes an external call, reaches `selfdestruct` or `delegatecall`) are passed along the
  calls between functions by name with a worklist and no recursion.
- A walk of folders with a stack of the tool's own, bounded in depth, files and entries; `node_modules`, `lib` and `.git` are
  always left out, `test`, `tests` and `*.t.sol` unless `--include-tests` is given; a symbolic link out of the folder is refused.
  A file or a folder past a limit is a `file-unreadable` finding.
- Reports as text, markdown, JSON and SARIF 2.1.0 with file, line and column; `--min-severity`, `--fail-on`,
  `--access-modifiers`, `--include-tests`, `--list-checks` and `--explain <id>`. Exit code `0` when no finding is at or above
  the fail-on level, `1` when one is, `2` for a usage or input error, with no result.
- Made-up examples: a folder of contracts that passes at every level and a folder with a mistake of every check but
  `file-unreadable`, with their real output in all formats, the list of checks and the explanation of a check.
- Release packages come with a CycloneDX SBOM, SHA-256 checksums and a build provenance attestation, after the SSDF gate of
  the repository.
