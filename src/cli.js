// Command line: solidity-risk-scan <path...> [options]

import { readFileSync } from 'node:fs';
import { InputError, LIMITS, scanPaths } from './check.js';
import { ACCESS_MODIFIERS, LEVELS } from './data.js';
import { explainJson, explainMarkdown, explainText, listChecksJson, listChecksMarkdown, listChecksText, toJson, toMarkdown, toSarif, toText } from './report.js';
import { RULES, ruleById } from './rules.js';
import { safeText } from './text.js';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const FORMATS = { text: toText, markdown: toMarkdown, json: toJson, sarif: toSarif };
const LISTS = { text: listChecksText, markdown: listChecksMarkdown, json: listChecksJson };
const EXPLAINS = { text: explainText, markdown: explainMarkdown, json: explainJson };

export const USAGE = `Usage: solidity-risk-scan <path...> [options]

A first pass over Solidity code that can be run before an audit. It reads .sol files (or the .sol files in folders) and lists,
with the file, line and column, functions that change state with no access check, low-level calls whose result is ignored,
external calls made before state is updated, tx.origin checks, delegatecall and selfdestruct, randomness taken from block
values, loops over the length of a state array, and a few notes on the pragma and the license line. It points a reviewer at
places to look. Every check is a heuristic of this tool over the text of the files, with false positives and false
negatives; none is a rule of OWASP, and the tool is not an audit. It does not compile or run the code, contacts nothing over
the network, reads no clock and writes nothing to disk.

Options:
  --format <name>             text, markdown, json or sarif (default: text)
  --json                      the same as --format json
  --min-severity <level>      the lowest level of a finding that is shown: ${LEVELS.join(', ')} (default: info)
  --fail-on <level>           the lowest level of a finding that fails the run: ${LEVELS.join(', ')} (default: error)
  --access-modifiers <list>   the modifiers that count as a check of who calls, separated by commas
                              (default: ${ACCESS_MODIFIERS.join(',')})
  --include-tests             also read folders named test and tests and files that end in .t.sol
  --list-checks               list the checks with their level, confidence and OWASP item, and exit
  --explain <id>              explain one check: what it looks at, what to change, what it cannot see, and exit
  --help                      show this text
  --version                   show the version

Folders named node_modules, lib and .git are always left out of a folder that is walked. A file named on the command line is
always read.

Checks: ${RULES.map((r) => r.id).join(', ')}.

Exit codes: 0 no finding at or above the fail-on level, 1 a finding at or above it, 2 usage or input error.
`;

const isUrl = (f) => /^[a-z][a-z0-9+.-]*:\/\//i.test(f);
const NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
export const MAX_MODIFIERS = 50;

// The list given to --access-modifiers: names of modifiers separated by commas.
export function readModifierList(text) {
  const names = text.split(',').map((s) => s.trim());
  if (names.length === 0 || names.some((n) => n === '')) throw new Error('--access-modifiers: give names separated by commas, with none empty');
  if (names.length > MAX_MODIFIERS) throw new Error(`--access-modifiers: give at most ${MAX_MODIFIERS} names`);
  for (const n of names) if (!NAME.test(n) || n.length > 100) throw new Error(`--access-modifiers: "${safeText(n, 40)}" is not the name of a modifier`);
  return [...new Set(names)];
}

// The check whose id is nearest to the text, for a message about a misspelt id.
function nearestId(text) {
  const distance = (a, b) => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      let diagonal = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const above = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
        diagonal = above;
      }
    }
    return row[b.length];
  };
  let best = null;
  let bestDistance = Infinity;
  for (const r of RULES) {
    const d = distance(text.toLowerCase(), r.id);
    if (d < bestDistance) {
      best = r.id;
      bestDistance = d;
    }
  }
  return bestDistance <= 6 ? best : null;
}

