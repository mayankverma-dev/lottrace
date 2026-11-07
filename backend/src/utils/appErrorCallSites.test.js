const fs = require('fs');
const path = require('path');

const SRC_ROOT = path.join(__dirname, '..');
const STATUS_CODE = /^\d{3}$/;

/**
 * Recursively lists source files, skipping test files.
 * @param {string} directory
 * @returns {string[]}
 */
const listSourceFiles = (directory) => {
  const entries = fs.readdirSync(directory, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return listSourceFiles(fullPath);
    }

    if (!entry.name.endsWith('.js') || entry.name.endsWith('.test.js')) {
      return [];
    }

    return [fullPath];
  });
};

/**
 * Extracts the top-level arguments of every `new AppError(...)` call.
 *
 * Tracks quotes, nested brackets and comments so commas inside a message,
 * object literal or nested call do not split the argument list.
 *
 * @param {string} source
 * @returns {string[][]}
 */
const extractAppErrorArguments = (source) => {
  const calls = [];
  const marker = 'new AppError(';
  let searchFrom = 0;

  while (true) {
    const markerIndex = source.indexOf(marker, searchFrom);
    if (markerIndex === -1) break;

    let depth = 1;
    let quote = null;
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;
    let current = '';
    const args = [];
    let index = markerIndex + marker.length;

    for (; index < source.length && depth > 0; index += 1) {
      const char = source[index];
      const next = source[index + 1];

      if (inLineComment) {
        if (char === '\n') inLineComment = false;
        continue;
      }

      if (inBlockComment) {
        if (char === '*' && next === '/') {
          inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (quote) {
        current += char;
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (char === '/' && next === '/') {
        inLineComment = true;
        index += 1;
        continue;
      }

      if (char === '/' && next === '*') {
        inBlockComment = true;
        index += 1;
        continue;
      }

      if (char === "'" || char === '"' || char === '`') {
        quote = char;
        current += char;
        continue;
      }

      if (char === '(' || char === '[' || char === '{') {
        depth += 1;
        current += char;
        continue;
      }

      if (char === ')' || char === ']' || char === '}') {
        depth -= 1;

        if (depth === 0) {
          args.push(current.trim());
          break;
        }

        current += char;
        continue;
      }

      if (char === ',' && depth === 1) {
        args.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    calls.push(args);
    searchFrom = index + 1;
  }

  return calls;
};

describe('AppError call sites', () => {
  it('uses AppError(message, code, statusCode) everywhere', () => {
    const offenders = [];

    for (const file of listSourceFiles(SRC_ROOT)) {
      const source = fs.readFileSync(file, 'utf8');
      const relativePath = path.relative(SRC_ROOT, file);

      for (const args of extractAppErrorArguments(source)) {
        const valid =
          args.length >= 3 &&
          !STATUS_CODE.test(args[1]) &&
          STATUS_CODE.test(args[2]);

        if (!valid) {
          offenders.push(`${relativePath}: new AppError(${args.join(', ')})`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
