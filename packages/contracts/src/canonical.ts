import { createHash } from 'node:crypto';

/**
 * Serializes a JSON value with codepoint-sorted object keys.
 *
 * This deliberately accepts only JSON primitives, arrays, and plain records.
 * Rejecting lossy or stateful JavaScript values keeps content-addressed bytes
 * deterministic across runtimes.
 */
export function canonicalJson(
  value: unknown,
  options: { mode?: 'legacy' | 'strict'; keyOrder?: 'codepoint' | 'locale' } = {},
): string {
  const serialized = JSON.stringify(
    options.mode === 'legacy'
      ? canonicalizeLegacy(value, new WeakSet<object>(), options.keyOrder ?? 'codepoint')
      : canonicalize(value, new WeakSet<object>()),
  );
  if (serialized === undefined) throw new TypeError('canonical JSON rejects a non-JSON root value');
  return serialized;
}

/** Returns the lowercase SHA-256 digest for exactly the supplied bytes. */
export function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalize(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON rejects non-finite numbers');
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError('canonical JSON rejects cyclic values');
    ancestors.add(value);
    try {
      return value.map((item) => canonicalize(item, ancestors));
    } finally {
      ancestors.delete(value);
    }
  }
  if (isPlainRecord(value)) {
    if (ancestors.has(value)) throw new TypeError('canonical JSON rejects cyclic values');
    ancestors.add(value);
    try {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, item]) => {
            if (item === undefined)
              throw new TypeError(`canonical JSON rejects undefined at ${key}`);
            return [key, canonicalize(item, ancestors)];
          }),
      );
    } finally {
      ancestors.delete(value);
    }
  }
  throw new TypeError(`canonical JSON rejects ${value instanceof Date ? 'Date' : typeof value}`);
}

/** Compatibility mode for pre-existing serializers that relied on JSON.stringify omission rules. */
function canonicalizeLegacy(
  value: unknown,
  ancestors: WeakSet<object>,
  keyOrder: 'codepoint' | 'locale',
): unknown {
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError('canonical JSON rejects cyclic values');
    ancestors.add(value);
    try {
      return value.map((item) => canonicalizeLegacy(item, ancestors, keyOrder));
    } finally {
      ancestors.delete(value);
    }
  }
  if (value !== null && typeof value === 'object') {
    if (ancestors.has(value)) throw new TypeError('canonical JSON rejects cyclic values');
    ancestors.add(value);
    try {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          .sort(([left], [right]) =>
            keyOrder === 'locale'
              ? left.localeCompare(right)
              : left < right
                ? -1
                : left > right
                  ? 1
                  : 0,
          )
          .map(([key, item]) => [key, canonicalizeLegacy(item, ancestors, keyOrder)]),
      );
    } finally {
      ancestors.delete(value);
    }
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
