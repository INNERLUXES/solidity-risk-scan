// Runs the README examples, checks that they report what the README shows, and writes the reports of the two made-up folders of
// contracts to examples/output. CI runs it and then fails if those files changed, so the example output in the repository is
// always the real output.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/index.js';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');

// Every path is relative to the root of the repository.
export const BAD = ['examples/bad'];
export const GOOD = ['examples/good'];
export const EXPLAIN = ['--explain', 'call-before-state-write'];

// Runs the tool on files of the repository; the paths shown in the report are relative to the root of the repository.
export async function run(argv, base = root) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => { err += t; } }, undefined, base);
  return { code, out, err };
}

// What the README says of the bad folder: the counts, a finding of every check but one, and the result.
export const EXPECTED = [
  'files: 5 read, 0 not read, 178 lines',
  'contracts: 5 contracts, 0 interfaces, 0 libraries; 29 functions',
  'findings: 34 (8 error, 20 warning, 6 info)',
  'The function withdraw makes a low-level call (.call) and writes state afterwards (to balances, line 23).',
  'The function tip makes a .call() call and does not use the bool it returns, so a failed call goes unnoticed.',
  'The function refund makes a .send() call and does not use the bool it returns, so a failed call goes unnoticed.',
  'The function capture stores the bool of a .call() call in ok and never reads it, so a failed call goes unnoticed.',
  'The function pushOut calls .transfer(), which passes a fixed gas stipend to the recipient',
  'The function setFee is external, writes a state variable (fee, line 36), and has no access modifier from the list and no comparison of msg.sender.',
  'The function initialize looks like an initializer and has no initializer modifier, so it may be called by anyone, and more than once.',
  'The function pay uses tx.origin in a condition.',
  'The function onlyPeople compares tx.origin with msg.sender.',
  'The function forward uses delegatecall on an address that is a parameter of the function.',
  'The function run uses delegatecall and has no sign of an access check.',
  'The function runAsAdmin uses delegatecall and has an access check.',
  'The function close calls selfdestruct and has no sign of an access check.',
  'The function closeAsAdmin calls selfdestruct and has an access check.',
  'The function pick uses block.timestamp, which is hashed and reduced with %.',
  'The function seed uses blockhash, which is hashed.',
  'The function payAll loops up to the length of the state array players and makes an external call in the loop.',
  'The pragma "solidity ^0.8.0" allows more than one compiler version.',
  'The file has no SPDX-License-Identifier comment.',
  'A string is shaped like a mnemonic. The tool never reads a key and the value is not shown.',
  'This report is a heuristic first pass over the text of the files.',
  'RESULT: FAIL - 8 findings at or above error (8 error, 20 warning, 6 info)'
];
// What must not be reported: the check the bad folder cannot hold, the made-up words of the phrase, and a pass.
export const UNWANTED = ['ERROR    file-unreadable', 'amber', 'RESULT: PASS'];

// What the README says of the good folder: no finding.
export const GOOD_EXPECTED = [
  'files: 5 read, 0 not read, 165 lines',
  'contracts: 4 contracts, 1 interface, 1 library; 18 functions',
  'findings: 0',
  'RESULT: PASS - no finding at or above error'
];

