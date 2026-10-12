import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOT_A, NOTICE, RULES } from '../src/index.js';
import { contract, ofCheck, scan } from './helpers.js';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel) => readFile(resolve(root, rel), 'utf8');
const HOMEPAGE = 'https://innerluxes.dev/blockchain/security/audit/smart-contract';
const LINK_TEXT = 'Smart Contract Audit Services for Blockchain Security';
const DECISIONS = ['docs/decisions/0001-be-a-heuristic-first-pass-and-say-so.md', 'docs/decisions/0002-read-solidity-with-a-lexer-and-parser-of-its-own.md', 'docs/decisions/0003-read-the-files-on-disk-and-contact-nothing.md', 'docs/decisions/0004-walk-folders-and-tokens-without-recursion-and-bound-the-work.md'];
// The pattern of tools/check.mjs, kept unchanged: a word of four digits that starts with 19 or 20 reads like a year, unless it
// is the number of a standard after EIP or ERC.
const YEAR = /(?<!(?:EIP|ERC)[- ]?)\b(?:19|20)\d{2}\b/i;
const DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const norm = (t) => t.replace(/\s+/g, ' ');

// Every file below a folder of the repository, with forward slashes.
async function filesOf(dir) {
  const out = [];
  const walk = async (rel) => {
    for (const e of await readdir(resolve(root, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(r);
      else out.push(r);
    }
  };
  await walk(dir);
  return out.sort();
}

// Every file of the repository that is committed.
async function allFiles() {
  const out = [];
  const walk = async (rel) => {
    for (const e of await readdir(resolve(root, rel || '.'), { withFileTypes: true })) {
      if (['.git', 'coverage'].includes(e.name) || (!rel && ['dist', 'node_modules'].includes(e.name))) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(r);
      else out.push(r);
    }
  };
  await walk('');
  return out.sort();
}

const docFiles = async () => ['README.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', ...(await filesOf('docs')).filter((f) => f.endsWith('.md'))];

test('package.json: a zero-dependency Node 22 ES module with the bin, the scripts, the author, the repository and the homepage', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.name, 'solidity-risk-scan');
  assert.equal(pkg.version, '1.0.0');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=22');
  assert.equal(pkg.homepage, HOMEPAGE);
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.author, 'INNERLUXES <info@innerluxes.dev>');
  assert.equal(pkg.repository.url, 'git+https://github.com/INNERLUXES/solidity-risk-scan.git');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.bin['solidity-risk-scan'], 'bin/solidity-risk-scan.js');
  for (const k of ['solidity', 'smart-contracts', 'smart-contract-security', 'smart-contract-audit', 'ethereum', 'evm', 'static-analysis', 'security', 'blockchain', 'sarif', 'cli', 'nodejs']) assert.ok(pkg.keywords.includes(k), k);
  assert.match(pkg.description, /^Solidity risk scan: /);
  assert.match(pkg.description, /it is not an audit\./);
  for (const script of ['test', 'check', 'example', 'test:coverage']) assert.ok(pkg.scripts[script], script);
  assert.equal(pkg.scripts.test, 'node --test "test/*.test.js"');
  assert.equal(pkg.scripts['test:coverage'], 'node --test --experimental-test-coverage "test/*.test.js"');
  const lock = JSON.parse(await read('package-lock.json'));
  assert.deepEqual(Object.keys(lock.packages), ['']);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.name, pkg.name);
  assert.ok((await read('bin/solidity-risk-scan.js')).startsWith('#!/usr/bin/env node\n'));
});

