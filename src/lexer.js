// A small, strict lexer for Solidity. It turns the text of one file into tokens and stops at the first thing it cannot
// follow, with its line and column. It reads comments, strings (including unicode"" and hex"" strings), numbers,
// identifiers and punctuation, and it marks the tokens of an assembly block as a region. It works through one loop with an
// index: no recursion, no pattern built from the input, and a limit on the number of tokens.
//
// Token kinds: 'id' identifier or keyword, 'num' number, 'str' string, 'pun' punctuation, 'pragma' the raw text of a pragma
// between the word pragma and its semicolon. A token holds its kind k, its text v, its line and its column (from 1, in
// UTF-16 units). A string token also holds n (the length of the whole string) and pre ('', 'unicode' or 'hex'), and v is the
// body of the string cut at 4,001 characters. A token inside an assembly block has asm set; the opening brace of the block
// has close, the index of the closing brace.

import { grouped } from './size.js';

export const LEX_LIMITS = { maxTokens: 2000000 };

export class LexError extends Error {
  constructor(message, line, column) {
    super(message);
    this.name = 'LexError';
    this.line = line;
    this.column = column;
  }
}

const OPS4 = new Set(['>>>=']);
const OPS3 = new Set(['<<=', '>>=', '>>>', '**=']);
const OPS2 = new Set(['=>', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '|=', '&=', '^=', '<<', '>>', '**', '->', ':=']);
const OPS1 = new Set(['{', '}', '(', ')', '[', ']', ';', ',', '.', ':', '?', '~', '!', '+', '-', '*', '/', '%', '<', '>', '=', '&', '|', '^']);

const isDigit = (c) => c >= 48 && c <= 57;
const isIdStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36;
const isIdPart = (c) => isIdStart(c) || isDigit(c);
const isHex = (c) => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);

// The longest piece of a comment or string kept for the search for secrets.
export const KEEP_MAX = 4000;
const SPDX = 'SPDX-License-Identifier:';
const PRAGMA_WORDS = new Set(['solidity', 'experimental', 'abicoder']);
const PRAGMA_MAX = 500;