const problems = [];
function expect(name, result, code, expected, unwanted, stream = 'out') {
  const text = result[stream];
  const missing = expected.filter((e) => !text.includes(e));
  const wrong = unwanted.filter((e) => text.includes(e));
  if (result.code !== code || missing.length || wrong.length) {
    problems.push(`${name}: unexpected report (exit code ${result.code}, expected ${code}; missing: ${missing.join(' / ') || 'none'}; should not appear: ${wrong.join(' / ') || 'none'})${result.err ? `\n${result.err}` : ''}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bad = await run(BAD);
  process.stdout.write(bad.out);
  expect('bad folder', bad, 1, EXPECTED, UNWANTED);

  const good = await run(GOOD);
  expect('good folder', good, 0, GOOD_EXPECTED, ['ERROR    ', 'WARNING  ', 'INFO     ', 'RESULT: FAIL', 'note: ']);
  // The good folder also passes when warnings and notes fail the run.
  expect('good, fail on warning', await run([...GOOD, '--fail-on', 'warning']), 0, ['RESULT: PASS - no finding at or above warning'], []);
  expect('good, fail on info', await run([...GOOD, '--fail-on', 'info']), 0, ['RESULT: PASS - no finding at or above info'], []);
  // The bad folder with only the errors shown still counts the rest.
  expect('bad, errors only', await run([...BAD, '--min-severity', 'error']), 1, ['findings: 8 (8 error); 26 below error not shown'], ['WARNING  ', 'INFO     ']);
  // The list of access modifiers can be replaced, and the report shows the list in use.
  expect('bad, own modifier list', await run([...BAD, '--access-modifiers', 'onlyGovernor']), 1, ['access modifiers: onlyGovernor'], []);
  // A path that is not there stops the run with no report.
  expect('missing path', await run(['examples/none']), 2, ['examples/none: does not exist'], [], 'err');
  expect('unknown check', await run(['--explain', 'reentrancy']), 2, ['unknown check reentrancy'], [], 'err');

  // The README shows the head of the report of the bad folder with its table of checks, one finding, the table of files and
  // the end of the report, the end of the report of the good folder, and the explanation of a check.
  const readme = (await readFile(resolve(root, 'README.md'), 'utf8')).split('\r\n').join('\n');
  const lines = bad.out.split('\n');
  const head = lines.slice(0, lines.findIndex((l) => l.startsWith('Findings ('))).join('\n');
  if (!readme.includes(head)) problems.push('README: the head of the sample output of the bad folder differs from a real run');
  const at = lines.findIndex((l) => l.includes('call-before-state-write') && l.includes('examples/bad/LeakyVault.sol:21:36'));
  const sample = lines.slice(at, at + 4).join('\n');
  if (at < 0 || !readme.includes(sample)) problems.push('README: the sample finding of the call before a state write differs from a real run');
  const t = lines.findIndex((l) => l.startsWith('Files ('));
  const table = lines.slice(t, lines.indexOf('', t + 2) + 1).join('\n');
  if (t < 0 || !readme.includes(table)) problems.push('README: the table of files of the bad folder differs from a real run');
  const tail = lines.slice(-4).join('\n');
  if (!readme.includes(tail)) problems.push('README: the tail of the sample output of the bad folder differs from a real run');
  const goodTail = good.out.split('\n').slice(-14).join('\n');
  if (!readme.includes(goodTail)) problems.push('README: the tail of the sample output of the good folder differs from a real run');
  const explain = await run(EXPLAIN);
  if (!readme.includes(explain.out.trimEnd())) problems.push('README: the sample explanation of a check differs from a real run');

  await mkdir(resolve(root, 'examples/output'), { recursive: true });
  await writeFile(resolve(root, 'examples/output/bad.txt'), bad.out);
  await writeFile(resolve(root, 'examples/output/good.txt'), good.out);
  const outputs = [
    ['bad.md', [...BAD, '--format', 'markdown'], 1],
    ['bad.json', [...BAD, '--json'], 1],
    ['bad.sarif', [...BAD, '--format', 'sarif'], 1],
    ['good.md', [...GOOD, '--format', 'markdown'], 0],
    ['good.json', [...GOOD, '--json'], 0],
    ['good.sarif', [...GOOD, '--format', 'sarif'], 0],
    ['checks.txt', ['--list-checks'], 0],
    ['checks.json', ['--list-checks', '--format', 'json'], 0],
    ['explain-call-before-state-write.txt', EXPLAIN, 0],
    ['explain-call-before-state-write.md', [...EXPLAIN, '--format', 'markdown'], 0]
  ];
  for (const [name, args, code] of outputs) {
    const r = await run(args);
    if (r.code !== code) problems.push(`${name}: exit code ${r.code}, expected ${code}`);
    await writeFile(resolve(root, 'examples/output', name), r.out);
  }

  if (problems.length) {
    for (const p of problems) console.error(`example: ${p}`);
    process.exit(1);
  }
}
