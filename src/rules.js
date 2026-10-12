// The checks. Each one has an id, a level (the level of a finding may differ from it where the check says so), a confidence,
// the name of the item of the OWASP Smart Contract Top 10 it relates to (or null), what it looks at, what to change, why the
// check exists and what it cannot see. Every check is a heuristic of this tool: none is a rule of OWASP, and none is a proof
// that a contract is safe or unsafe.

import { LEVELS } from './data.js';

export const RULES = [
  {
    id: 'file-unreadable',
    severity: 'error',
    confidence: 'high',
    owasp: null,
    summary: 'a file the tool could not read or follow (not UTF-8, too large, a comment or string never closed, a character Solidity does not use, brackets that do not match, too many tokens), so nothing in it was checked',
    fix: 'Fix the file or leave it out of the scan; a file that is not read is not a file that is fine.',
    own: 'A run must never pass because something could not be read. A file the lexer cannot follow is reported with the line and column where it stopped, and the checks do not run on it.',
    cannot: 'It says where the reader stopped, not what the compiler would say: a file can be accepted by this reader and refused by a compiler, and the other way round.'
  },
  {
    id: 'state-change-no-access-check',
    severity: 'warning',
    confidence: 'medium',
    owasp: 'Access Control Vulnerabilities',
    summary: 'a public or external function that is not view or pure and writes a state variable, or calls selfdestruct or delegatecall, with no access modifier from the list and no comparison of msg.sender in its body',
    fix: 'Ask who should be able to call the function. Add an access modifier or a check of msg.sender, or make the function internal; if it is open on purpose, say so in a comment for the reviewer.',
    own: 'A function anyone can call that changes the state of the contract is the first place a reviewer looks. The tool cannot know who is meant to call it, so it lists the functions that have no sign of a check.',
    cannot: 'It does not know the intent. A function open on purpose (a deposit, a vote) is listed; a check written some other way (a call to an internal function that reverts, a signature, a check in a base contract it cannot find) is not seen. A function that writes only entries of mappings or arrays indexed by msg.sender is taken as acting on the caller\'s own entry and is not listed. Writes through a pointer it cannot trace, or through a function of another file, are not seen.'
  },
  {
    id: 'unchecked-low-level-call',
    severity: 'error',
    confidence: 'high',
    owasp: 'Unchecked External Calls',
    summary: 'a low-level call, delegatecall, staticcall or send whose bool result is not used; also a note on transfer and send, which pass a fixed gas stipend',
    fix: 'Use the bool the call returns (require it, or branch on it), or use a library call that reverts for you. Do not rely on transfer or send to be enough gas for a recipient that is a contract.',
    own: 'A low-level call does not revert when the callee fails; it returns false. If the code goes on as if the call worked, a failed payment is treated as paid.',
    cannot: 'It looks at the statement the call is in. A result stored in a variable that is never read is seen only for a bool named in a tuple; a result passed on through another variable is taken as used.'
  },
  {
    id: 'call-before-state-write',
    severity: 'warning',
    confidence: 'medium',
    owasp: 'Reentrancy Attacks',
    summary: 'in one function, an external call (a low-level call, transfer, send, a call through an address or contract variable, safeTransfer) comes before a write to a state variable, and the function has no nonReentrant modifier',
    fix: 'Write the state first and make the external call last (checks, effects, interactions), or guard the function with a reentrancy lock.',
    own: 'If the callee can call back before the state is updated, it sees the old state. The pattern of a call followed by a write is where that happens.',
    cannot: 'It follows the order of the text of one function and the internal functions it calls by name. It does not know that a callee is trusted, that a call cannot call back, or that a lock exists in another form. Calls through variables whose type it cannot tell are not seen.'
  },
  {
    id: 'tx-origin-auth',
    severity: 'error',
    confidence: 'high',
    owasp: 'Access Control Vulnerabilities',
    summary: 'tx.origin used in a comparison, a require, an assert, an if or a while',
    fix: 'Use msg.sender to know who called. tx.origin is the account that started the transaction, not the contract that called this one, so a contract the owner calls can act as the owner.',
    own: 'tx.origin used for authorisation can be borrowed by any contract the real user is tricked into calling.',
    cannot: 'A comparison of tx.origin with msg.sender is a common way to keep contracts out and is listed with low confidence. Other uses of tx.origin that are not a condition are not listed.'
  },
  {
    id: 'delegatecall-use',
    severity: 'warning',
    confidence: 'medium',
    owasp: 'Unchecked External Calls',
    summary: 'delegatecall, which runs code of another contract with the storage of this one; an error when the target is a parameter of the function, info when the function has an access check',
    fix: 'Make sure the target cannot be chosen by a caller, that its storage layout fits this contract, and that only a trusted role can reach the call.',
    own: 'delegatecall gives the target full control of this contract\'s storage and balance.',
    cannot: 'It does not know where the target comes from beyond a parameter of the same function, and it cannot judge a proxy pattern that is built correctly.'
  },
  {
    id: 'selfdestruct-use',
    severity: 'warning',
    confidence: 'medium',
    owasp: 'Access Control Vulnerabilities',
    summary: 'selfdestruct (or suicide), which removes the code of the contract and sends its balance away; info when the function has an access check',
    fix: 'Make sure only a trusted role can reach it, and check whether the behaviour you rely on is the same on the chains and compiler versions you target.',
    own: 'A reachable selfdestruct can end the contract or send its balance to someone else.',
    cannot: 'It does not know who can reach the function when the check is written in a form it does not recognise.'
  },
  {
    id: 'block-randomness',
    severity: 'warning',
    confidence: 'medium',
    owasp: 'Insecure Randomness',
    summary: 'block.timestamp, block.number, block.prevrandao, block.difficulty or blockhash used inside keccak256, sha256 or abi.encode, or in a statement with %',
    fix: 'Do not draw anything of value from block values: a validator or a caller who can wait for the right block can pick the result. Use a source of randomness built for it.',
    own: 'Values of the block are known to the one who builds the block, and to a contract that calls in the same block.',
    cannot: 'A block value used with % for a period or a bucket of time is listed too, with low confidence. A value passed through a variable first is not seen.'
  },
  {
    id: 'unbounded-loop',
    severity: 'warning',
    confidence: 'medium',
    owasp: 'Denial of Service (DoS) Attacks',
    summary: 'a for or while loop whose condition compares with the length of a state array',
    fix: 'Bound the work of one call: process a range, keep a cursor in storage, or let each user pull what is theirs instead of pushing to everyone.',
    own: 'An array that anyone can make longer can make a loop over it cost more gas than a block holds, and then the function can never succeed.',
    cannot: 'It does not know whether the array can grow without limit; an array only the owner fills, with a known maximum, is listed too. A bound that comes from a local variable is followed only when the variable is set from the length in its declaration.'
  },
  {
    id: 'floating-pragma',
    severity: 'info',
    confidence: 'high',
    owasp: null,
    summary: 'pragma solidity with ^, >, <, ~ or a range, so the file builds with more than one compiler version',
    fix: 'Pin the version you test and deploy with, such as pragma solidity 0.8.24, for contracts that are deployed. A library may keep a range on purpose.',
    own: 'A contract compiled with a version it was not tested with can behave differently.',
    cannot: 'It reads the text of the pragma and does not know which version your build uses.'
  },
  {
    id: 'missing-spdx',
    severity: 'info',
    confidence: 'high',
    owasp: null,
    summary: 'no SPDX-License-Identifier comment in the file',
    fix: 'Add a line such as // SPDX-License-Identifier: MIT at the top of the file, with the license you use.',
    own: 'The compiler warns about it, and a file with no license line is hard to reuse and to publish.',
    cannot: 'It does not check that the identifier is valid.'
  },
  {
    id: 'secret-in-source',
    severity: 'error',
    confidence: 'medium',
    owasp: null,
    summary: 'a string or a comment shaped like a mnemonic, an extended private key, a private key in hex or a key in WIF',
    fix: 'Remove it from the file and from the history of the repository, and treat the key as exposed. The tool does not show the value.',
    own: 'A key in a source file is public once the file is. The tool never reads a key and never prints one.',
    cannot: 'The shapes are loose on purpose, so a value that is not a key can be listed. A number written in hex in code, and a hex string written as hex"...", are not looked at, because a hash constant has the same shape as a key.'
  }
];

export const ruleById = (id) => RULES.find((r) => r.id === id);

export const atOrAbove = (level, floor) => LEVELS.indexOf(level) >= LEVELS.indexOf(floor);

// The result of a run: pass unless a finding is at or above the fail-on level.
export function decide(byLevel, failOn) {
  const failing = LEVELS.filter((l) => atOrAbove(l, failOn)).reduce((n, l) => n + (byLevel[l] ?? 0), 0);
  const total = LEVELS.reduce((n, l) => n + (byLevel[l] ?? 0), 0);
  const parts = ['error', 'warning', 'info'].filter((l) => byLevel[l]).map((l) => `${byLevel[l]} ${l}`);
  const detail = parts.length ? ` (${parts.join(', ')})` : '';
  if (failing > 0) return { pass: false, failOn, text: `FAIL - ${failing} ${failing === 1 ? 'finding' : 'findings'} at or above ${failOn}${detail}` };
  return { pass: true, failOn, text: `PASS - no finding at or above ${failOn}${total ? detail : ''}` };
}