// Returns { tokens, spdx, comments }. comments holds the text of every comment between 47 and 4,000 characters, for the
// search for secrets. Throws LexError.
export function lex(src, limits = LEX_LIMITS) {
  const tokens = [];
  const comments = [];
  const n = src.length;
  let spdx = false;
  let i = 0;
  let line = 1;
  let lineStart = 0;
  // 0: outside assembly, 1: after the word assembly and before its brace, 2: inside the block
  let asm = 0;
  let asmDepth = 0;
  let asmOpen = -1;

  const push = (k, v, at, atLine, atStart, extra) => {
    if (tokens.length >= limits.maxTokens) throw new LexError(`the file holds more than ${grouped(limits.maxTokens)} tokens`, atLine, at - atStart + 1);
    const t = { k, v, line: atLine, col: at - atStart + 1 };
    if (extra) Object.assign(t, extra);
    if (asm === 2) t.asm = true;
    tokens.push(t);
    return t;
  };

  // Moves past a line end at i (LF, CRLF or CR).
  const newline = () => {
    if (src.charCodeAt(i) === 13 && src.charCodeAt(i + 1) === 10) i += 1;
    i += 1;
    line += 1;
    lineStart = i;
  };

  const readString = (quote, start, startLine, startCol) => {
    let j = start + 1;
    for (;;) {
      if (j >= n) throw new LexError('a string is never closed; the file ends inside it', startLine, startCol);
      const c = src.charCodeAt(j);
      if (c === quote) break;
      if (c === 10 || c === 13) throw new LexError('a string is never closed; the line ends inside it', startLine, startCol);
      if (c === 92) {
        const d = src.charCodeAt(j + 1);
        if (d === 10 || d === 13) {
          // a backslash before a line end continues the string on the next line
          i = j + 1;
          newline();
          j = i;
          continue;
        }
        j += 2;
        continue;
      }
      j += 1;
    }
    return j;
  };

  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 10 || c === 13) {
      newline();
      continue;
    }
    if (c === 32 || c === 9 || c === 11 || c === 12) {
      i += 1;
      continue;
    }
    const col0 = i - lineStart + 1;
    // comments
    if (c === 47) {
      const d = src.charCodeAt(i + 1);
      if (d === 47) {
        let j = i + 2;
        while (j < n) {
          const e = src.charCodeAt(j);
          if (e === 10 || e === 13) break;
          j += 1;
        }
        const text = src.slice(i + 2, j);
        if (!spdx && text.includes(SPDX)) spdx = true;
        if (text.length >= 47 && text.length <= KEEP_MAX) comments.push({ line, column: col0, text });
        i = j;
        continue;
      }
      if (d === 42) {
        const end = src.indexOf('*/', i + 2);
        if (end < 0) throw new LexError('a comment is never closed; the file ends inside it', line, col0);
        const text = src.slice(i + 2, end);
        if (!spdx && text.length < 100000 && text.includes(SPDX)) spdx = true;
        if (text.length >= 47 && text.length <= KEEP_MAX) comments.push({ line, column: col0, text });
        i += 2;
        while (i < end) {
          const e = src.charCodeAt(i);
          if (e === 10 || e === 13) newline();
          else i += 1;
        }
        i = end + 2;
        continue;
      }
    }
    // strings
    if (c === 34 || c === 39) {
      const startLine = line;
      const startLineStart = lineStart;
      const j = readString(c, i, line, col0);
      const body = src.slice(i + 1, Math.min(j, i + 1 + KEEP_MAX + 1));
      push('str', body, i, startLine, startLineStart, { n: j - i - 1, pre: '' });
      i = j + 1;
      continue;
    }
    // numbers
    if (isDigit(c) || (c === 46 && isDigit(src.charCodeAt(i + 1)) && !(tokens.length > 0 && (tokens.at(-1).k === 'id' || tokens.at(-1).k === 'num' || tokens.at(-1).v === ')' || tokens.at(-1).v === ']')))) {
      let j = i;
      if (c === 48 && (src.charCodeAt(i + 1) === 120 || src.charCodeAt(i + 1) === 88)) {
        j = i + 2;
        while (j < n && (isHex(src.charCodeAt(j)) || src.charCodeAt(j) === 95)) j += 1;
      } else {
        while (j < n && (isDigit(src.charCodeAt(j)) || src.charCodeAt(j) === 95)) j += 1;
        if (src.charCodeAt(j) === 46 && isDigit(src.charCodeAt(j + 1))) {
          j += 1;
          while (j < n && (isDigit(src.charCodeAt(j)) || src.charCodeAt(j) === 95)) j += 1;
        }
        const e = src.charCodeAt(j);
        if (e === 101 || e === 69) {
          let k = j + 1;
          if (src.charCodeAt(k) === 43 || src.charCodeAt(k) === 45) k += 1;
          if (isDigit(src.charCodeAt(k))) {
            while (k < n && (isDigit(src.charCodeAt(k)) || src.charCodeAt(k) === 95)) k += 1;
            j = k;
          }
        }
      }
      push('num', src.slice(i, j), i, line, lineStart);
      if (asm === 1) asm = 0;
      i = j;
      continue;
    }
    // identifiers and keywords
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdPart(src.charCodeAt(j))) j += 1;
      const word = src.slice(i, j);
      const q = src.charCodeAt(j);
      if ((word === 'unicode' || word === 'hex') && (q === 34 || q === 39)) {
        const startLine = line;
        const startLineStart = lineStart;
        const end = readString(q, j, line, col0);
        const body = src.slice(j + 1, Math.min(end, j + 1 + KEEP_MAX + 1));
        push('str', body, i, startLine, startLineStart, { n: end - j - 1, pre: word });
        i = end + 1;
        continue;
      }
      const prev = tokens.length > 0 ? tokens.at(-1) : null;
      if (word === 'pragma' && !(prev && prev.v === '.')) {
        // a pragma is read as raw text up to its semicolon: its version numbers are not Solidity numbers
        let k = j;
        while (k < n && (src.charCodeAt(k) === 32 || src.charCodeAt(k) === 9)) k += 1;
        let m = k;
        while (m < n && isIdPart(src.charCodeAt(m))) m += 1;
        if (m > k && PRAGMA_WORDS.has(src.slice(k, m))) {
          const startLine = line;
          const end = src.indexOf(';', k);
          if (end < 0 || end - k > PRAGMA_MAX) throw new LexError('a pragma is never ended with a semicolon', line, col0);
          const raw = src.slice(k, end);
          if (raw.includes('/*') || raw.includes('//')) throw new LexError('a pragma holds a comment before its semicolon', line, col0);
          push('id', word, i, startLine, lineStart);
          const rawCol = k - lineStart + 1;
          const textToken = { k: 'pragma', v: raw.trim(), line, col: rawCol };
          tokens.push(textToken);
          for (let p = k; p < end; p += 1) {
            const e = src.charCodeAt(p);
            if (e === 10 || e === 13) {
              if (e === 13 && src.charCodeAt(p + 1) === 10) p += 1;
              line += 1;
              lineStart = p + 1;
            }
          }
          push('pun', ';', end, line, lineStart);
          i = end + 1;
          continue;
        }
      }
      push('id', word, i, line, lineStart);
      if (asm === 0 && word === 'assembly') asm = 1;
      else if (asm === 1 && word !== 'assembly') asm = 0;
      i = j;
      continue;
    }
    // punctuation
    let op = null;
    const four = src.slice(i, i + 4);
    if (OPS4.has(four)) op = four;
    else {
      const three = four.slice(0, 3);
      if (OPS3.has(three)) op = three;
      else {
        const two = four.slice(0, 2);
        if (OPS2.has(two)) op = two;
        else if (OPS1.has(four[0])) op = four[0];
      }
    }
    if (op === null) {
      const shown = c < 32 || c > 126 ? `U+${c.toString(16).toUpperCase().padStart(4, '0')}` : `"${src[i]}"`;
      throw new LexError(`the character ${shown} is not part of Solidity outside a string or a comment`, line, col0);
    }
    const t = push('pun', op, i, line, lineStart);
    if (asm === 1) {
      if (op === '{') {
        asm = 2;
        asmDepth = 1;
        asmOpen = tokens.length - 1;
        t.asm = true;
      } else if (op !== '(' && op !== ')') asm = 0;
    } else if (asm === 2) {
      if (op === '{') asmDepth += 1;
      else if (op === '}') {
        asmDepth -= 1;
        if (asmDepth === 0) {
          tokens[asmOpen].close = tokens.length - 1;
          asm = 0;
        }
      }
    }
    i += op.length;
  }
  return { tokens, spdx, comments };
}
