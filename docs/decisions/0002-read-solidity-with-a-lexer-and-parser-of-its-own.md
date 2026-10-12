# 2. Read Solidity with a lexer and a light parser of its own

## Status

Accepted

## Context

The checks need to know where a function starts and ends, which variables are state, which modifiers a function has, and the
order of the statements in a body. A full parser, or the compiler, would give all of that and more. It would also be a
dependency, would need the right version of the compiler for each file, and would refuse files that do not compile, which are
the files a first pass is most useful on: code in the middle of a change, code with an import that is not in the folder, code
written for an older compiler.

A pattern search over lines of text would be easy and would be wrong in all the ways that matter: a comment holds the word
`selfdestruct`, a string holds `tx.origin`, a block of call options `{value: x}` is read as the start of a block.

## Decision

1. The tool has a lexer of its own (`src/lexer.js`). It is strict: comments, strings (including `unicode"..."` and
   `hex"..."`), numbers, identifiers, punctuation and assembly regions are read, and the first thing it cannot follow ends the
   file with a `file-unreadable` error that has the line and column. Nothing in such a file is checked, and the run fails.
2. A light parser (`src/structure.js`) finds the contracts, interfaces and libraries, their bases, state variables, modifiers
   and functions, and splits a body into statements. It does not build a tree of expressions. The checks look at tokens around
   the place they care about.
3. The parser never throws on input that is not well formed. It returns less. Brackets that do not match are the one thing it
   refuses, because every jump in the checks depends on them.
4. Inheritance is resolved by the name of the base contract among the files of the run. This is stated in the README and in
   docs/limits.md, and is the reason the tool takes several paths in one run.
5. Types are the first word of a declaration. A type that is not declared in the files is an interface when it is written like
   one. This is a guess, it is documented as one, and a wrong guess makes a finding appear or go away, never an error.

## Consequences

- The tool reads files the compiler would refuse, and may read as sound a file the compiler would reject.
- Checks that need a type system (overloads, inferred types, the real order of inheritance) are not possible, and are listed
  as limits.
- The lexer and the parser are small enough to read in an afternoon, and the tests build every shape they accept.
