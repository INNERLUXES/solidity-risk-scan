# Contributing

Every change goes through a pull request and is reviewed before it is merged. The pipeline runs the tests on Linux, Windows
and macOS with Node 22 and 24, the tests with coverage, the repository checks, CodeQL, and a secure development check of the
repository itself.

Commit messages in this repository follow Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`, with `!`
for a breaking change.

This tool reads the text of Solidity files and runs nothing. It is a pattern-based first pass with false positives and false
negatives, it points a reviewer at places to look, and it is not an audit. A change must keep it that way: a check reports
what the text holds, and the tool never contacts anything over the network, never compiles, runs or executes the code it
reads, never writes anything, and never fetches, opens or evaluates what a file imports.

## Never a secret, never real code

The tool never asks for a private key, a seed or an API key, and never looks up a contract, an address or a name. Do not add an
option or a test that gives it one. A test of the search for secrets builds its values from repeated characters (see
test/secrets.test.js), so that no file of the repository holds anything that could be a real key or seed. Never paste code that
is not yours to share, a key or a seed into an issue, a pull request or an example; use made-up contracts and names.

## Never a claim of safety, never a made-up rule

Every check is a heuristic of this tool, and says so in `own` and `cannot` in src/rules.js. None is a rule of OWASP. A check
names the OWASP item it relates to, by name only, in `owasp`; the year or the edition of that list is never printed. Do not
write a message, a document or an example that reads as a statement that code is safe, secure, audited or reviewed, that a
check covers an item of any list, or that OWASP or anyone else made, reviewed or approved the tool. A clean report is
worded as "no finding at or above the level".

## Changing a check

1. Describe the change in docs/method.md first: what the check looks at and what it can and cannot see, and add what it cannot
   see to docs/limits.md. Say in `own` and `cannot` in src/rules.js that it is a heuristic, and why the tool asks for it.
2. Keep the checks to what is written. A finding must point at something a reader can check in the file: a line and a column.
   Never add a check that needs the network, the compiler, a key or the clock.
3. A check says what to change, in `fix` in src/rules.js, and names its OWASP item or none in `owasp`.
4. A run must never pass because something could not be read: a file the lexer cannot follow, a file that is not text and a
   folder past a limit are `file-unreadable` findings.
5. Add a test with the Solidity written inline (`contract()`, `sol()`, `scan()`, `ofCheck()`, `run()` and `cli()` in
   test/helpers.js), small enough to work out by hand, with a near miss on each side: the form that is reported and the one
   next to it that is not.
6. A check id, once released, keeps its meaning: pipelines and other tools read it from the JSON, SARIF and markdown output.

## Changing the reader

1. The lexer (src/lexer.js) keeps its limit of tokens (`LEX_LIMITS`) and works through one loop; it has no recursion, and
   neither has the parser (src/structure.js), the checks (src/analyze.js), the walk of folders (src/walk.js) or the search for
   secrets (src/secrets.js). src/files.js, src/secrets.js, src/size.js and src/text.js are kept as they are in the sibling
   tools.
2. A walk over tokens jumps over a bracket pair through the match table. Do not scan the tokens inside a pair again for each
   token that is inside it: that is quadratic for input such as `a[a[a[a[...`. Use the table of senders (`sendersIn()`) or
   a loop that touches each token once.
3. Facts about functions are passed along calls with a worklist (`propagate()` in src/analyze.js). Do not follow calls by
   calling a function from itself.
4. Inheritance is followed by name through `chainOf()`, to `CHAIN_MAX` contracts, and looked up by walking that chain. Do not
   copy the variables or functions of a base into a child.
5. No pattern is built from a file or an argument. A test fails when `new RegExp` appears in src outside src/text.js.
6. A time check in a test widens under coverage: read `process.env.NODE_V8_COVERAGE`, which the test runner sets only when
   coverage is on, and allow four times the time (`allowed()` in test/helpers.js). Run `npm run test:coverage` before you open
   the pull request.
7. A file written with LF, CRLF or CR line ends, as UTF-8 with or without a byte order mark or as UTF-16 with one, must give
   the same findings at the same lines and columns.

## The examples

The files under `examples/` are made-up input for the tool: a folder of contracts that passes at error, warning and info
level, and a folder that holds a mistake of every check but `file-unreadable`, with made-up contracts and names, no key, and
no real phrase. A change to them goes with the real output that `npm run example` writes to `examples/output`.

## Tests that depend on the system

A test that depends on the operating system (a symbolic link, a device) is guarded with `process.platform` and says why in its
`skip`. A test never asserts a line number written by hand: a line is worked out with `lineOf()` of test/helpers.js or from the
text itself. Every other test builds its paths with `resolve()` from names with forward slashes, and a test never writes a
backslash, a bar, a star, a question mark or a quote into a file name, because Windows refuses them.

A test never reads the clock, the time zone of the machine or the locale.

## Rules for the code

- No runtime dependencies and no development dependencies. Node 22 or newer and nothing else; the tests use `node:test`.
- The tool reads the files it is given and writes only to standard output and standard error. It opens no network connection,
  signs nothing, runs no program and evaluates nothing it reads.
- Text from the input, file names included, goes through `safeText` before it reaches the output or an error message.
- Source files stay ASCII; write any other character as a Unicode escape, or build it from its code point.
- No file carries a date in its prose, and no file holds a number that reads like a year. Version numbers (Node 22, 0.8.24),
  counts, seconds and the number of a standard (SARIF 2.1.0, NIST SP 800-218) are fine.
- Examples and tests use made-up contracts, names and addresses.
- Plain words in the documents: `npm run check` fails on a short list of words that say little.

## Before you open the pull request

```
npm test
npm run test:coverage
npm run check
npm run example
```
