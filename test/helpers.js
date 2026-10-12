// Shared test helpers: Solidity written inline and checked in memory, or written into a temporary folder that is removed
// after the test. Paths are built with resolve() from forward-slash names, so the same test runs on Linux, macOS and
// Windows. A line a test expects is found with lineOf(), which counts lines the way the reader does, so a test never holds a
// line number worked out by hand for one system only. No test reads the clock, the time zone or the locale. Every contract,
// name and address is made up.

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { checkSources, main } from '../src/index.js';

export async function withFiles(files, fn) {
  const dir = await mkdtemp(resolve(tmpdir(), 'solidity-risk-scan-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(dirname(resolve(dir, rel)), { recursive: true });
      await writeFile(resolve(dir, rel), content);
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// The line (from 1) of the n-th place where needle starts in text.
export function lineOf(text, needle, n = 1) {
  let at = -1;
  for (let i = 0; i < n; i += 1) {
    at = text.indexOf(needle, at + 1);
    if (at < 0) throw new Error(`${needle} is not in the text ${n} times`);
  }
  return text.slice(0, at).split('\n').length;
}

// The column (from 1) of the n-th place where needle starts in text.
export function columnOf(text, needle, n = 1) {
  let at = -1;
  for (let i = 0; i < n; i += 1) {
    at = text.indexOf(needle, at + 1);
    if (at < 0) throw new Error(`${needle} is not in the text ${n} times`);
  }
  return at - text.lastIndexOf('\n', at - 1);
}

export const HEAD = '// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\n';

// A file with the license line and a pinned pragma in front of the body, so a test sees only the finding it is about.
export const sol = (body) => `${HEAD}${body}\n`;

// A contract with these members.
export const contract = (members, header = 'contract C') => sol(`${header} {\n${members}\n}`);

// The findings of the texts of files, [{ file, text }] or one text.
export function scan(input, options = {}) {
  const sources = typeof input === 'string' ? [{ file: 'C.sol', text: input }] : input;
  return checkSources(sources, options).findings;
}

// The ids of the findings of a text.
export const idsOf = (input, options) => scan(input, options).map((f) => f.id);

// The findings of one check.
export const ofCheck = (input, id, options) => scan(input, options).filter((f) => f.id === id);

// The findings of one check in a contract with these members, as 'id' or 'id:severity:confidence' strings when asked.
export const inContract = (members, id, options) => ofCheck(contract(members), id, options);

// Runs the command line with exactly these arguments, in a folder.
export async function cli(argv, base) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => { err += t; } }, undefined, base);
  return { code, out, err };
}

// Writes the files and runs the command line in the folder.
export async function run(files, args) {
  return withFiles(files, (dir) => cli(args, dir));
}

// A clean file and one with a mistake, for the command line tests.
export const GOOD = { 'Good.sol': contract('    uint256 private value;\n    address public owner;\n    modifier onlyOwner() { require(msg.sender == owner, "no"); _; }\n    function set(uint256 v) external onlyOwner { value = v; }') };
export const BAD = { 'Bad.sol': contract('    address public owner;\n    function setOwner(address a) public { owner = a; }\n    function isOwner() external view returns (bool) { return tx.origin == owner; }') };
// A file with a warning and no error: it passes at the default level and fails at --fail-on warning.
export const WARN = { 'Bad.sol': contract('    address public owner;\n    function setOwner(address a) public { owner = a; }') };
export const ARGS = ['.'];

// The time a hostile test may take: four times as long when the runner collects coverage, which sets NODE_V8_COVERAGE.
export const allowed = (ms) => (process.env.NODE_V8_COVERAGE ? ms * 4 : ms);
