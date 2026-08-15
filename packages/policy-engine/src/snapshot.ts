import { sha256 } from '@arxic/contracts';
import type { PolicyAuthorization } from './policy';

export const ARXIC_POLICY_VERSION = 'arxic-policy-v1' as const;

export type PolicySnapshot = {
  policyVersion: string;
  inputSha256: string;
  decision: 'allow' | 'deny';
  timestamp: string;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function computePolicySnapshot(
  input: PolicyAuthorization,
  decision: 'allow' | 'deny',
  policyVersion: string,
  now: () => string,
): PolicySnapshot {
  const canonicalInput = {
    ...input,
    now: undefined,
    allowedOrigins: [...new Set(input.allowedOrigins)].sort(),
  };
  return {
    policyVersion,
    inputSha256: sha256(stableStringify(canonicalInput)),
    decision,
    timestamp: now(),
  };
}
