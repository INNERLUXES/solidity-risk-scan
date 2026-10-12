# 4. Walk folders and tokens without recursion, and bound the work

## Status

Accepted

## Context

A file in a pull request is enough to attack a tool that scans it. A hundred thousand opening braces, parentheses or brackets
run out the stack of a parser that recurses. A line of millions of characters, a string of millions of characters and an
identifier of a million characters are slow for code that copies. A chain of a hundred thousand functions that call the next
one, or a ring of them, run out the stack of a check that follows calls by calling itself. A base contract of a hundred
thousand variables with a thousand children is quadratic for a check that copies the variables to each child. A folder of a
million files is slow for a walk that reads them all.

## Decision

1. Nothing recurses on the shape of the input. The lexer is one loop. Brackets are matched with a stack of indexes in one pass,
   and every later walk over tokens jumps over a bracket pair through the match table. Statements are found in one pass.
2. Facts about functions (writes state, makes an external call, reaches `selfdestruct`) are passed along calls with a worklist:
   each function is queued again only when something about it changed, and there are only a few facts, so each function is
   visited a small number of times, and a ring of functions ends.
3. Inheritance is followed by name to a depth of 64 contracts, and a lookup walks that chain; the variables of a base are never
   copied to a child.
4. Folders are walked with a stack of the tool's own, to 64 folders deep, 5,000 files and 200,000 entries. Entries are sorted
   by name, so the order and the set of files read do not depend on the system.
5. A file is read whole up to 16 MB and 2,000,000 tokens; the files of a run are read up to 256 MB and 3,000,000 tokens.
   Anything past a limit is a `file-unreadable` finding, so a run never passes on part of its input without saying so.
6. At most 1,000 findings of one check are listed; the rest are counted and noted. A block value is searched for a hash up to 64
   brackets out.
7. Hostile tests build every shape above and check the time, with limits that widen under coverage only.

## Consequences

- A very deep input costs time in proportion to its size and no stack.
- The limits are visible in the README and in docs/limits.md, and a run that meets one says so.
- A project of more than 5,000 Solidity files has to be scanned in parts.
