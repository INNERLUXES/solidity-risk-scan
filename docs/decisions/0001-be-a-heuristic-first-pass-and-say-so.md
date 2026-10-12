# 1. Be a heuristic first pass, and say so everywhere

## Status

Accepted

## Context

A tool that reads Solidity and prints findings invites two readings. One is that a run with no findings means the contract is
safe. The other is that a list of findings is a list of vulnerabilities. Both are wrong for a tool that works on the text of
the files. It does not compile the code, it does not know what a contract is meant to do, and it looks for a handful of
patterns that reviewers check first. A check of who calls cannot tell a function that is open on purpose from one that is open
by mistake. A check of the order of a call and a write cannot know that the callee is trusted.

The names of the items of the OWASP Smart Contract Top 10 are a convenient way to say which kind of weakness a pattern relates
to. Using them also risks saying more than the tool can: that a check is a rule of OWASP, or that a clean run covers an item.

## Decision

1. Every check is a heuristic of this tool. The README, the usage text, the output of `--list-checks`, the explanation of each
   check, the notice at the end of every report and the documents say so in plain words, and say that the tool has false
   positives and false negatives, points a reviewer at places to look, and is not an audit.
2. Every check has a level and a confidence. The confidence is the check's own estimate from the form that matched; it is not a
   probability and is not called one. A finding may carry a level or a confidence other than the usual one of its check, and
   its message says why.
3. A check carries the name of the OWASP item it relates to, by name only. The name is a label for the kind of weakness. It is
   not a claim that the check covers the item, that OWASP wrote or endorsed the check, or that the absence of findings clears
   the item. The year or the edition of the list is not printed anywhere, because the list changes.
4. Every check says in its text what it cannot see (`cannot` in `src/rules.js`, `--explain`, docs/method.md, docs/limits.md).
5. A clean report is worded as "no finding at or above the level", never as "safe", "secure" or "passed".

## Consequences

- The README is longer than a tool of this size needs, and says what it cannot do before it says what it can.
- A reviewer who wants a verdict will not find one. The tool gives a first list, and a person audits.
- A check can be added only with its `cannot` text, a place in docs/method.md, and tests with a near miss on each side.
