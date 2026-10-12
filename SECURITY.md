# Security

## Reporting a problem

Write to info@innerluxes.dev with the subject line "solidity-risk-scan security", or use private vulnerability reporting on
this repository. Please do not open a public issue for a vulnerability.

Include a small made-up Solidity file that shows the problem, the command you ran, what you expected and what happened. Use
made-up contracts and names, never the code of a real project that is not yours to share, and never a real private key, seed or
mnemonic, even an old one or one from a test network.

## Scope

The tool is a pattern-based first pass over the text of Solidity files. It has false positives and false negatives, and it is
not an audit. In scope:

- an input that makes the tool show a private key, a seed or a mnemonic, or any part of one, in a report or an error message,
  in any format
- a key or a phrase in one of the shapes docs/limits.md names, in a string or a comment, that the tool does not report
- an input that makes the tool read a file other than the ones it was given or found in the folder it was given, or follow a
  symbolic link out of that folder
- an input that makes the tool open a network connection, fetch a URL, write a file, run any other program, compile or
  execute the code it reads, or evaluate anything it reads
- an input that makes the tool hang, take very long, exhaust the stack or use unbounded memory, such as a very large file, a
  million tokens, a hundred thousand nested braces, parentheses or brackets, a line or a string of millions of characters, a
  chain or a ring of a hundred thousand functions, a long line of inheritance, a base contract with a very large number of
  variables, a very large number of findings of one check, or a folder of very many files
- binary or invalid input that the tool reads as if it were Solidity, or a file the tool could not read that does not give a
  `file-unreadable` finding and does not fail the run
- a run that passes at a `--fail-on` level although the input holds a finding at that level that docs/method.md says is
  reported
- text from a file name that rewrites the terminal through control or direction characters, is shown unescaped in the output,
  or puts markup into the markdown report
- a name such as `__proto__` that changes how objects behave inside the tool

Out of scope: the forms docs/limits.md says the tool does not see, whether the code is safe (a clean result is not a finding that
it is), weaknesses the checks do not look for, who may change the files that are scanned, and where your pipeline keeps the
output.

Read [docs/threat-model.md](docs/threat-model.md) for the rest.
