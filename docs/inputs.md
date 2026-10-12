# Inputs

solidity-risk-scan is a pattern-based first pass over the text of Solidity files. It points a reviewer at places to look; it is
not an audit. This document says which files it reads, how it reads them and what it understands of the language.

## Paths

The command takes one or more paths. A path is a file or a folder.

- A **file** is read whatever its name is, so a file with another ending is read as Solidity. A path that is a symbolic link, a
  device or a pipe is refused with exit code `2` and no report.
- A **folder** is walked with a stack of the tool's own, in the order of the names. Only files that end in `.sol` (in any case)
  are taken. The folders `node_modules`, `lib` and `.git` are always left out. The folders `test` and `tests` and the files
  that end in `.t.sol` are left out unless `--include-tests` is given. A folder named on the command line is walked even if it
  is called `lib` or `test`; the rule is about the folders found inside it.
- A symbolic link found inside a folder is followed only when it points at a file whose real path is inside the folder that
  was given. The file is then read once, under its own name when it is also found that way. A link to a place outside the
  folder is refused, and a link to a folder is not followed; each is a note in the report.
- A path that does not exist is an error with exit code `2` and no report, and so is a path that gives no Solidity file.

The walk reads at most 5,000 files and 200,000 directory entries and goes at most 64 folders deep. If a folder holds more, the
first files found (in the order of the names) are read and the report has a `file-unreadable` finding for the folder, so a run
never passes on part of a folder without saying so.

## Encoding

A file is read as UTF-8 (a byte order mark is dropped) or as UTF-16 with a byte order mark, up to 16 MB. A file that holds a
null byte, is not valid UTF-8, has an odd number of bytes in UTF-16, or is larger than the limit is a `file-unreadable`
finding at line 1, column 1, and the other files are still read. LF, CRLF and CR line ends give the same findings at the same
line and column.

## What the lexer reads

The lexer is strict and small. It reads line comments and block comments (and looks in them for the SPDX line and for text
shaped like a key), strings with single or double quotes and escapes, `unicode"..."` and `hex"..."` strings, numbers (decimal
with underscores, fractions, exponents and hex), identifiers and keywords, and the punctuation and operators of Solidity,
longest first. A pragma is read as raw text up to its semicolon, because its version numbers are not Solidity numbers.

An assembly block (`assembly { ... }`, with or without a dialect string and flags such as `("memory-safe")`) is marked as a
region. The parser skips over it, and the checks look inside it only for a store to storage (`sstore`), `delegatecall` and
`selfdestruct`.

It stops, with the line and column, at a comment or a string that is never closed, a character that Solidity does not use
outside a string or a comment (a letter with an accent in a name, `@`, a backtick), a pragma with no semicolon or with a
comment in it, and a file of more than 2,000,000 tokens. Brackets that do not match are found right after, and are reported at
the bracket. A file the reader stops at is a `file-unreadable` error, and nothing in it is checked.

## What the parser finds

- `contract`, `abstract contract`, `interface` and `library`, with the names after `is`.
- State variables: the name, whether it is a mapping, a dynamic array (`T[]`, or `bytes`), a constant or an immutable, and the
  first word of its type (`address`, an elementary type, or the name of a type).
- `function`, `constructor`, `receive`, `fallback` (also the unnamed function of old code) and `modifier`: the name, the
  visibility, the mutability, the modifiers applied (with or without arguments), the parameters and return values, `virtual`,
  `override`, and the range of the body in tokens. Free functions at the top of a file are read too.
- Events, errors, `using` lines, structs, enums, user defined value types and imports are skipped; the names of structs, enums
  and value types are kept, so that a variable of such a type is not taken for a contract.
- The statements of a body: simple statements up to their semicolon, the heads of `if`, `for` and `while` with their
  condition, `try`, and assembly blocks. A block is not a statement of its own.

It does not build a syntax tree of expressions. The checks look at tokens around the places they care about, and use the table
of matching brackets to jump over a bracket pair, so nesting of any depth costs time in proportion to size.

## A short file

This file passes every check at every level. It has a license line and a pinned pragma, an access modifier on the function that
sets the owner, and a function that writes only the entry of the caller.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract Notes {
    address public owner;
    mapping(address => uint256) public points;

    modifier onlyOwner() {
        require(msg.sender == owner, "not the owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setOwner(address next) external onlyOwner {
        owner = next;
    }

    function addPoint() external {
        points[msg.sender] += 1;
    }
}
```
