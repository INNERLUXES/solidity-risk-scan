// The reports: text for a terminal, markdown for a job summary or a pull request, JSON for other tools and SARIF for code
// scanning. Every text that comes from the input (a file name, a function name) was cleaned by safeText before it reached the
// report object. The markdown format also escapes what markdown gives a meaning to, and the SARIF format is built as an
// object and written by JSON.stringify.

import { HEURISTIC, NOT_A, OWASP_NOTE } from './data.js';
import { RULES } from './rules.js';
import { grouped, plural } from './size.js';

const URI = 'https://github.com/INNERLUXES/solidity-risk-scan';

function findingsLine(r) {
  const b = r.totals.byLevel;
  const parts = ['error', 'warning', 'info'].filter((l) => b[l]).map((l) => `${grouped(b[l])} ${l}`);
  return `${grouped(r.totals.findings)}${parts.length ? ` (${parts.join(', ')})` : ''}${r.totals.hidden ? `; ${grouped(r.totals.hidden)} below ${r.options.minSeverity} not shown` : ''}`;
}

const inputsLine = (r) => (r.inputs.length ? r.inputs.join(', ') : 'no path');

function summaryLines(r) {
  const s = r.summary;
  const lines = [
    ['files', `${grouped(s.read)} read, ${grouped(s.notRead)} not read, ${plural(s.lines, 'line')}`],
    ['contracts', `${plural(s.contracts, 'contract')}, ${plural(s.interfaces, 'interface')}, ${plural(s.libraries, 'library', 'libraries')}; ${plural(s.functions, 'function')}`],
    ['access modifiers', r.options.accessModifiers.join(', ')]
  ];
  return lines;
}

function table(head, rows, indent = '  ') {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells) => `${indent}${cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]))).join('  ')}`.trimEnd();
  return [line(head), ...rows.map(line)];
}

const PAD = ' '.repeat(11);

const filesRows = (r) => r.files.map((f) => [f.file, f.read ? grouped(f.lines) : 'not read', f.read ? grouped(f.contracts) : '-', f.read ? grouped(f.functions) : '-', grouped(r.findings.filter((x) => x.file === f.file).length)]);

export function toText(r) {
  const out = [];
  out.push(`solidity-risk-scan: ${inputsLine(r)}`);
  for (const [k, v] of summaryLines(r)) out.push(`${k}: ${v}`);
  out.push(`findings: ${findingsLine(r)}`);
  out.push('', `Checks (${grouped(r.rules.length)})`, '');
  out.push(...table(['check', 'level', 'confidence', 'findings'], r.rules.map((x) => [x.id, x.level, x.confidence, grouped(x.findings)])), '');
  out.push(`Findings (${grouped(r.findings.length)})`, '');
  if (!r.findings.length) out.push('  none', '');
  const width = Math.max(...RULES.map((x) => x.id.length));
  for (const f of r.findings) {
    out.push(`  ${f.severity.toUpperCase().padEnd(8)} ${f.id.padEnd(width)}  ${f.at}`);
    out.push(`${PAD}${f.message}`);
    out.push(`${PAD}confidence: ${f.confidence}${f.owasp ? `; relates to: ${f.owasp} (a heuristic of this tool, not a rule of OWASP)` : ''}`);
    out.push(`${PAD}fix: ${f.fix}`);
    out.push('');
  }
  out.push(`Files (${grouped(r.files.length)})`, '', ...table(['file', 'lines', 'contracts', 'functions', 'findings'], filesRows(r)), '');
  for (const n of r.notes) out.push(`note: ${n}`);
  if (r.notes.length) out.push('');
  out.push(r.notice, '');
  out.push(`RESULT: ${r.result.text}`);
  return `${out.join('\n')}\n`;
}