test('README: one link to the page on smart contract audit services, with its title, in the closing Background section', async () => {
  const readme = await read('README.md');
  const parts = readme.split(/^## /m);
  const background = parts.find((p) => p.startsWith('Background'));
  assert.ok(background, 'a Background section');
  assert.ok(norm(background).includes(`[${LINK_TEXT}](${HOMEPAGE})`));
  assert.equal(readme.split('innerluxes.dev/').length - 1, 1, 'the README links to the site once');
  assert.equal(readme.split(HOMEPAGE).length - 1, 1);
  assert.equal(parts.at(-1).split('\n')[0], 'License');
  assert.equal(parts.at(-2).split('\n')[0], 'Background');
  assert.equal([...readme.matchAll(/https?:\/\/innerluxes\.dev/g)].length, 1);
});

test('README: the npm test block shows the summary counts with no symbol in front, and they add up', async () => {
  const readme = await read('README.md');
  const block = /```\n(tests (\d+)\npass (\d+)\nfail (\d+)\nskipped (\d+))\n```/.exec(readme);
  assert.ok(block, 'the npm test block');
  const [, , tests, pass, fail, skipped] = block.map(Number);
  assert.equal(pass + fail + skipped, tests);
  assert.equal(fail, 0);
  assert.ok(tests >= 100);
});

test('README: what it checks, how to run it with npx or node, the options, real example output and the limits', async () => {
  const readme = await read('README.md');
  for (const heading of ['## Quick start', '## Usage', '## How files are found and read', '## What it checks', '## What is not checked', '## Formats', '## Exit codes', '## Limits', '## Architecture', '## Where the ideas come from']) assert.ok(readme.includes(`\n${heading}\n`), heading);
  assert.match(readme, /npx --yes github:INNERLUXES\/solidity-risk-scan contracts/);
  assert.match(readme, /node bin\/solidity-risk-scan\.js examples\/bad/);
  assert.match(readme, /--explain call-before-state-write/);
  for (const option of ['--format', '--json', '--min-severity', '--fail-on', '--access-modifiers', '--include-tests', '--explain', '--list-checks', '--help', '--version']) assert.ok(readme.includes(option), option);
  for (const r of RULES) assert.ok(readme.includes(`| \`${r.id}\` | ${r.severity} | ${r.confidence} | ${r.owasp ?? '-'} |`), `README: ${r.id}`);
  for (const f of ['text', 'markdown', 'JSON', 'SARIF']) assert.ok(readme.includes(f), f);
  assert.match(readme, /Twelve checks/);
  assert.ok(!readme.includes('@@'), 'no placeholder is left');
  for (const real of ['RESULT: FAIL - 8 findings at or above error (8 error, 20 warning, 6 info)', 'RESULT: PASS - no finding at or above error', 'findings: 34 (8 error, 20 warning, 6 info)']) assert.ok(readme.includes(real), real);
});

test('README: it says plainly that it is a pattern-based first pass with false positives and negatives, not an audit, before the quick start', async () => {
  const readme = norm(await read('README.md'));
  assert.ok(readme.includes('This is a pattern-based first pass, not an audit.'));
  assert.ok(readme.indexOf('not an audit') < readme.indexOf('## Quick start'), 'said before the quick start');
  assert.ok(readme.includes('false positives'));
  assert.ok(readme.includes('false negatives'));
  assert.ok(readme.includes('It does not replace a manual audit'));
  assert.ok(readme.includes('The tool contacts nothing over the network, runs nothing, needs no key, reads no clock and writes nothing to disk.'));
  assert.ok(readme.includes('Every check is a heuristic of this tool.'));
  assert.ok(readme.includes('no check is a rule of OWASP'));
  assert.ok(readme.includes('by name only'));
  assert.match(await read('docs/limits.md'), /^solidity-risk-scan is a pattern-based first pass over the text of Solidity files\./m);
  assert.ok(NOT_A.includes('is not an audit'));
  assert.ok(NOTICE.includes('it is not an audit'));
});

test('README says what it can not see: inheritance by name, no compiler, calls through unknown types', async () => {
  const readme = norm(await read('README.md'));
  assert.ok(readme.includes('Inheritance is resolved only by the name of the base contract among the files of the run'));
  assert.ok(readme.includes('Anything that needs the compiler'));
  assert.ok(readme.includes('A call through a variable whose type the tool cannot tell.'));
  assert.ok(readme.includes('a flaw in the logic is not'));
});

test('README and documents: they never say that code is safe, secure, audited or covered, or that OWASP made or endorsed a check', async () => {
  for (const file of await docFiles()) {
    const text = norm(await read(file));
    assert.doesNotMatch(text, /\b(?:guarantees?|ensures?) (?:that )?(?:the |your )?(?:code|contracts?) (?:is|are) (?:safe|secure)\b/i, file);
    assert.doesNotMatch(text, /(?<!not )\b(?:certifies|certified|audit-ready|bulletproof|hack-proof|vulnerability-free)\b/i, file);
    assert.doesNotMatch(text, /(?<!not made by or )endorsed by OWASP/i, file);
    assert.doesNotMatch(text, /\bOWASP[- ](?:compliant|certified|approved|conformant)\b/i, file);
    assert.doesNotMatch(text, /\b(?:conforms?|complies|compliant) (?:to|with) (?:the )?OWASP\b/i, file);
  }
  const everything = [NOTICE, NOT_A, ...RULES.map((r) => `${r.summary} ${r.fix} ${r.own} ${r.cannot}`)].join(' ');
  assert.doesNotMatch(everything, /(?<!not mean the code )\b(?:is|are) (?:safe|secure|audited)\b/i);
});

test('docs/inputs.md: the short file passes every check at every level', async () => {
  const inputs = await read('docs/inputs.md');
  const code = /## A short file\n\n[^\n]*\n[^\n]*\n\n```solidity\n([\s\S]*?)\n```/.exec(inputs);
  assert.ok(code, 'a short file in docs/inputs.md');
  const findings = scan(`${code[1]}\n`);
  assert.deepEqual(findings.map((f) => f.id), []);
  assert.ok(code[1].includes('onlyOwner'));
});

test('README and documents: no number that reads like a year and no date in words or in digits', async () => {
  for (const file of await docFiles()) {
    const text = await read(file);
    assert.doesNotMatch(text, YEAR, file);
    assert.doesNotMatch(text, /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d/, file);
  }
  for (const file of await allFiles()) {
    if (file === 'tools/check.mjs') continue;
    const text = await read(file);
    assert.doesNotMatch(text, YEAR, file);
    assert.doesNotMatch(text, DATE, file);
  }
  assert.match(await read('CHANGELOG.md'), /^## 1\.0\.0$/m);
  assert.doesNotMatch(await read('LICENSE'), /Copyright \(c\) \d/);
});

test('the year pattern passes over versions, seconds, counts and identifiers and still catches a year', () => {
  for (const ok of ['1.0.0', 'Node 22', 'SARIF 2.1.0', '0.8.24', 'RFC 8259', '846,000 seconds', '100,000 rows', '2,500 lots', 'NIST SP 800-218', '2300 gas', '10000']) assert.doesNotMatch(ok, YEAR, ok);
  const year = ['20', '24'].join('');
  const old = ['19', '99'].join('');
  for (const bad of [year, `in ${year}`, old, `${year}.`, `block ${['20', '01'].join('')}`, ['20', '00'].join('')]) assert.match(bad, YEAR, bad);
});

test('README and documents: plain ASCII, with no emoji and no decorative character', async () => {
  for (const file of [...(await docFiles()), '.github/pull_request_template.md', '.github/CODEOWNERS', 'package.json']) {
    const text = await read(file);
    assert.ok([...text].every((c) => c.charCodeAt(0) < 128), file);
  }
});

test('every file: none of the words this project keeps out of its prose, and no name of a tool that wrote it', async () => {
  // Built from pieces, so that this file does not hold the words; a word is matched at its start.
  const words = [['har', 'ness'], ['del', 'v'], ['lever', 'ag'], ['seam', 'less'], ['rob', 'ust'], ['cutting', '-edg'], ['un', 'lock'], ['em', 'power'], ['ele', 'vat'], ['stream', 'lin'], ['game', '-changer'], ['tap', 'estr'], ['re', 'alm'], ['further', 'more'], ['more', 'over'], ['in today', "'s"], ['gene', 'rated'], ['trans', 'form'], ['compre', 'hensiv'], ['tail', 'ored'], ['state-of-the', '-art'], ['revol', 'ution'], ['holi', 'stic'], ['world', '-class']].map((p) => p.join(''));
  const banned = new RegExp(`\\b(?:${words.join('|')})`, 'i');
  const names = new RegExp(`${['cla', 'ude'].join('')}|${['anthro', 'pic'].join('')}|\\b${['A', 'I'].join('')}\\b|\\b${['assis', 'tant'].join('')}|\\b${['ch', 'at'].join('')}\\b|\\b${['ses', 'sion'].join('')}|${['co-', 'authored'].join('')}|${['gene', 'rated'].join('')}`, 'i');
  for (const file of await allFiles()) {
    if (file === 'tools/check.mjs') continue;
    const text = await read(file);
    assert.doesNotMatch(text, banned, file);
    assert.doesNotMatch(text, names, file);
  }
  assert.match(`an ${['assis', 'tant'].join('')} wrote this`, names);
  assert.match(`a ${['trans', 'formation'].join('')} of the business`, banned, 'the word is caught everywhere');
  assert.match(`the ${['trans', 'form'].join('')}ed code`, banned);
});

test('no file holds a string shaped like a token or a private key', async () => {
  const shapes = [new RegExp(`\\b(?:${['gh', 'p'].join('')}|${['gh', 'o'].join('')}|${['gh', 's'].join('')}|${['github', '_pat'].join('')})_[A-Za-z0-9_]{6,}`), new RegExp(`-----BEGIN [A-Z ]*${['PRIVATE', ' KEY'].join('')}-----`), new RegExp(`\\b${['AK', 'IA'].join('')}[0-9A-Z]{16}\\b`)];
  for (const file of await allFiles()) {
    const text = await read(file);
    for (const shape of shapes) assert.doesNotMatch(text, shape, file);
    assert.ok(!text.includes(['gh', 'p_'].join('')), file);
  }
});

test('LICENSE: MIT with the copyright line of INNERLUXES and no year', async () => {
  const license = await read('LICENSE');
  assert.ok(license.startsWith('MIT License\n\nCopyright (c) INNERLUXES\n'));
});

test('SECURITY.md: how to report, and no promise about reply times or fixes', async () => {
  const text = await read('SECURITY.md');
  assert.match(text, /info@innerluxes\.dev/);
  assert.match(text, /"solidity-risk-scan security"/);
  assert.doesNotMatch(text, /within\s+\d|business days|within a (?:day|week)|\d+\s*(?:hours|days)\b|we will|we guarantee|guaranteed|respond within|reply within/i);
});

test('workflows: every action is pinned to a full commit with a version comment, the CI runs three systems, two Node versions and coverage, and the SSDF gate is there and pinned', async () => {
  for (const name of ['ci.yml', 'codeql.yml', 'release.yml']) {
    const text = await read(`.github/workflows/${name}`);
    assert.match(text, /^permissions:\n {2}contents: read$/m, name);
    const uses = [...text.matchAll(/^\s*(?:- )?uses: (\S+)(.*)$/gm)].map((m) => [m[1], m[2]]);
    assert.ok(uses.length > 0, name);
    for (const [action, comment] of uses) {
      assert.match(action, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/, `${name}: ${action}`);
      assert.match(comment, /^ # v\d+\.\d+\.\d+$/, `${name}: ${action}${comment}`);
    }
    assert.doesNotMatch(text, /lot-genealogy|fsma|epcis|marketplace|escrow|nft-|token-transfer|payout-batch|crypto-checkout|tokenomics/i, name);
  }
  const ci = await read('.github/workflows/ci.yml');
  assert.match(ci, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(ci, /node: \[22, 24\]/);
  assert.match(ci, /run: npm run test:coverage/);
  assert.match(ci, /node \.ssdf\/bin\/ssdf-repo-check\.js repo --require-all --fail-on-problem/);
  assert.match(ci, /repository: INNERLUXES\/ssdf-repo-check/);
  assert.match(ci, /ref: [0-9a-f]{40} # v\d+\.\d+\.\d+/);
  for (const s of [/npm ci/, /npm run check/, /npm run example/, /git diff --exit-code -- examples/]) assert.match(ci, s);
});

test('codeql: JavaScript only, with the security-extended queries, and the examples left out', async () => {
  const codeql = await read('.github/workflows/codeql.yml');
  assert.match(codeql, /languages: javascript-typescript/);
  assert.match(codeql, /github\/codeql-action\/init@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
  assert.doesNotMatch(codeql, /autobuild/i);
  assert.match(codeql, /security-extended/);
  assert.match(codeql, /paths-ignore:\n\s+- examples\n/);
  const attributes = await read('.gitattributes');
  assert.match(attributes, /^examples\/\*\* linguist-documentation$/m);
  assert.match(attributes, /^examples\/\*\* linguist-detectable=false$/m);
  assert.match(attributes, /^examples\/output\/\*\* -text$/m);
  assert.doesNotMatch(await read('.github/dependabot.yml'), /package-ecosystem: (?:nuget|pip|maven)/);
});

test('release workflow: the SSDF gate, then a tgz, a CycloneDX SBOM, SHA256SUMS and a provenance attestation named for this package', async () => {
  const release = await read('.github/workflows/release.yml');
  assert.match(release, /node \.ssdf\/bin\/ssdf-repo-check\.js repo --require-all --fail-on-problem/);
  assert.match(release, /ref: [0-9a-f]{40} # v\d+\.\d+\.\d+/);
  assert.ok(release.indexOf('ssdf-repo-check.js') < release.indexOf('npm pack'), 'the gate runs before the package is made');
  assert.match(release, /npm pack --pack-destination dist/);
  assert.match(release, /npm sbom --sbom-format cyclonedx > dist\/solidity-risk-scan\.cdx\.json/);
  assert.match(release, /sha256sum \* > SHA256SUMS/);
  assert.match(release, /actions\/attest-build-provenance@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
  assert.match(release, /tags: \['v\*'\]/);
});

test('repository files: Dependabot for actions and npm, CODEOWNERS, a pull request template and the line-end rules', async () => {
  const dependabot = await read('.github/dependabot.yml');
  assert.match(dependabot, /package-ecosystem: github-actions/);
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(await read('.github/CODEOWNERS'), /^\* @innerluxesdev$/m);
  assert.match(await read('.github/pull_request_template.md'), /Conventional Commits/);
  assert.match(await read('.gitattributes'), /^\* text=auto eol=lf$/m);
  assert.match(await read('.gitignore'), /^\*\.pem$/m);
  const owners = await read('.github/CODEOWNERS');
  for (const file of await filesOf('src')) assert.ok(owners.includes(`/${file} @innerluxesdev`), `CODEOWNERS: ${file}`);
});

test('docs/secure-defaults.md is long enough for the SSDF gate, and every document the README links to exists', async () => {
  assert.ok(norm(await read('docs/secure-defaults.md')).length > 4000);
  const readme = await read('README.md');
  const files = await allFiles();
  for (const link of readme.matchAll(/\]\(((?:docs|examples)\/[^)#]*)\)/g)) assert.ok(files.includes(link[1].replace(/\/$/, '')) || files.some((f) => f.startsWith(link[1])), link[1]);
  for (const d of DECISIONS) assert.ok(files.includes(d), d);
  for (const doc of ['context.md', 'inputs.md', 'limits.md', 'method.md', 'secure-defaults.md', 'threat-model.md']) assert.ok(files.includes(`docs/${doc}`), doc);
});

test('src never reaches the network, runs a program or reads a clock, and builds no regular expression from input', async () => {
  const banned = [/node:(?:net|http|https|http2|dgram|tls|dns|child_process|worker_threads|vm|cluster)/, /\bfetch\(/, /\bXMLHttpRequest\b/, /\beval\(/, /new Function\(/, /\bDate\b/, /Date\.now/, /Math\.random/, /process\.env/, /Intl\./, /parseFloat\(/, /performance\.now/, /hrtime/, /getTimezoneOffset/];
  for (const file of await filesOf('src')) {
    const text = await read(file);
    for (const b of banned) assert.doesNotMatch(text.replace(/^\s*\/\/.*$/gm, ''), b, `${file}: ${b}`);
    if (file !== 'src/text.js') assert.ok(!/new RegExp/.test(text), `${file} builds a regular expression`);
  }
  assert.ok((await read('src/size.js')).includes('toLocaleString'), 'grouped() fixes the locale in the call');
});

test('src is only written to standard output and standard error, never to the disk', async () => {
  for (const file of await filesOf('src')) {
    const text = await read(file);
    assert.doesNotMatch(text, /writeFile|appendFile|createWriteStream|mkdir|unlink|rmSync|rename\(/, file);
  }
});

test('no function of src calls itself: the lexer, the parser, the walk and the checks work through loops, stacks and a worklist', async () => {
  for (const file of await filesOf('src')) {
    const text = await read(file);
    for (const m of text.matchAll(/^(?:export )?(?:async )?function\*? ([A-Za-z0-9_$]+)\(/gm)) {
      const start = m.index + m[0].length;
      const next = text.slice(start).search(/^(?:export )?(?:async )?(?:function|const|class) /m);
      const body = next < 0 ? text.slice(start) : text.slice(start, start + next);
      assert.ok(!new RegExp(`(?<![A-Za-z0-9_$.])${m[1]}\\(`).test(body), `${file}: ${m[1]} calls itself`);
    }
  }
});

test('the bounded file reader, the search for keys and the helpers are the ones of the sibling tools, unchanged', async () => {
  const hashes = {
    'src/files.js': '97777ba4278f436ae64a204a11511b8058f542921026df0a6a3bbdeac99652d7',
    'src/secrets.js': '317805f157c326b87bee4455bda9817d4898a42941cae8f0ca2fffe871d68f1e',
    'src/size.js': 'c2b5c1d337be454d05a893962e7fcc457bac27eb9c896a2347dd0e3ab47f2b76',
    'src/text.js': '0b6d5ea215e4b87e459b106b380b4e8ad67655a1c73f05a1f38e8ca7c719fece'
  };
  for (const [file, hash] of Object.entries(hashes)) assert.equal(createHash('sha256').update(await readFile(resolve(root, file))).digest('hex'), hash, `${file} changed; it is kept as it is in the sibling tools`);
  const secrets = await read('src/secrets.js');
  assert.ok(secrets.includes("export const SECRET_KEYS = ['mnemonic', 'mnemonicphrase', 'seed', 'seedphrase', 'seedwords', 'phrase', 'recoveryphrase', 'secretphrase', 'words', 'entropy', 'privatekey', 'privkey', 'secretkey', 'secret', 'xprv', 'xpriv', 'wif', 'passphrase', 'password', 'masterkey'];"));
  const files = await read('src/files.js');
  assert.match(files, /O_NOFOLLOW/);
  assert.match(files, /s\.size > limits\.maxBytes/);
  const lexer = await read('src/lexer.js');
  assert.match(lexer, /limits\.maxTokens/);
});

test('names that are properties of objects are only names: __proto__, constructor and toString as contracts, functions, variables and modifiers', () => {
  const names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
  for (const name of names) {
    const text = contract(`    uint256 ${name};\n    modifier ${name}M() { _; }\n    function ${name}F() public { ${name} = 1; }\n    function ${name}G() public { ${name} = 2; }`, `contract ${name} is ${name}Base`);
    const found = scan([{ file: 'P.sol', text: `${text}\ncontract ${name}Base { uint256 base; function g() public { base = 1; } }` }]);
    assert.deepEqual(found.map((f) => `${f.id}:${f.subject}`).sort(), [`state-change-no-access-check:${name}G`, `state-change-no-access-check:${name}F`, 'state-change-no-access-check:g'].sort(), name);
  }
  assert.deepEqual(ofCheck(contract('    uint256 __proto__;\n    function f() public { __proto__ = 1; }'), 'state-change-no-access-check').map((f) => f.subject), ['f']);
});

test('a guarded test never asserts a line of its own', async () => {
  for (const file of ['test/files.test.js', 'test/walk.test.js']) {
    const text = await read(file);
    for (const block of text.split(/\ntest\(/).filter((b) => b.includes("process.platform === 'win32'"))) assert.doesNotMatch(block, /\.line\b|lineOf\(/);
  }
});

test('every test file builds its paths with resolve(), and no test writes a backslash, a bar or a quote into a file name', async () => {
  for (const file of (await filesOf('test')).filter((f) => f.endsWith('.js'))) {
    const text = await read(file);
    assert.doesNotMatch(text, /\bjoin\(\s*(?:dir|tmpdir|root)/, `${file} joins an absolute path`);
    assert.doesNotMatch(text, /['"`][A-Za-z0-9_]+\\\\[A-Za-z0-9_]+\.sol['"`]/, `${file} writes a backslash into a file name`);
    assert.doesNotMatch(text, /\{\s*'[^']*[|*?"<>][^']*\.sol':/, `${file} writes a character Windows refuses into a file name`);
  }
});

test('tools/check.mjs and tools/example.mjs exist, the year check and the list of plain words are those of the sibling tools, and the saved example outputs are all there', async () => {
  const files = await filesOf('examples/output');
  for (const f of ['bad.txt', 'good.txt', 'bad.md', 'good.md', 'bad.json', 'good.json', 'bad.sarif', 'good.sarif', 'checks.txt', 'checks.json', 'explain-call-before-state-write.txt', 'explain-call-before-state-write.md']) assert.ok(files.includes(`examples/output/${f}`), f);
  const check = await read('tools/check.mjs');
  assert.ok(check.includes('no problems'));
  assert.ok(check.includes(`const YEAR = ${YEAR.toString()};`), 'the year check is unchanged');
  assert.ok(check.includes("const BANNED_WORDS = [['har', 'ness'], ['del', 've'], ['lever', 'age'], ['seam', 'less'], ['rob', 'ust'], ['cutting', '-edge'], ['un', 'lock'], ['em', 'power'], ['ele', 'vate'], ['stream', 'line'], ['game', '-changer'], ['tap', 'estry'], ['re', 'alm'], ['further', 'more'], ['more', 'over'], ['in today', \"'s\"], ['trans', 'form']"), 'the list of plain words starts as the sibling tools have it');
  for (const extra of ["['compre', 'hensive']", "['tail', 'ored']", "['state-of-the', '-art']", "['revol', 'ution']", "['holi', 'stic']", "['world', '-class']"]) assert.ok(check.includes(extra), extra);
  assert.ok((await read('tools/example.mjs')).includes('examples/output'));
});
