// A run: find the files, read each one, lex and parse it, run the checks over all the parsed files together (a base contract
// may be in another file of the run), and build the report object that the formats write.

import { analyze } from './analyze.js';
import { ACCESS_MODIFIERS, LEVELS, NOTICE } from './data.js';
import { FILE_LIMITS, InputError, readInputText } from './files.js';
import { LEX_LIMITS, LexError, lex } from './lexer.js';
import { RULES, decide, ruleById } from './rules.js';
import { grouped } from './size.js';
import { safeText } from './text.js';
import { matchBrackets, parseFile } from './structure.js';
import { WALK_LIMITS, collectInputs } from './walk.js';

export const LIMITS = { ...FILE_LIMITS, ...LEX_LIMITS, maxTotalTokens: 3000000, maxTotalBytes: 256 * 1024 * 1024 };

export { InputError };

const clean = (t, max = 900) => safeText(t, max);

const ORDER = { error: 0, warning: 1, info: 2 };

// The number of lines: LF, CRLF and CR end a line, and text after the last line end is one more.
const lineCount = (text) => {
  let lines = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 13 && text.charCodeAt(i + 1) === 10) i += 1;
    if (c === 10 || c === 13) lines += 1;
  }
  const last = text.charCodeAt(text.length - 1);
  return text.length > 0 && last !== 10 && last !== 13 ? lines + 1 : lines;
};

// Reads the text of one file into a model, or says where it could not be followed. Returns { model } or { problem }.
export function prepare(file, text, limits = LIMITS) {
  let lexed;
  try {
    lexed = lex(text, limits);
  } catch (error) {
    if (!(error instanceof LexError)) throw error;
    return { problem: { line: error.line, column: error.column, message: `The file could not be followed: ${error.message}. Nothing in the file was checked.` } };
  }
  const { tokens, spdx, comments } = lexed;
  const { match, parent, problem } = matchBrackets(tokens);
  if (problem !== null) {
    const t = tokens[problem.index];
    return { problem: { line: t.line, column: t.col, message: `The file could not be followed: ${problem.message}. Nothing in the file was checked.` } };
  }
  const parsed = parseFile(tokens, match);
  return { model: { file, tokens, match, parent, parsed, spdx, comments, typeNames: parsed.typeNames, bytes: Buffer.byteLength(text), lines: lineCount(text) } };
}

// The report of the texts of files, with no file system. sources is [{ file, text }] or [{ file, error }] for a file that could
// not be read. Returns { files, findings, omitted, notes }.
export function checkSources(sources, { accessModifiers = ACCESS_MODIFIERS, limits = LIMITS } = {}) {
  const models = [];
  const files = [];
  const problems = [];
  let tokenBudget = limits.maxTotalTokens;
  for (const source of sources) {
    if (source.error !== undefined) {
      problems.push({ file: source.file, line: 1, column: 1, message: `The file was not read: ${source.error}. Nothing in the file was checked.` });
      files.push({ file: source.file, read: false, bytes: 0, lines: 0, tokens: 0, contracts: 0, functions: 0 });
      continue;
    }
    const r = prepare(source.file, source.text, { ...limits, maxTokens: Math.min(limits.maxTokens, tokenBudget) });
    if (r.problem !== undefined) {
      // the limit that was passed is the one of the whole run when the files read before this one used up the rest
      if (tokenBudget < limits.maxTokens && r.problem.message.includes('tokens')) r.problem.message = `The file was not read: the files read before it leave room for ${grouped(tokenBudget)} more tokens, and one run reads at most ${grouped(limits.maxTotalTokens)}. Nothing in the file was checked.`;
      problems.push({ file: source.file, ...r.problem });
      files.push({ file: source.file, read: false, bytes: Buffer.byteLength(source.text), lines: lineCount(source.text), tokens: 0, contracts: 0, functions: 0 });
      continue;
    }
    tokenBudget -= r.model.tokens.length;
    models.push(r.model);
    const parsed = r.model.parsed;
    files.push({ file: source.file, read: true, bytes: r.model.bytes, lines: r.model.lines, tokens: r.model.tokens.length, contracts: parsed.contracts.length, functions: parsed.contracts.reduce((n, c) => n + c.functions.length, parsed.freeFunctions.length) });
  }
  const { findings, omitted } = analyze(models, { accessModifiers });
  for (const p of problems) findings.push({ id: 'file-unreadable', file: p.file, line: p.line, column: p.column, message: p.message, subject: null, confidence: null, severity: null });
  return { files, findings, omitted, models };
}

