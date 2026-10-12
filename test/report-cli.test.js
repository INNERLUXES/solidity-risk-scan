import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCESS_MODIFIERS, LEVELS, NOTICE, RULES, USAGE, VERSION, checkSources, buildReport, decide, listChecksJson, listChecksMarkdown, listChecksText, parseArgs, readModifierList, toJson, toMarkdown, toSarif, toText } from '../src/index.js';
import { ARGS, BAD, GOOD, WARN, cli, contract, run, sol, withFiles } from './helpers.js';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');

test('parseArgs: every option, with the defaults when none is given', () => {
  const d = parseArgs(['contracts']);
  assert.deepEqual(d.paths, ['contracts']);
  assert.equal(d.format, 'text');
  for (const k of ['minSeverity', 'failOn', 'accessModifiers', 'explain']) assert.equal(d[k], null, k);
  assert.equal(d.includeTests, false);
  const o = parseArgs(['a', 'b', '--format', 'markdown', '--min-severity', 'warning', '--fail-on', 'info', '--access-modifiers', 'onlyGov, onlyOwner', '--include-tests']);
  assert.deepEqual(o.paths, ['a', 'b']);
  assert.deepEqual([o.format, o.minSeverity, o.failOn, o.includeTests], ['markdown', 'warning', 'info', true]);
  assert.deepEqual(o.modifierList, ['onlyGov', 'onlyOwner']);
  assert.equal(parseArgs(['a', '--json']).format, 'json');
  assert.equal(parseArgs(['a', '--json', '--format', 'json']).format, 'json');
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-v']).version, true);
  assert.equal(parseArgs(['--list-checks']).listChecks, true);
  assert.equal(parseArgs(['--explain', 'tx-origin-auth']).explain, 'tx-origin-auth');
});

