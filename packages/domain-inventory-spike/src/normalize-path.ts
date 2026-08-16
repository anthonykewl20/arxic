import type { NormalizedPath, NormalizedSegment } from './types';

/**
 * Canonical path algebra for the fusion key. Upstream parameter syntaxes
 * observed in the wild and normalized here:
 * - Next.js App Router dynamic segments: `/users/[id]` (docs: Page conventions)
 * - Laravel route params: `/api/albums/{album}` and optional `{genre?}`
 *   (laravel/framework v13.25.0 route:list output shape)
 * - Express path params: `/users/:id`
 * The runtime crawl observes CONCRETE values (`/users/42`); matching is done by
 * `matchRuntimePath`, not by normalization.
 */
const PARAM_SYNTAX = /^(?:\[(?<next>[^\][]+)\]|\{(?<laravel>[^{}]+)\}|:(?<express>[^/:]+))$/u;

export function normalizePath(input: string): NormalizedPath {
  if (!input.startsWith('/')) {
    throw new Error(`normalizePath requires an absolute path with a leading slash: ${input}`);
  }
  const rawSegments = stripQueryAndHash(input).split('/').slice(1);
  while (rawSegments.length > 0 && rawSegments[rawSegments.length - 1] === '') {
    rawSegments.pop();
  }
  const segments: NormalizedSegment[] = rawSegments.map((raw) => {
    const match = PARAM_SYNTAX.exec(raw);
    if (match) {
      const name = match.groups?.next ?? match.groups?.laravel ?? match.groups?.express ?? '';
      return { raw, param: true, optional: name.endsWith('?') || raw.endsWith('?') };
    }
    return { raw, param: false, optional: false };
  });
  const text = `/${segments
    .map((segment) => (segment.param ? `:param${segment.optional ? '?' : ''}` : segment.raw))
    .join('/')}`;
  return { text, segments };
}

/**
 * Strip `?query` / `#fragment` per SEGMENT: a `?`/`#` inside a parameter
 * token (`{param?}`, `:id?`, `[id]?`) is part of the path (Laravel/Express
 * optional-param syntax), while one in a static segment starts a query that
 * consumes the rest of the path.
 */
function stripQueryAndHash(path: string): string {
  const segments = path.split('/');
  const stripped: string[] = [];
  for (const segment of segments.slice(1)) {
    const isParamToken = /^[[{:].*[}\]]?\??$/u.test(segment) && /^[[{:]/u.test(segment);
    if (isParamToken) {
      stripped.push(segment);
      continue;
    }
    const cut = segment.search(/[?#]/u);
    if (cut !== -1) {
      stripped.push(segment.slice(0, cut));
      return `/${stripped.join('/')}`;
    }
    stripped.push(segment);
  }
  return `/${stripped.join('/')}`;
}

/**
 * True when a CONCRETE runtime path matches a normalized (possibly
 * parameterized) source/interchange path. A `:param` segment absorbs exactly
 * one non-empty concrete segment; an optional `:param?` absorbs zero or one
 * (Laravel permits `{param?}` mid-path, so matching backtracks).
 */
export function matchRuntimePath(concrete: string, normalized: NormalizedPath): boolean {
  if (!concrete.startsWith('/')) return false;
  const concreteSegments = concrete.split('/').slice(1);
  while (concreteSegments.length > 0 && concreteSegments[concreteSegments.length - 1] === '') {
    concreteSegments.pop();
  }
  return matchesFrom(normalized.segments, 0, concreteSegments, 0);
}

function matchesFrom(
  pattern: NormalizedSegment[],
  si: number,
  concrete: string[],
  ci: number,
): boolean {
  if (si === pattern.length) return ci === concrete.length;
  const segment = pattern[si];
  if (segment.param) {
    if (segment.optional && matchesFrom(pattern, si + 1, concrete, ci)) return true;
    if (
      ci < concrete.length &&
      concrete[ci] !== '' &&
      matchesFrom(pattern, si + 1, concrete, ci + 1)
    )
      return true;
    return false;
  }
  if (ci < concrete.length && concrete[ci] === segment.raw) {
    return matchesFrom(pattern, si + 1, concrete, ci + 1);
  }
  return false;
}
