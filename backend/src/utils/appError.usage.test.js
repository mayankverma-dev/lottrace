/**
 * P1-13 regression guard — every AppError call in backend source must use the
 * documented signature: (message, code, statusCode).
 *
 * A numeric second argument puts the HTTP status into the `code` slot and
 * leaves `statusCode` undefined, which makes the global error handler emit a
 * bare 500 instead of the intended 4xx envelope.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_ROOT = path.resolve(__dirname, '..');

/**
 * Lists backend source files, excluding tests.
 * @param {string} dir
 * @returns {string[]}
 */
const listSourceFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return listSourceFiles(fullPath);
    }

    if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      return [fullPath];
    }

    return [];
  });

/**
 * Removes line and block comments while preserving string literals.
 * @param {string} source
 * @returns {string}
 */
const stripComments = (source) => {
  let result = '';
  let quote = null;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      result += char;
      if (char === '\\') {
        result += next || '';
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      result += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      result += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 1;
      result += ' ';
      continue;
    }

    result += char;
  }

  return result;
};

/**
 * Splits the top-level arguments of a call, starting at its opening paren.
 * @param {string} source
 * @param {number} openingParenIndex
 * @returns {string[]|null}
 */
const splitArguments = (source, openingParenIndex) => {
  const args = [];
  let current = '';
  let depth = 0;
  let quote = null;

  for (let index = openingParenIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      current += char;
      if (char === '\\') {
        current += next || '';
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(') {
      depth += 1;
      if (depth === 1) {
        continue;
      }
    }

    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        args.push(current.trim());
        return args;
      }
    }

    if (char === ',' && depth === 1) {
      args.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  return null;
};

/**
 * Finds every `new AppError(...)` call in a source string.
 * @param {string} source
 * @returns {string[][]}
 */
const findAppErrorCalls = (source) => {
  const code = stripComments(source);
  const pattern = /new\s+AppError\s*\(/g;
  const calls = [];
  let match = pattern.exec(code);

  while (match) {
    const openingParenIndex = match.index + match[0].length - 1;
    const args = splitArguments(code, openingParenIndex);

    if (args) {
      calls.push(args);
    }

    match = pattern.exec(code);
  }

  return calls;
};

/**
 * @param {string} argument
 * @returns {boolean}
 */
const isStringLiteral = (argument) => {
  const trimmed = argument.trim();
  const first = trimmed[0];
  return (first === "'" || first === '"' || first === '`') && trimmed.endsWith(first);
};

/**
 * @param {string} argument
 * @returns {boolean}
 */
const isNumericLiteral = (argument) => /^\d{3}$/.test(argument.trim());

const sourceFiles = listSourceFiles(SOURCE_ROOT);

describe('AppError call sites', () => {
  it('scans the backend source tree', () => {
    expect(sourceFiles).toEqual(
      expect.arrayContaining([
        path.join(SOURCE_ROOT, 'modules/notifications/notifications.controller.js'),
        path.join(SOURCE_ROOT, 'modules/events/events.service.js'),
      ])
    );
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  it('uses (message, string code, numeric status) everywhere', () => {
    const failures = [];
    let callCount = 0;

    for (const file of sourceFiles) {
      const source = fs.readFileSync(file, 'utf8');

      for (const args of findAppErrorCalls(source)) {
        callCount += 1;
        const relativePath = path.relative(SOURCE_ROOT, file);
        const label = `${relativePath}: new AppError(${args.join(', ')})`;

        if (args.length < 3) {
          failures.push(`${label} — missing status code argument`);
          continue;
        }

        if (!isStringLiteral(args[0])) {
          failures.push(`${label} — message is not a string literal`);
        }

        if (!isStringLiteral(args[1])) {
          failures.push(`${label} — code is not a string literal`);
        }

        if (!isNumericLiteral(args[2])) {
          failures.push(`${label} — status is not a numeric literal`);
        }
      }
    }

    expect(failures).toEqual([]);
    expect(callCount).toBeGreaterThan(50);
  });
});

describe('AppError call scanner', () => {
  it('accepts the correct signature', () => {
    const calls = findAppErrorCalls("throw new AppError('Not found', 'NOT_FOUND', 404);");

    expect(calls).toEqual([["'Not found'", "'NOT_FOUND'", '404']]);
    expect(isStringLiteral(calls[0][1])).toBe(true);
    expect(isNumericLiteral(calls[0][2])).toBe(true);
  });

  it('flags a numeric second argument', () => {
    const calls = findAppErrorCalls("throw new AppError('Notification not found', 404);");

    expect(calls).toEqual([["'Notification not found'", '404']]);
    expect(calls[0].length).toBeLessThan(3);
    expect(isStringLiteral(calls[0][1])).toBe(false);
  });

  it('parses multi-line calls and ignores comments', () => {
    const source = [
      '// new AppError("ignored", 404);',
      'throw new AppError(',
      "  'Rate limited',",
      "  'RATE_LIMITED',",
      '  429',
      ');',
    ].join('\n');

    expect(findAppErrorCalls(source)).toEqual([
      ["'Rate limited'", "'RATE_LIMITED'", '429'],
    ]);
  });
});
