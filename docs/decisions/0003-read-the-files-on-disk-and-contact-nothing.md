# 3. Read the files on disk, run nothing, and contact nothing

## Status

Accepted

## Context

A Solidity project is a folder of files that import each other, build with a toolchain that downloads a compiler, and are
tested by running them. A check could install the dependencies, compile the contracts, run the tests, fork a chain, call a
block explorer for the code of an address in a comment, or ask a service for known issues. That would need the network and
often a key, would make the result depend on the state of other people's services, would run code from a pull request on the
machine of the pipeline, and would send unpublished contracts to a third party.

What a team needs first, before an audit, is a list of places to look in the code it has, from the code alone.

## Decision

1. The tool reads the files it is given and the Solidity files in the folders it is given, and nothing else. It does not open
   an import, follow a path written in a string, install anything, compile, run or test the code, or contact anything over the
   network. It needs no key and sends no data anywhere. It writes nothing to disk.
2. The checks work from the text alone. They see the files of the run, and docs/limits.md says that the rest of a project is
   not seen.
3. The tool reads no clock, no locale and no environment variable, so the same files and options give the same output on every
   machine and every day.
4. The tool follows no symbolic link out of the folder it was asked to walk, opens files with `O_NOFOLLOW` where the system has
   it, and checks the type and the size of a file from the open handle.
5. The tool lists what to look at and what to change. It changes nothing and sends nothing.

## Consequences

- A run needs no network access and no secret.
- A project whose dependencies are left out of the run (`lib` and `node_modules` are not walked) is seen without them. The
  base contracts it imports are not known unless their folder is given.
- Names written in a string or a comment are never looked up.