export function parseArgs(argv) {
  const o = { paths: [], format: null, json: false, minSeverity: null, failOn: null, accessModifiers: null, includeTests: false, listChecks: false, explain: null, help: false, version: false };
  const once = (name, current, value) => {
    if (current !== null) throw new Error(`${name} was given twice`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || (v.startsWith('--') && v.length > 2)) throw new Error(`${a} needs a value`);
      if (v === '-') throw new Error('reading from standard input is not supported; give a file or a folder');
      i += 1;
      return v;
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--json') o.json = true;
    else if (a === '--include-tests') {
      if (o.includeTests) throw new Error('--include-tests was given twice');
      o.includeTests = true;
    } else if (a === '--list-checks') o.listChecks = true;
    else if (a === '--format') o.format = once(a, o.format, next());
    else if (a === '--min-severity') o.minSeverity = once(a, o.minSeverity, next());
    else if (a === '--fail-on') o.failOn = once(a, o.failOn, next());
    else if (a === '--access-modifiers') o.accessModifiers = once(a, o.accessModifiers, next());
    else if (a === '--explain') o.explain = once(a, o.explain, next());
    else if (a === '-') throw new Error('reading from standard input is not supported; give a file or a folder');
    else if (a.startsWith('-')) throw new Error(`unknown argument ${a}`);
    else o.paths.push(a);
  }
  if (o.json) {
    if (o.format !== null && o.format !== 'json') throw new Error(`--json and --format ${o.format} ask for two formats; give one`);
    o.format = 'json';
  }
  if (o.format === null) o.format = 'text';
  if (!Object.hasOwn(FORMATS, o.format)) throw new Error(`unknown format ${o.format} (text, markdown, json or sarif)`);
  for (const [flag, v] of [['--min-severity', o.minSeverity], ['--fail-on', o.failOn]]) if (v !== null && !LEVELS.includes(v)) throw new Error(`${flag}: unknown level ${v} (${LEVELS.join(', ')})`);
  if (o.accessModifiers !== null) o.modifierList = readModifierList(o.accessModifiers);
  if (o.explain !== null && ruleById(o.explain) === undefined) {
    const near = nearestId(o.explain);
    throw new Error(`--explain: unknown check ${safeText(o.explain, 60)}${near ? `. Did you mean ${near}?` : ''} (--list-checks lists them)`);
  }
  if ((o.listChecks || o.explain !== null) && o.format === 'sarif') throw new Error(`${o.listChecks ? '--list-checks' : '--explain'} has no SARIF form; use text, markdown or json`);
  if (!o.help && !o.version && !o.listChecks && o.explain === null) {
    if (o.paths.length === 0) throw new Error('give at least one .sol file or folder, such as solidity-risk-scan contracts');
    for (const p of o.paths) if (isUrl(p)) throw new Error('give a local path; the tool never fetches a URL');
  }
  return o;
}

const clean = (text) => safeText(text, 1500);

// Exit code: 0 no finding at or above the fail-on level, 1 a finding at or above it, 2 usage or input error.
export async function main(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }, limits = undefined, base = process.cwd()) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (error) {
    io.err(`solidity-risk-scan: ${clean(error.message)}\n\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    io.out(USAGE);
    return 0;
  }
  if (o.version) {
    io.out(`${VERSION}\n`);
    return 0;
  }
  if (o.listChecks) {
    io.out(LISTS[o.format]());
    return 0;
  }
  if (o.explain !== null) {
    io.out(EXPLAINS[o.format](ruleById(o.explain)));
    return 0;
  }
  const merged = { ...LIMITS, ...(limits ?? {}) };
  try {
    const report = await scanPaths({ paths: o.paths, minSeverity: o.minSeverity ?? 'info', failOn: o.failOn ?? 'error', accessModifiers: o.modifierList ?? ACCESS_MODIFIERS, includeTests: o.includeTests, version: VERSION, limits: merged, base });
    io.out(FORMATS[o.format](report));
    return report.result.pass ? 0 : 1;
  } catch (error) {
    if (error instanceof InputError) io.err(`solidity-risk-scan: no result, the input has ${error.problems.length === 1 ? 'a problem' : 'problems'}:\n${error.problems.map((p) => `  ${clean(p)}`).join('\n')}\n`);
    else io.err(`solidity-risk-scan: ${clean(error.message)}\n`);
    return 2;
  }
}
