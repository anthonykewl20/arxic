import type { StagedBundle } from '@arxic/contracts';

export function freezeBundle(bundle: StagedBundle): Uint8Array {
  return Buffer.from(`${JSON.stringify(canonicalize(bundle))}\n`, 'utf8');
}

function canonicalize(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('bundle contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('bundle contains a cycle');
    seen.add(value);
    const result = value.map((item) => canonicalize(item, seen));
    seen.delete(value);
    return result;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new TypeError('bundle contains a cycle');
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) throw new TypeError(`bundle contains undefined at ${key}`);
      result[key] = canonicalize(item, seen);
    }
    seen.delete(value);
    return result;
  }
  throw new TypeError(`bundle contains unsupported ${typeof value}`);
}
