import { canonicalJson as serializeCanonicalJson, sha256 } from '@arxic/contracts';
import type { IntentSpec } from './types';

const serializeIntentValue = (value: unknown): string => {
  try {
    return serializeCanonicalJson(value);
  } catch {
    throw new Error('intent canonicalization received a non-plain value', {
      cause: { type: typeof value },
    });
  }
};

export { serializeIntentValue as canonicalJson };

export function canonicalizeIntentSpec(spec: IntentSpec): {
  canonicalJson: string;
  canonicalSha256: string;
} {
  const canonical = serializeIntentValue(spec);
  return {
    canonicalJson: canonical,
    canonicalSha256: sha256(canonical),
  };
}
