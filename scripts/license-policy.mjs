/** Allowlisted SPDX licenses; MPL/LGPL are weak copyleft permitted for linking and Apache compatibility. */
import { readFileSync } from 'node:fs';

export const POLICY =
  'Allow: MIT, MIT-0, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, CC0-1.0, Python-2.0, BlueOak-1.0.0, CC-BY-4.0, Unlicense, WTFPL, MPL-2.0, and LGPL-2.0/2.1/3.0. MPL/LGPL are allowed weak-copyleft extensions because they are linkable and Apache-compatible; GPL, AGPL, and SSPL remain rejected.';

export function normalizeLicense(id) {
  return String(id)
    .trim()
    .toUpperCase()
    .replace(/-(?:OR-LATER|ONLY)$/u, '');
}

export const ALLOWED_LICENSES = new Set(
  [
    'MIT',
    'MIT-0',
    'Apache-2.0',
    'ISC',
    'BSD-2-Clause',
    'BSD-3-Clause',
    '0BSD',
    'CC0-1.0',
    'Python-2.0',
    'BlueOak-1.0.0',
    'CC-BY-4.0',
    'Unlicense',
    'WTFPL',
    'MPL-2.0',
    'LGPL-2.0',
    'LGPL-2.1',
    'LGPL-3.0',
  ].map(normalizeLicense),
);

const exceptions = JSON.parse(
  readFileSync(new URL('../license-exceptions.json', import.meta.url), 'utf8'),
);

function classifyId(id) {
  const normalized = normalizeLicense(id);
  if (ALLOWED_LICENSES.has(normalized)) return 'allowed';
  if (normalized === '' || normalized === 'UNKNOWN' || normalized.startsWith('SEE LICENSE IN ')) {
    return 'unknown';
  }
  if (
    /^AGPL-/u.test(normalized) ||
    /^GPL-/u.test(normalized) ||
    /^SSPL(?:-|$)/u.test(normalized) ||
    /(?:^|\s)COMMONS-CLAUSE(?:-|$)/u.test(normalized) ||
    /^BSL-/u.test(normalized) ||
    /^EUPL-/u.test(normalized) ||
    /^CC-BY-SA-/u.test(normalized) ||
    /^POLYFORM-/u.test(normalized)
  ) {
    return 'rejected';
  }
  return 'unknown';
}

export function classifyExpression(expr) {
  const input = String(expr).trim();
  if (!input) return 'unknown';
  const tokens = input.replaceAll(',', ' OR ').match(/\(|\)|\bAND\b|\bOR\b|[^()\s]+/giu);
  if (!tokens) return 'unknown';
  let position = 0;

  const combine = (left, right, operator) => {
    if (operator === 'OR') {
      if (left === 'allowed' || right === 'allowed') return 'allowed';
      if (left === 'rejected' && right === 'rejected') return 'rejected';
      return 'unknown';
    }
    if (left === 'rejected' || right === 'rejected') return 'rejected';
    if (left === 'allowed' && right === 'allowed') return 'allowed';
    return 'unknown';
  };

  const parsePrimary = () => {
    const token = tokens[position++];
    if (token === '(') {
      const result = parseOr();
      if (tokens[position++] !== ')') throw new Error('unbalanced expression');
      return result;
    }
    if (!token || token === ')' || /^(?:AND|OR)$/iu.test(token)) {
      throw new Error('invalid expression');
    }
    return classifyId(token);
  };

  const parseAnd = () => {
    let result = parsePrimary();
    while (tokens[position]?.toUpperCase() === 'AND') {
      position += 1;
      result = combine(result, parsePrimary(), 'AND');
    }
    return result;
  };

  const parseOr = () => {
    let result = parseAnd();
    while (tokens[position]?.toUpperCase() === 'OR') {
      position += 1;
      result = combine(result, parseAnd(), 'OR');
    }
    return result;
  };

  try {
    const result = parseOr();
    return position === tokens.length ? result : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function classifyPackage(pkg) {
  const classification = classifyExpression(pkg.license);
  if (classification === 'allowed') {
    return { disposition: 'allowed', reason: 'License matches the allowlist.' };
  }
  const exception = exceptions[pkg.name];
  if (exception) {
    return {
      disposition: 'allowed',
      reason: `Exception (${exception.license}): ${exception.reason}`,
    };
  }
  if (classification === 'rejected') {
    return { disposition: 'rejected', reason: 'License is explicitly rejected by policy.' };
  }
  return { disposition: 'rejected', reason: 'License is unknown or not allowlisted.' };
}
