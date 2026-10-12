# Secure defaults

The default run is the safe run. Nothing in the first section needs a flag, and none of it can be switched off. The rest of the
document is about what the tool cannot do for you: which files you give it, where the output goes, and who may change the files
it reads. A clean result is a set of files with none of the patterns the checks look for, not a finding that the code is safe:
solidity-risk-scan is a pattern-based first pass over the text, and it is not an audit.

## How the tool behaves by default

- **Never a secret.** The tool needs no private key, no seed, no API key and no address of a server, and has no option to take
  one. A string or a comment shaped like a mnemonic, a private key in hex, an extended private key or a key in WIF is a
  `secret-in-source` error that fails the run; the value is never written to a report or an error message, in any format.
- **Reads, never writes, never runs the code.** The tool reads the files it is given. It does not compile them, run them,
  fetch what they import, follow a symbolic link out of a folder, fetch a URL (an argument that looks like an address is
  refused), contact anything over the network, evaluate anything, run a program or write anything to disk.
- **Every check on from the first run.** Errors are a dropped result of a low-level call, `tx.origin` used in a condition,
  `delegatecall` on an address the caller gives, a key in a string, and a file that could not be read; warnings are a
  state change with no check of the caller, an external call before a state write, `delegatecall` and `selfdestruct` with no
  check, randomness from the block, and a loop over a state array; notes are the pragma, the license line, the gas stipend and
  an initializer with no guard. There is no configuration file of the tool that could set a check off. The one list that can be
  changed, `--access-modifiers`, names what counts as a check of who calls, and the report prints the list in use.
- **Fail closed on what it cannot read.** A file that is not text, is too large, has a comment or a string never closed, has
  brackets that do not match or is past a limit is a `file-unreadable` error that fails the run at the default `--fail-on` of
  `error`, and a folder that holds more files than the limit is one too. A path that does not exist, a link and a folder with
  no Solidity file in it stop the run with exit code `2` and no report.
- **Unknown arguments are errors.** An option the tool does not know, a value that looks like an option, a path that looks
  like a URL and an option given twice stop the run, so a typo such as `--fail-no` cannot leave a default in place.
- **No pattern from the input.** No regular expression is built from a file or from an argument.
- **Bounded work.** The lexer, the parser and the checks work through loops, stacks and worklists with limits of size, tokens,
  files, depth and findings (docs/limits.md), so a large file, a deep nesting or a long chain of functions cannot exhaust the
  stack, the memory or the time.
- **No prototype tricks.** Names from the files are kept in maps and sets and compared with the names the tool reads, never set
  as properties of an object, so `__proto__` is only a name.
- **Clean output.** Text from the input, file names included, has control characters, line separators and direction controls
  replaced and its length capped before it reaches a report or an error message; the markdown report also escapes what
  markdown gives a meaning to.
- **The same input gives the same output.** No clock, no zone, no locale and no random number.
- **No dependencies.** Node 22 or newer and nothing else.

## Settings that make the check stricter

- **`--fail-on warning`.** A state change with no check of the caller, an external call before a state write and the other
  warnings fail the run too. Use it on the contracts that are about to be deployed, and record each warning the team keeps on
  purpose.
- **`--fail-on info`.** The pragma, the license line, the gas stipend and an initializer with no guard fail the run too.
- **`--access-modifiers`.** Name the modifiers your code uses for a check of who calls, so that they count. A modifier of the
  scanned files that compares `msg.sender` counts without being named.
- **`--include-tests`.** Reads the folders `test` and `tests` and the files ending in `.t.sol` too. They are left out by default
  because test helpers are open on purpose.
- **Whole projects.** Give the folder of the contracts, and the folder of a base contract that lives in another place, in one
  run, so that the checks can resolve a base contract by name.

## Running it in a pipeline

```yaml
permissions:
  contents: read
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
    with:
      node-version: 22
  - name: Solidity risk scan
    run: npx --yes github:INNERLUXES/solidity-risk-scan contracts --format markdown >> "$GITHUB_STEP_SUMMARY"
```

- Give the job read access to the contents and nothing more. The tool needs no secret, no API key and no access to a server;
  never give it one.
- Pin every action to a full commit, as above, and pin the tool to a release commit or a tag you have read, because `npx`
  runs what it downloads.
- Do not hide the exit code with a trailing `|| true`. To keep the report without failing, keep `--fail-on` at `error` and
  keep the SARIF or JSON report as an artifact of the job.
- Treat a report built from files you do not trust as untrusted data. A finding quotes the names of functions and variables.
- Keep unpublished contracts out of public repositories, and keep the reports with the same care, because a finding quotes names
  and places in the code.
- If the tool ever reports `secret-in-source`, treat the key or phrase as exposed: remove it from the file and from the history
  of the repository, and move what it controls to a new key. The tool does not show the value, but the file itself was readable
  to everyone with access to it.
- Do not read a clean run as a finding that the code is safe. Have the contracts audited by people.

## SSDF

The repository is checked against NIST SP 800-218 (SSDF) in its own pipeline and before every release, with
`ssdf-repo-check` pinned to its release commit. The evidence it looks for is in these files:

| Practice | Evidence in this repository |
| --- | --- |
| PO.1 Define security requirements | CONTRIBUTING.md, docs/secure-defaults.md |
| PO.2 Roles and responsibilities | .github/CODEOWNERS |
| PO.3 Toolchain | .github/workflows/ci.yml, codeql.yml, release.yml |
| PO.4 Criteria for security checks | CodeQL with the security-extended queries, the SSDF gate in ci.yml and release.yml |
| PO.5 Secure environments | a `permissions:` block in every workflow, actions pinned to commits |
| PS.1 Protect the code | .gitignore for keys and `.env`, `npm run check` for committed secrets |
| PS.2 Integrity of releases | SHA-256 checksums and a build provenance attestation in release.yml |
| PS.3 Archive and provenance | a CycloneDX SBOM and the CHANGELOG with every release |
| PW.1 Design for security | docs/threat-model.md |
| PW.2 Review the design | docs/decisions |
| PW.4 Reuse secure components | no runtime dependencies, a lock file, Dependabot |
| PW.5 Secure coding | CONTRIBUTING.md, `npm run check` |
| PW.6 Build settings | `npm ci` from the lock file |
| PW.7 Code review | the pull request template and CODEOWNERS |
| PW.8 Testing | `npm test` on Linux, Windows and macOS with Node 22 and 24, `npm run test:coverage`, hostile input tests |
| PW.9 Secure defaults | this document |
| RV.1 Find vulnerabilities | SECURITY.md, Dependabot |
| RV.2 Respond to vulnerabilities | SECURITY.md |