// Text for a markdown table cell or line: the characters markdown gives a meaning to are escaped.
const md = (t) => String(t).replace(/[\\`*_{}[\]<>()#+!|~]/g, (c) => `\\${c}`).replace(/\r?\n/g, ' ');

export function toMarkdown(r) {
  const out = [];
  out.push(`# solidity-risk-scan: ${md(inputsLine(r))}`, '');
  for (const [k, v] of summaryLines(r)) out.push(`- ${k[0].toUpperCase()}${k.slice(1)}: ${md(v)}`);
  out.push(`- Findings: ${md(findingsLine(r))}`);
  out.push(`- Result: **${md(r.result.text)}**`, '');
  out.push('## Findings', '');
  if (!r.findings.length) out.push('None.', '');
  else {
    out.push('| Level | Check | Confidence | Where | Message |', '| --- | --- | --- | --- | --- |');
    for (const f of r.findings) out.push(`| ${f.severity} | ${f.id} | ${f.confidence} | ${md(f.at)} | ${md(f.message)} Fix: ${md(f.fix)}${f.owasp ? ` Relates to: ${md(f.owasp)}.` : ''} |`);
    out.push('');
  }
  out.push(`## Files (${grouped(r.files.length)})`, '', '| File | Lines | Contracts | Functions | Findings |', '| --- | --- | --- | --- | --- |');
  for (const row of filesRows(r)) out.push(`| ${row.map(md).join(' | ')} |`);
  out.push('');
  for (const n of r.notes) out.push(`Note: ${md(n)}`, '');
  out.push(md(r.notice), '');
  return out.join('\n');
}

export function toJson(r) {
  return `${JSON.stringify(r, null, 2)}\n`;
}

const SARIF_LEVEL = { error: 'error', warning: 'warning', info: 'note' };

// SARIF 2.1.0: the checks as rules of the driver, the files read as artifacts, and one result for each finding with its file,
// line and column.
export function toSarif(r) {
  const index = new Map(r.files.map((f, i) => [f.file, i]));
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'solidity-risk-scan',
            version: r.version,
            informationUri: URI,
            rules: RULES.map((x) => ({
              id: x.id,
              name: x.id,
              shortDescription: { text: x.summary },
              help: { text: `${x.fix} (a heuristic of this tool)` },
              defaultConfiguration: { level: SARIF_LEVEL[x.severity] },
              properties: { confidence: x.confidence, owasp: x.owasp }
            }))
          }
        },
        artifacts: r.files.map((f) => ({ location: { uri: f.file } })),
        results: r.findings.map((f) => ({
          ruleId: f.id,
          ruleIndex: RULES.findIndex((x) => x.id === f.id),
          level: SARIF_LEVEL[f.severity],
          message: { text: `${f.message} Fix: ${f.fix}` },
          locations: [{ physicalLocation: { artifactLocation: { uri: f.file, index: index.get(f.file) }, region: { startLine: f.line, startColumn: f.column } } }],
          properties: { confidence: f.confidence, owasp: f.owasp, subject: f.subject }
        })),
        properties: { notice: r.notice, result: r.result.text }
      }
    ]
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

// ---- the list of checks and the explanation of one ----

const OWASP_NONE = '-';

export function listChecksText() {
  const width = Math.max(...RULES.map((x) => x.id.length));
  const out = ['solidity-risk-scan checks', ''];
  for (const x of RULES) out.push(`  ${x.id.padEnd(width)}  ${x.severity.padEnd(7)}  ${x.confidence.padEnd(6)}  ${(x.owasp ?? OWASP_NONE).padEnd(32)}  ${x.summary}`);
  out.push('', `Every check is ${HEURISTIC}. The OWASP item is the ${OWASP_NOTE}. The level and the confidence given here are the usual ones; a finding may carry another, and says so. The tool is ${NOT_A}.`, '');
  return out.join('\n');
}

export function listChecksMarkdown() {
  const out = ['# solidity-risk-scan checks', '', '| Check | Level | Confidence | OWASP item | What it looks at |', '| --- | --- | --- | --- | --- |'];
  for (const x of RULES) out.push(`| ${x.id} | ${x.severity} | ${x.confidence} | ${md(x.owasp ?? OWASP_NONE)} | ${md(x.summary)} |`);
  out.push('', `Every check is ${md(HEURISTIC)}.`, '');
  return out.join('\n');
}

export function listChecksJson() {
  return `${JSON.stringify(RULES.map((x) => ({ id: x.id, severity: x.severity, confidence: x.confidence, owasp: x.owasp, summary: x.summary, fix: x.fix, own: x.own, cannot: x.cannot })), null, 2)}\n`;
}

export function explainText(rule) {
  const out = [`${rule.id}`, ''];
  out.push(`level: ${rule.severity}`, `confidence: ${rule.confidence}`, `relates to: ${rule.owasp ?? 'no item of the OWASP Smart Contract Top 10'}`, '');
  out.push(`what it looks at: ${rule.summary}`, '', `why it exists: ${rule.own}`, '', `what to change: ${rule.fix}`, '', `what it cannot see: ${rule.cannot}`, '');
  out.push(`This check is ${HEURISTIC}. The tool is ${NOT_A}.`, '');
  return out.join('\n');
}

export function explainMarkdown(rule) {
  const out = [`# ${md(rule.id)}`, ''];
  out.push(`- Level: ${rule.severity}`, `- Confidence: ${rule.confidence}`, `- Relates to: ${md(rule.owasp ?? 'no item of the OWASP Smart Contract Top 10')}`, '');
  out.push(`**What it looks at.** ${md(rule.summary)}`, '', `**Why it exists.** ${md(rule.own)}`, '', `**What to change.** ${md(rule.fix)}`, '', `**What it cannot see.** ${md(rule.cannot)}`, '');
  out.push(`This check is ${md(HEURISTIC)}.`, '');
  return out.join('\n');
}

export function explainJson(rule) {
  return `${JSON.stringify({ id: rule.id, severity: rule.severity, confidence: rule.confidence, owasp: rule.owasp, summary: rule.summary, fix: rule.fix, own: rule.own, cannot: rule.cannot, note: `This check is ${HEURISTIC}.` }, null, 2)}\n`;
}
