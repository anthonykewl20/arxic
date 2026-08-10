import { createHash } from 'node:crypto';
import type { IntentSpec } from './types';

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(sortValue);
  if (
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.prototype.toString.call(value) === '[object Object]')
  ) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => codepointCompare(left, right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  throw new Error('intent canonicalization received a non-plain value', {
    cause: { type: typeof value },
  });
}

export function canonicalizeIntentSpec(spec: IntentSpec): {
  canonicalJson: string;
  canonicalSha256: string;
} {
  const canonical = canonicalJson(spec);
  return {
    canonicalJson: canonical,
    canonicalSha256: createHash('sha256').update(canonical).digest('hex'),
  };
}
