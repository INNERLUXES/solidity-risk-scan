// What every report says about itself. Every check of this tool is a heuristic over the text of the files: none is a rule of
// OWASP, and the reports and the documents say so. The name of an OWASP item is used only to say which kind of weakness a
// check relates to.

export const LEVELS = ['info', 'warning', 'error'];

export const CONFIDENCES = ['low', 'medium', 'high'];

export const NOT_A = 'a pattern-based first pass over the text of Solidity files; it points a reviewer at places to look and it is not an audit';

export const NOTICE = 'This report is a heuristic first pass over the text of the files. It points a reviewer at places to look; it is not an audit, it does not compile or run the code, and a clean report does not mean the code is safe.';

// Why a check is a heuristic and not a rule.
export const HEURISTIC = 'a heuristic of this tool; it is not a rule of OWASP and it is not proof that the code is safe or unsafe';

// What the name of an OWASP item means in a report.
export const OWASP_NOTE = 'item of the OWASP Smart Contract Top 10 that the check relates to, by name only';

// The modifiers that count as a check of who calls, when --access-modifiers is not given. whenNotPaused is not one: it stops
// everyone alike and says nothing about who may call.
export const ACCESS_MODIFIERS = ['onlyOwner', 'onlyRole', 'onlyAdmin', 'auth', 'requiresAuth'];

// The modifiers that count as a lock against reentrancy.
export const LOCK_MODIFIERS = ['nonReentrant', 'noReentrancy', 'noReentrant', 'nonreentrant'];

// The modifiers that count as the guard of an initializer.
export const INIT_MODIFIERS = ['initializer', 'reinitializer', 'onlyInitializing'];
