# Threat model

solidity-risk-scan is a pattern-based first pass over the text of Solidity files. It is not an audit. This document is about
the tool itself: what it touches, what a hostile or careless file can try, and what stops it.

## What the tool touches

- It reads the files and folders named on the command line, and the Solidity files found by walking a folder. It does not read
  a file for any other reason: no import named in a file is opened, no path written in a string or a comment is followed.
- It writes the report to standard output and its errors to standard error. It writes nothing to disk.
- It opens no network connection, fetches no URL, runs no program, evaluates nothing it reads, follows no symbolic link out of
  the folder it was given, reads no clock and no locale, and never compiles or executes the code it reads.

## What the input may hold

The files come from a repository, a pull request or a contractor. In a pipeline that scans every pull request, whoever sent the
code wrote the files. Through them, a person can try to, or a careless change can:

- put a private key or a mnemonic in a string or a comment, so that the tool copies it into a pipeline log, a pull request
  comment or a code scanning upload;
- make the tool read outside the folder: a symbolic link out of the folder, a link in a link, a path with `..`, a device, a
  pipe, a very deep folder;
- exhaust the memory, the stack or the time: a file of many megabytes, a million tokens, a hundred thousand nested braces,
  parentheses or brackets, one line of millions of characters, a string of millions of characters, an identifier of a million
  characters, a chain of a hundred thousand functions that call each other, a ring of them, twenty thousand contracts in one
  line of inheritance, a base contract of a hundred thousand variables with a thousand children, a hundred thousand findings of
  one check, a folder of more files than the limit;
- slip in something that is not text: a compiled file with a `.sol` name, bytes that are not valid UTF-8 or UTF-16;
- make the tool pass on a file it could not read: a comment or a string never closed, brackets that do not match, a character
  that is not Solidity, a file over a limit;
- rewrite the terminal or break the output: control characters, escape sequences and direction controls in a file name;
- hide markup in the markdown report: a link, a table separator or a tag in a file name;
- change how objects behave: a contract, a function, a variable or a modifier named `__proto__`, `constructor` or `toString`;
- make a check pass by writing a word: a comment that says a function is guarded, a modifier named like one on the list that
  does not check anything (the list is the names, and this is a limit that docs/limits.md names).

## What could go wrong, and what stops it

| Risk | Control |
| --- | --- |
| A secret in a file is copied into the output | Strings and comments are looked at for a mnemonic, an extended private key, a key in hex and a key in WIF; each one found is a `secret-in-source` error, and no message names the value. Tests put each shape in a string and a comment and check every format for the value |
| A link makes the tool read a file it was not given | A path given on the command line is checked with `lstat` and a link is refused by name. In a walk, a link is followed only to a file whose real path is inside the folder given, a link out of it is refused, and a link to a folder is not followed. A file is opened with `O_NOFOLLOW` where the system has it, and its type and size are taken from the open handle. Tests put links in the folder |
| The tool reaches a server, fetches, connects or runs something | No module of the network or of child processes is imported, nothing is evaluated, an import path is only text, and a path that looks like an address is refused. A test checks the imports of src |
| The memory, the stack or the time is exhausted | The file has a size limit checked on the open handle before it is read; the lexer has a limit of tokens and works through one loop; brackets are matched with a stack of indexes; every walk over tokens jumps over a bracket pair through the match table; facts about functions are passed along calls with a worklist; bases are followed to a depth of 64; folders are walked with a stack, to a depth and a number of files that are bounded; at most 1,000 findings of one check are listed. Tests check the time of every shape above, with limits that widen under coverage only |
| A file that could not be read passes | A file that is not text, is too large, is not followed by the lexer, has brackets that do not match, or is past a limit of the run is a `file-unreadable` error, and a walk that went past its limit is one too. A path that gives no Solidity file is an input error with exit code `2` |
| A check is made to quote the input | A message holds names of functions, variables and files, which went through `safeText` or are identifiers of the lexer; a string or a comment is never quoted |
| Text from a file name rewrites the terminal | Every text from the input goes through `safeText`, which replaces control, line separator and direction characters and caps the length. A test puts a direction control in a file name, in every format |
| Markup in a file name changes the markdown report | The markdown report escapes the characters markdown gives a meaning to. A test writes brackets and parentheses into a file name |
| `__proto__` changes how objects behave | Names of the files are kept in `Map` and `Set` objects and compared with the names the tool reads; no object is built with a key from a file. A test uses `__proto__`, `constructor` and `toString` as contracts, functions, variables and modifiers |
| The time of the run changes the result | No clock is read, so the same files and options give the same report on every day |
| A device or a pipe hangs the tool | A path that is not a regular file is refused before it is read |
| The tool leaves files behind | Nothing is written to disk; there is no cache, no temporary file and no log. A test checks that a run leaves the folder as it was |

## Out of scope

Whether the code is safe, the weaknesses that the checks do not look for (docs/limits.md names them), who may change the files
that are scanned, and where your pipeline keeps the output. A reviewer who relies on a clean report has misread this tool.
