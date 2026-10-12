// The tool never reads a seed or a key. A file that holds one anyway, under a column named for one or as a cell shaped
// like one, is a finding of its own, and the value is never written to a report or an error message: the cell is marked,
// and the checks leave a marked cell out as if it were not there.
//
// The shapes are kept loose on purpose, so that a seed or a key is caught even when it is not quite valid: a mnemonic is
// 12, 15, 18, 21 or 24 words of 3 to 8 lowercase letters (the length of the words of the English list of BIP-39); an
// extended private key starts with a letter and "prv" (xprv, yprv, zprv, tprv and their kin) followed by 100 or more
// base58 characters; a private key in hex is 64 hex digits, with or without 0x; a private key in WIF is 51 or 52 base58
// characters that start with 5, K, L, c or 9.

// The names of keys that hold a seed or a key, compared in lowercase with everything but the letters left out.
export const SECRET_KEYS = ['mnemonic', 'mnemonicphrase', 'seed', 'seedphrase', 'seedwords', 'phrase', 'recoveryphrase', 'secretphrase', 'words', 'entropy', 'privatekey', 'privkey', 'secretkey', 'secret', 'xprv', 'xpriv', 'wif', 'passphrase', 'password', 'masterkey'];

const WORD = /^[a-z]{3,8}$/;
const MNEMONIC_WORDS = [12, 15, 18, 21, 24];
const EXTENDED = /^[a-zA-Z]prv[1-9A-HJ-NP-Za-km-z]{100,}$/;
const HEX_KEY = /^(?:0x)?[0-9a-fA-F]{64}$/;
const WIF = /^[5KLc9][1-9A-HJ-NP-Za-km-z]{50,51}$/;

// Whether the name of a key says that it holds a seed or a key.
export const isSecretKey = (key) => SECRET_KEYS.includes(key.toLowerCase().replace(/[^a-z]/g, ''));

// What a text looks like when it looks like a seed or a key, or null.
export function secretShape(text) {
  const v = text.trim();
  if (v.length > 4000) return null;
  const words = v.split(/\s+/);
  if (MNEMONIC_WORDS.includes(words.length) && words.every((w) => WORD.test(w))) return 'a mnemonic';
  if (EXTENDED.test(v)) return 'an extended private key';
  if (HEX_KEY.test(v)) return 'a private key in hex';
  if (WIF.test(v)) return 'a private key in WIF';
  return null;
}

// Looks at every column name and every cell of the table. A column whose name says it holds a seed or a key, and a cell
// shaped like one, are marked (table.secretColumns, row.secrets) and returned as findings with their line; no value is
// put in a message, and a column name is shown only when it is not itself shaped like a secret. A cell of 64 hex digits
// in a column of hexColumns is an identifier and not a finding. A cell shorter than 47 characters is too short to be any
// of the shapes (12 words of 3 letters with the spaces between them is the shortest) and is not looked at.
export function findSecrets(table, cellAt, hexColumns = new Set()) {
  const findings = [];
  const { header, rows } = table;
  table.secretColumns = new Set();
  header.cells.forEach((name, index) => {
    const shape = secretShape(name);
    if (shape || isSecretKey(name)) {
      table.secretColumns.add(index);
      const where = cellAt(header, index);
      const label = shape ? `a column name shaped like ${shape}` : `the column "${name.trim().slice(0, 80)}"`;
      findings.push({ id: 'secret-in-file', line: where.line, column: where.column, message: `The file holds ${label}, which names a seed, a mnemonic or a private key. The tool never reads one, and the values under it are not shown.` });
    }
  });
  for (const row of rows) {
    for (let index = 0; index < row.cells.length; index += 1) {
      if (table.secretColumns.has(index) || row.cells[index].length < 47) continue;
      const shape = secretShape(row.cells[index]);
      // 64 hex digits in a column that holds identifiers is a hash used as an identifier, and is read as one.
      if (shape === 'a private key in hex' && hexColumns.has(index)) continue;
      if (shape) {
        (row.secrets ??= new Set()).add(index);
        const where = cellAt(row, index);
        const name = header.cells[index];
        const of = name === undefined || secretShape(name) || name.length > 80 ? 'A cell' : `A cell of the column "${name.trim()}"`;
        findings.push({ id: 'secret-in-file', line: where.line, column: where.column, message: `${of} is shaped like ${shape}. The tool never reads a seed or a key, and the value is not shown.` });
      }
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.column - b.column);
}
