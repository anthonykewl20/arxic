import type { AttestationPolicy } from './attestation';

export const OPERATOR_ALLOWED_ORIGINS_ENV = 'ARXIC_ATTESTATION_ALLOWED_ORIGINS' as const;
export const RECEIPT_KEY_ENV = 'ARXIC_ATTESTATION_RECEIPT_KEY' as const;

export type BuildAttestationPolicyInput = Readonly<{
  origin: string;
  expectedBuildDigest?: string;
  expectedNonce?: string;
  operatorAllowedOrigins?: readonly string[];
  receiptKey?: string;
  now?: () => string;
}>;

/** Builds policy only from operator-side inputs; no served attestation field is authoritative. */
export function buildAttestationPolicy(input: BuildAttestationPolicyInput): AttestationPolicy {
  return {
    allowedOrigins: [...(input.operatorAllowedOrigins ?? [])],
    localTestAllowedOrigins: [input.origin],
    allowedEnvironmentClasses: ['local-test', 'preview'],
    ...(input.receiptKey ? { receiptKey: input.receiptKey } : {}),
    ...(input.expectedNonce ? { expectedNonce: input.expectedNonce } : {}),
    ...(input.expectedBuildDigest ? { expectedBuildDigest: input.expectedBuildDigest } : {}),
    ...(input.now ? { now: input.now } : {}),
  };
}

export function operatorAttestationSettings(
  environment: NodeJS.ProcessEnv,
): Pick<BuildAttestationPolicyInput, 'operatorAllowedOrigins' | 'receiptKey'> {
  const operatorAllowedOrigins = (environment[OPERATOR_ALLOWED_ORIGINS_ENV] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const receiptKey = environment[RECEIPT_KEY_ENV]?.trim();
  return {
    operatorAllowedOrigins,
    ...(receiptKey ? { receiptKey } : {}),
  };
}
