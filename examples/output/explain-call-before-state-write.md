# call-before-state-write

- Level: warning
- Confidence: medium
- Relates to: Reentrancy Attacks

**What it looks at.** in one function, an external call \(a low-level call, transfer, send, a call through an address or contract variable, safeTransfer\) comes before a write to a state variable, and the function has no nonReentrant modifier

**Why it exists.** If the callee can call back before the state is updated, it sees the old state. The pattern of a call followed by a write is where that happens.

**What to change.** Write the state first and make the external call last \(checks, effects, interactions\), or guard the function with a reentrancy lock.

**What it cannot see.** It follows the order of the text of one function and the internal functions it calls by name. It does not know that a callee is trusted, that a call cannot call back, or that a lock exists in another form. Calls through variables whose type it cannot tell are not seen.

This check is a heuristic of this tool; it is not a rule of OWASP and it is not proof that the code is safe or unsafe.
