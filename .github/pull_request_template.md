## What changes

<!-- One or two sentences. -->

## Checks

- [ ] `npm test`, `npm run test:coverage`, `npm run check` and `npm run example` pass, and the files under `examples/output` are the ones `npm run example` wrote
- [ ] A change to a check is described in docs/method.md, says what it can and cannot see, and has a test with the Solidity written inline and a near miss on each side
- [ ] A change to what the tool cannot see is in docs/limits.md
- [ ] A check is still a heuristic of the tool and says so in its `own` and `cannot` text; nothing in the change claims that it is a rule of OWASP, that OWASP made or endorsed it, or that it covers an item of any list
- [ ] Nothing in the change, the README or the output reads as a statement that code is safe, secure, audited or reviewed, and a clean report is still worded as "no finding at or above the level"
- [ ] The tool still reads the text of the files and nothing else: it compiles nothing, runs nothing, contacts nothing over the network and writes nothing to disk
- [ ] The tool still never reads or asks for a private key, a seed or an API key, a value that looks like one is still a `secret-in-source` finding, and no report or error message shows such a value
- [ ] A file the lexer cannot follow, a file that is not text and a folder past a limit are still `file-unreadable` findings, and a check never takes a part it did not read for one that is fine
- [ ] The lexer, the parser, the walk of folders and the checks still do not recurse, tokens inside a bracket pair are not scanned again for each token inside it, and facts about functions are still passed along calls with a worklist
- [ ] No pattern is built from a file or from an argument
- [ ] Text from the input goes through `safeText` before it reaches the output or an error message, and the markdown format escapes what markdown gives a meaning to
- [ ] The tool still reads no clock and no locale, follows no symbolic link out of the folder it was given, and the work stays bounded: the limits of docs/limits.md hold, and a hostile test has a time check that widens under coverage through `NODE_V8_COVERAGE`
- [ ] A test that depends on the operating system (a link, a device) is guarded with `process.platform`, asserts no line of its own, and builds its paths with `resolve()` from forward-slash names
- [ ] The examples stay made up and minimal: no real contract, address or project, no key, no phrase of a wallet, no date and no number that reads like a year
- [ ] The commit messages of this pull request follow Conventional Commits