// The report object for the findings of a run.
export function buildReport({ checked, notes = [], version, minSeverity = 'info', failOn = 'error', accessModifiers = ACCESS_MODIFIERS, includeTests = false, inputs = [] }) {
  const all = checked.findings.map((f) => {
    const rule = ruleById(f.id);
    const severity = f.severity ?? rule.severity;
    return {
      id: f.id,
      severity,
      confidence: f.confidence ?? rule.confidence,
      message: clean(f.message),
      file: f.file,
      line: f.line,
      column: f.column,
      at: `${f.file}:${f.line}:${f.column}`,
      subject: f.subject == null ? null : clean(f.subject, 120),
      owasp: rule.owasp,
      fix: rule.fix
    };
  });
  all.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.line - b.line || a.column - b.column || a.id.localeCompare(b.id, 'en'));
  const shown = all.filter((f) => LEVELS.indexOf(f.severity) >= LEVELS.indexOf(minSeverity));
  const extraOf = (rule) => checked.omitted.get(rule.id) ?? 0;
  const byLevel = { error: 0, warning: 0, info: 0 };
  const allByLevel = { error: 0, warning: 0, info: 0 };
  for (const f of all) allByLevel[f.severity] += 1;
  for (const f of shown) byLevel[f.severity] += 1;
  for (const rule of RULES) {
    allByLevel[rule.severity] += extraOf(rule);
    if (LEVELS.indexOf(rule.severity) >= LEVELS.indexOf(minSeverity)) byLevel[rule.severity] += extraOf(rule);
  }
  const total = (o) => o.error + o.warning + o.info;
  const out = [...notes];
  for (const [id, n] of checked.omitted) out.push(`${grouped(n)} more findings of ${id} are not listed; the first ${grouped(1000)} are`);
  const read = checked.files.filter((f) => f.read);
  const contractKinds = { contract: 0, interface: 0, library: 0 };
  for (const model of checked.models) for (const c of model.parsed.contracts) contractKinds[c.kind] += 1;
  return {
    tool: 'solidity-risk-scan',
    version,
    inputs,
    files: checked.files.map((f) => ({ file: f.file, read: f.read, bytes: f.bytes, lines: f.lines, contracts: f.contracts, functions: f.functions })),
    summary: {
      files: checked.files.length,
      read: read.length,
      notRead: checked.files.length - read.length,
      contracts: contractKinds.contract,
      interfaces: contractKinds.interface,
      libraries: contractKinds.library,
      functions: read.reduce((n, f) => n + f.functions, 0),
      lines: read.reduce((n, f) => n + f.lines, 0)
    },
    totals: { findings: total(byLevel), byLevel, hidden: total(allByLevel) - total(byLevel) },
    rules: RULES.map((r) => ({ id: r.id, level: r.severity, confidence: r.confidence, owasp: r.owasp, findings: shown.filter((f) => f.id === r.id).length + (LEVELS.indexOf(r.severity) >= LEVELS.indexOf(minSeverity) ? extraOf(r) : 0) })),
    options: { minSeverity, failOn, accessModifiers, includeTests },
    findings: shown,
    notes: out.map((n) => clean(n)),
    notice: NOTICE,
    result: decide(allByLevel, failOn)
  };
}

// Finds the files, reads them and builds the report.
export async function scanPaths({ paths, minSeverity = 'info', failOn = 'error', accessModifiers = ACCESS_MODIFIERS, includeTests = false, version, limits = LIMITS, walk = WALK_LIMITS, base = process.cwd() }) {
  const found = await collectInputs(paths, base, { includeTests, limits: walk });
  if (found.files.length === 0) throw new InputError([`no Solidity file was found in ${paths.length === 1 ? 'the path' : 'the paths'} given${includeTests ? '' : ' (folders named node_modules, lib, .git, test and tests and files ending in .t.sol are left out; --include-tests puts the tests back)'}`]);
  const sources = [];
  let total = 0;
  for (const f of found.files) {
    if (total > limits.maxTotalBytes) {
      sources.push({ file: f.shown, error: `the files read so far hold more than ${grouped(limits.maxTotalBytes)} bytes, the limit of one run` });
      continue;
    }
    try {
      const { text, bytes } = await readInputText(f.absolute, base, limits);
      total += bytes;
      sources.push({ file: f.shown, text });
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      sources.push({ file: f.shown, error: error.problems.map((p) => p.replace(`${f.shown}: `, '')).join('; ') });
    }
  }
  const checked = checkSources(sources, { accessModifiers, limits });
  for (const folder of found.truncated) checked.findings.push({ id: 'file-unreadable', file: folder, line: 1, column: 1, message: `The folder holds more than ${grouped(walk.maxFiles)} Solidity files or ${grouped(walk.maxEntries)} entries; the first ones found were read and the rest were not. Nothing in the rest was checked.`, subject: null, confidence: null, severity: null });
  return buildReport({ checked, notes: found.notes, version, minSeverity, failOn, accessModifiers, includeTests, inputs: paths.map((p) => safeText(p, 300)) });
}
