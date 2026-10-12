// Reading the records file: a regular file of bounded size, opened without following a link where the system allows,
// decoded as UTF-8 or as UTF-16 by its byte order mark, and refused when it holds a null byte. Nothing else is opened,
// and nothing is written.

import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { safeText } from './text.js';

export const FILE_LIMITS = { maxBytes: 16 * 1024 * 1024 };

export class InputError extends Error {
  constructor(problems) {
    super(problems.join('; '));
    this.name = 'InputError';
    this.problems = problems;
  }
}

// The path as the report shows it: relative to the folder the command runs in, with forward slashes; a path outside that
// folder is shown whole.
export function displayPath(absolute, base) {
  const rel = relative(base, absolute);
  const shown = rel === '' || rel.startsWith('..') || isAbsolute(rel) ? absolute : rel;
  return safeText(shown.split(sep).join('/'), 400);
}

// The file to read for a path given on the command line: a regular file, never a link, a folder or a device.
export async function locateInput(given, base) {
  const absolute = resolve(base, given);
  const shown = displayPath(absolute, base);
  let s;
  try {
    s = await lstat(absolute);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new InputError([`${shown}: does not exist`]);
    throw new InputError([`${shown}: ${error.code ?? 'cannot be read'}`]);
  }
  if (s.isSymbolicLink()) throw new InputError([`${shown}: is a symbolic link; give the file it points to`]);
  if (s.isDirectory()) throw new InputError([`${shown}: is a folder; give the records file`]);
  if (!s.isFile()) throw new InputError([`${shown}: is not a regular file`]);
  return absolute;
}

// The text of bytes: UTF-8 (a byte order mark is dropped) or UTF-16 with a byte order mark.
export function decode(buffer) {
  const bytes = buffer;
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    if ((bytes.length - 2) % 2 !== 0) throw new Error('has an odd number of bytes for UTF-16');
    const body = Buffer.from(bytes.subarray(2));
    if (bytes[0] === 0xfe) body.swap16();
    try {
      return new TextDecoder('utf-16le', { fatal: true }).decode(body);
    } catch {
      throw new Error('is not valid UTF-16');
    }
  }
  if (bytes.includes(0)) throw new Error('holds a null byte; it is not a text file');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('is not valid UTF-8');
  }
}

// The text of a file, read through one open handle whose type and size are checked before the read.
export async function readInputText(absolute, base, limits = FILE_LIMITS) {
  const shown = displayPath(absolute, base);
  let handle;
  try {
    handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const s = await handle.stat();
    if (!s.isFile()) throw new InputError([`${shown}: is not a regular file`]);
    if (s.size > limits.maxBytes) throw new InputError([`${shown}: is larger than ${limits.maxBytes} bytes`]);
    const buffer = await handle.readFile();
    if (buffer.length > limits.maxBytes) throw new InputError([`${shown}: is larger than ${limits.maxBytes} bytes`]);
    try {
      return { text: decode(buffer), bytes: buffer.length };
    } catch (error) {
      throw new InputError([`${shown}: ${error.message}`]);
    }
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError([`${shown}: ${error.code === 'ELOOP' ? 'is a symbolic link; give the file it points to' : (error.code ?? 'cannot be read')}`]);
  } finally {
    await handle?.close();
  }
}