test('parseArgs: what is refused, each with a message that says why', () => {
  const refused = [
    [['--bogus', 'a'], /unknown argument --bogus/],
    [['a', '--format'], /--format needs a value/],
    [['a', '--format', '--json'], /--format needs a value/],
    [['a', '--format', 'xml'], /unknown format xml/],
    [['a', '--json', '--format', 'sarif'], /ask for two formats/],
    [['a', '--fail-on', 'high'], /--fail-on: unknown level high/],
    [['a', '--min-severity', 'high'], /--min-severity: unknown level high/],
    [['a', '--fail-on', 'error', '--fail-on', 'info'], /--fail-on was given twice/],
    [['a', '--include-tests', '--include-tests'], /--include-tests was given twice/],
    [['a', '--access-modifiers', 'x', '--access-modifiers', 'y'], /--access-modifiers was given twice/],
    [['a', '--access-modifiers', 'a,,b'], /with none empty/],
    [['a', '--access-modifiers', 'a b'], /"a b" is not the name of a modifier/],
    [['a', '--access-modifiers', '1x'], /"1x" is not the name of a modifier/],
    [[], /give at least one \.sol file or folder/],
    [['-'], /reading from standard input is not supported/],
    [['a', '--explain', '-'], /reading from standard input is not supported/],
    [['https://example.com/a.sol'], /give a local path; the tool never fetches a URL/],
    [['--list-checks', '--format', 'sarif'], /--list-checks has no SARIF form/],
    [['--explain', 'tx-origin-auth', '--format', 'sarif'], /--explain has no SARIF form/],
    [['--explain', 'tx-origin'], /unknown check tx-origin\. Did you mean tx-origin-auth\?/],
    [['--explain', 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'], /unknown check zzzz/]
  ];
  for (const [argv, message] of refused) assert.throws(() => parseArgs(argv), message, argv.join(' '));
  assert.throws(() => parseArgs(['a', '--access-modifiers', Array.from({ length: 51 }, (_, i) => `m${i}`).join(',')]), /at most 50 names/);
  assert.deepEqual(readModifierList('a,a,b'), ['a', 'b']);
});

test('main: --help and --version print and exit with 0, a usage error prints the usage and exits with 2', async () => {
  const help = await cli(['--help'], root);
  assert.equal(help.code, 0);
  assert.equal(help.out, USAGE);
  for (const id of RULES.map((r) => r.id)) assert.ok(USAGE.includes(id), id);
  for (const flag of ['--format', '--json', '--min-severity', '--fail-on', '--access-modifiers', '--include-tests', '--list-checks', '--explain', '--help', '--version']) assert.ok(USAGE.includes(flag), flag);
  assert.ok(USAGE.includes(ACCESS_MODIFIERS.join(',')));
  const version = await cli(['--version'], root);
  assert.equal(version.out, `${VERSION}\n`);
  assert.equal(VERSION, '1.0.0');
  const wrong = await cli(['--nope'], root);
  assert.equal(wrong.code, 2);
  assert.equal(wrong.out, '');
  assert.ok(wrong.err.startsWith('solidity-risk-scan: unknown argument --nope\n\nUsage:'));
});

test('the usage and the notice say it is a heuristic first pass and not an audit', () => {
  const text = USAGE.replace(/\s+/g, ' ');
  assert.ok(text.includes('Every check is a heuristic of this tool'));
  assert.ok(text.includes('the tool is not an audit'));
  assert.ok(text.includes('contacts nothing over the network, reads no clock and writes nothing to disk'));
  assert.match(NOTICE, /it is not an audit/);
});

test('exit codes: 0 for a clean scan, 1 for a finding at or above --fail-on, 2 for a path that does not exist', async () => {
  assert.equal((await run(GOOD, ARGS)).code, 0);
  assert.equal((await run(BAD, ARGS)).code, 1);
  assert.equal((await run(WARN, ARGS)).code, 0);
  assert.equal((await run(WARN, [...ARGS, '--fail-on', 'warning'])).code, 1);
  assert.equal((await run(BAD, [...ARGS, '--min-severity', 'error'])).code, 1);
  assert.equal((await run(WARN, [...ARGS, '--min-severity', 'error'])).code, 0);
  assert.equal((await run(BAD, ['Nope.sol'])).code, 2);
});

test('--min-severity hides what is below it but the result still counts it, and the report says how many are hidden', async () => {
  const r = await run(WARN, [...ARGS, '--min-severity', 'error', '--fail-on', 'warning']);
  assert.equal(r.code, 1);
  assert.match(r.out, /findings: 0; 1 below error not shown/);
  assert.match(r.out, /RESULT: FAIL - 1 finding at or above warning \(1 warning\)/);
});

test('--fail-on info fails on a note, and the default does not', async () => {
  const note = { 'N.sol': 'contract N { function f(address payable t) external { t.transfer(1); } }' };
  assert.equal((await run(note, ['N.sol'])).code, 0);
  assert.equal((await run(note, ['N.sol', '--fail-on', 'info'])).code, 1);
});

test('decide: pass, fail, and the words of each', () => {
  assert.deepEqual(decide({ error: 0, warning: 0, info: 0 }, 'error'), { pass: true, failOn: 'error', text: 'PASS - no finding at or above error' });
  assert.equal(decide({ error: 0, warning: 2, info: 1 }, 'error').text, 'PASS - no finding at or above error (2 warning, 1 info)');
  assert.equal(decide({ error: 1, warning: 2, info: 0 }, 'warning').text, 'FAIL - 3 findings at or above warning (1 error, 2 warning)');
  assert.deepEqual(LEVELS, ['info', 'warning', 'error']);
});

test('--list-checks lists every check in text, markdown and JSON, with the level, the confidence and the OWASP item by name', async () => {
  const text = await cli(['--list-checks'], root);
  assert.equal(text.code, 0);
  assert.equal(text.out, listChecksText());
  for (const r of RULES) assert.ok(text.out.includes(r.id), r.id);
  assert.match(text.out, /Every check is a heuristic of this tool; it is not a rule of OWASP/);
  const md = await cli(['--list-checks', '--format', 'markdown'], root);
  assert.equal(md.out, listChecksMarkdown());
  assert.match(md.out, /\| tx-origin-auth \| error \| high \| Access Control Vulnerabilities \|/);
  const json = JSON.parse((await cli(['--list-checks', '--json'], root)).out);
  assert.equal(json.length, RULES.length);
  assert.deepEqual(Object.keys(json[0]), ['id', 'severity', 'confidence', 'owasp', 'summary', 'fix', 'own', 'cannot']);
  assert.equal(listChecksJson(), `${JSON.stringify(json, null, 2)}\n`);
});

test('the OWASP items are named and never dated, and the documents of the tool say the checks are not rules of OWASP', () => {
  const names = new Set(RULES.map((r) => r.owasp).filter(Boolean));
  assert.deepEqual([...names].sort(), ['Access Control Vulnerabilities', 'Denial of Service (DoS) Attacks', 'Insecure Randomness', 'Reentrancy Attacks', 'Unchecked External Calls']);
  const everything = [listChecksText(), listChecksMarkdown(), listChecksJson(), USAGE, ...RULES.map((r) => JSON.stringify(r))].join('\n');
  assert.doesNotMatch(everything, /\b(?:19|20)\d{2}\b/);
});

test('--explain says what a check looks at, why it exists, what to change and what it cannot see, in three formats', async () => {
  for (const r of RULES) {
    const text = await cli(['--explain', r.id], root);
    assert.equal(text.code, 0, r.id);
    for (const part of [r.id, r.summary, r.own, r.fix, r.cannot, 'a heuristic of this tool']) assert.ok(text.out.includes(part), `${r.id}: ${part}`);
  }
  const md = await cli(['--explain', 'unbounded-loop', '--format', 'markdown'], root);
  assert.ok(md.out.startsWith('# unbounded-loop\n'));
  assert.ok(md.out.includes('- Relates to: Denial of Service \\(DoS\\) Attacks'));
  const json = JSON.parse((await cli(['--explain', 'unbounded-loop', '--json'], root)).out);
  assert.equal(json.owasp, 'Denial of Service (DoS) Attacks');
  assert.match(json.note, /a heuristic of this tool/);
  const none = await cli(['--explain', 'floating-pragma'], root);
  assert.match(none.out, /relates to: no item of the OWASP Smart Contract Top 10/);
});

test('the text report: what was read, the checks with their counts, the findings with fix and confidence, the files, the notice and the result', async () => {
  const r = await run({ 'Bad.sol': WARN['Bad.sol'], 'Good.sol': GOOD['Good.sol'] }, ['.']);
  assert.match(r.out, /^solidity-risk-scan: \.\nfiles: 2 read, 0 not read, \d+ lines\ncontracts: 2 contracts, 0 interfaces, 0 libraries; \d+ functions\naccess modifiers: onlyOwner, onlyRole, onlyAdmin, auth, requiresAuth\nfindings: 1 \(1 warning\)\n/);
  assert.match(r.out, /\n {2}state-change-no-access-check +warning +medium +1\n/);
  assert.match(r.out, /\n {2}WARNING {2}state-change-no-access-check +Bad\.sol:\d+:\d+\n {11}The function setOwner is public/);
  assert.match(r.out, /\n {11}confidence: high; relates to: Access Control Vulnerabilities \(a heuristic of this tool, not a rule of OWASP\)\n {11}fix: Ask who should be able to call the function/);
  assert.match(r.out, /\nFiles \(2\)\n\n {2}file +lines +contracts +functions +findings\n {2}Bad\.sol +\d+ +1 +\d+ +1\n {2}Good\.sol +\d+ +1 +\d+ +0\n/);
  assert.ok(r.out.endsWith(`${NOTICE}\n\nRESULT: PASS - no finding at or above error (1 warning)\n`));
});

test('the markdown report is a summary with a table of findings and one of files', async () => {
  const r = await run(WARN, [...ARGS, '--format', 'markdown']);
  assert.ok(r.out.startsWith('# solidity-risk-scan: .\n'));
  assert.ok(r.out.includes('- Result: **PASS - no finding at or above error \\(1 warning\\)**'));
  assert.match(r.out, /\| Level \| Check \| Confidence \| Where \| Message \|/);
  assert.match(r.out, /\| warning \| state-change-no-access-check \| high \| Bad\.sol:\d+:\d+ \|/);
  assert.match(r.out, /## Files \(1\)/);
});

test('the JSON report holds the inputs, the files, the totals, every check with its count, every finding with its place, the notes and the result', async () => {
  const r = JSON.parse((await run(WARN, [...ARGS, '--json'])).out);
  assert.equal(r.tool, 'solidity-risk-scan');
  assert.equal(r.version, VERSION);
  assert.deepEqual(r.inputs, ['.']);
  assert.deepEqual(r.files.map((f) => f.file), ['Bad.sol']);
  assert.deepEqual(r.totals, { findings: 1, byLevel: { error: 0, warning: 1, info: 0 }, hidden: 0 });
  assert.equal(r.rules.length, RULES.length);
  assert.deepEqual(r.rules.map((x) => x.id), RULES.map((x) => x.id));
  const [f] = r.findings;
  assert.deepEqual(Object.keys(f), ['id', 'severity', 'confidence', 'message', 'file', 'line', 'column', 'at', 'subject', 'owasp', 'fix']);
  assert.equal(f.at, `Bad.sol:${f.line}:${f.column}`);
  assert.equal(f.owasp, 'Access Control Vulnerabilities');
  assert.deepEqual(r.options.accessModifiers, ACCESS_MODIFIERS);
  assert.equal(r.notice, NOTICE);
  assert.equal(r.result.pass, true);
});

test('the SARIF report has the rules of the driver, an artifact for each file, and a result with file, line and column', async () => {
  const sarif = JSON.parse((await run(WARN, [...ARGS, '--format', 'sarif'])).out);
  assert.equal(sarif.version, '2.1.0');
  const [run1] = sarif.runs;
  assert.equal(run1.tool.driver.name, 'solidity-risk-scan');
  assert.equal(run1.tool.driver.rules.length, RULES.length);
  assert.deepEqual(run1.tool.driver.rules.map((x) => x.id), RULES.map((x) => x.id));
  assert.deepEqual(run1.artifacts, [{ location: { uri: 'Bad.sol' } }]);
  const [result] = run1.results;
  assert.equal(result.ruleId, 'state-change-no-access-check');
  assert.equal(run1.tool.driver.rules[result.ruleIndex].id, result.ruleId);
  assert.equal(result.level, 'warning');
  const loc = result.locations[0].physicalLocation;
  assert.equal(loc.artifactLocation.uri, 'Bad.sol');
  assert.equal(loc.artifactLocation.index, 0);
  assert.ok(loc.region.startLine >= 1 && loc.region.startColumn >= 1);
  assert.equal(run1.tool.driver.rules.find((x) => x.id === 'floating-pragma').defaultConfiguration.level, 'note');
});

test('text from the file name is cleaned and markdown in it is escaped; the reports hold no control character', async () => {
  const name = `a_${String.fromCharCode(0x202e)}b_[x](y).sol`;
  await withFiles({ [name]: BAD['Bad.sol'] }, async (dir) => {
    for (const format of ['text', 'markdown', 'json', 'sarif']) {
      const r = await cli([name, '--format', format], dir);
      assert.ok(!r.out.includes(String.fromCharCode(0x202e)), format);
      assert.ok(![...r.out].some((c) => c.charCodeAt(0) < 32 && c !== '\n'), format);
    }
    const md = (await cli([name, '--format', 'markdown'], dir)).out;
    assert.ok(md.includes('a\\_ b\\_\\[x\\]\\(y\\).sol'), md.split('\n')[0]);
  });
});

test('a run writes nothing: the folder is the same after it', async () => {
  await withFiles(BAD, async (dir) => {
    const before = await readdir(dir);
    for (const format of ['text', 'markdown', 'json', 'sarif']) await cli([...ARGS, '--format', format], dir);
    assert.deepEqual(await readdir(dir), before);
  });
});

test('checkSources and buildReport work on texts with no file system, and a file that was not read is a finding', () => {
  const checked = checkSources([{ file: 'A.sol', text: contract('    uint256 x;\n    function f() external { x = 1; }') }, { file: 'B.sol', error: 'is larger than 5 bytes' }]);
  const report = buildReport({ checked, version: '9.9.9', failOn: 'warning' });
  assert.equal(report.version, '9.9.9');
  assert.equal(report.summary.notRead, 1);
  assert.deepEqual(report.findings.map((f) => [f.id, f.file]), [['file-unreadable', 'B.sol'], ['state-change-no-access-check', 'A.sol']]);
  assert.equal(report.result.pass, false);
  assert.ok(toText(report).includes('RESULT: FAIL'));
  assert.ok(toMarkdown(report).includes('## Findings'));
  assert.equal(JSON.parse(toJson(report)).findings.length, 2);
  assert.equal(JSON.parse(toSarif(report)).runs[0].results.length, 2);
});

test('--access-modifiers replaces the list, and --include-tests reads the tests', async () => {
  const files = { 'C.sol': contract('    address public owner;\n    modifier onlyGovernor() { _; }\n    function set() external onlyGovernor { owner = msg.sender; }'), 'test/T.sol': BAD['Bad.sol'], 'Other.t.sol': BAD['Bad.sol'] };
  const without = JSON.parse((await run(files, ['.', '--json'])).out);
  assert.equal(without.findings.filter((f) => f.id === 'state-change-no-access-check').length, 1);
  assert.deepEqual(without.files.map((f) => f.file), ['C.sol']);
  const withList = JSON.parse((await run(files, ['.', '--json', '--access-modifiers', 'onlyGovernor'])).out);
  assert.equal(withList.findings.filter((f) => f.id === 'state-change-no-access-check').length, 0);
  assert.deepEqual(withList.options.accessModifiers, ['onlyGovernor']);
  const withTests = JSON.parse((await run(files, ['.', '--json', '--include-tests'])).out);
  assert.deepEqual(withTests.files.map((f) => f.file), ['C.sol', 'Other.t.sol', 'test/T.sol']);
  assert.equal(withTests.options.includeTests, true);
});

test('a custom modifier that checks the sender counts without being named in the list', async () => {
  const r = await run({ 'C.sol': sol('contract C {\n    address owner;\n    modifier keeper() { require(msg.sender == owner); _; }\n    function set() external keeper { owner = msg.sender; }\n}') }, ['C.sol', '--json']);
  assert.equal(JSON.parse(r.out).findings.length, 0);
});

test('the same files give the same report whatever the order of the paths, and a second run gives the same text', async () => {
  const files = { 'a/A.sol': BAD['Bad.sol'], 'b/B.sol': WARN['Bad.sol'], 'c/C.sol': GOOD['Good.sol'] };
  await withFiles(files, async (dir) => {
    const one = await cli(['a', 'b', 'c', '--json'], dir);
    const two = await cli(['c', 'b', 'a', '--json'], dir);
    const strip = (text) => JSON.stringify({ ...JSON.parse(text), inputs: undefined });
    assert.equal(strip(one.out), strip(two.out));
    assert.equal((await cli(['a', 'b', 'c'], dir)).out, (await cli(['a', 'b', 'c'], dir)).out);
    assert.deepEqual(JSON.parse(one.out).files.map((f) => f.file), ['a/A.sol', 'b/B.sol', 'c/C.sol']);
  });
});
