import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_ATTESTATION_TIMEOUT_MS = 10_000;

export type TargetAttestation = {
  environmentClass: string;
  origin: string;
  allowedOrigins: string[];
  buildDigest: string;
  nonce: string;
  signedReceipt?: string;
};

export function parseAttestation(input: unknown): TargetAttestation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Attestation must be an object');
  }
  const value = input as Record<string, unknown>;
  if (
    typeof value.environmentClass !== 'string' ||
    typeof value.origin !== 'string' ||
    !Array.isArray(value.allowedOrigins) ||
    value.allowedOrigins.some((origin) => typeof origin !== 'string') ||
    typeof value.buildDigest !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(value.buildDigest) ||
    typeof value.nonce !== 'string' ||
    value.nonce.length === 0 ||
    (value.signedReceipt !== undefined && typeof value.signedReceipt !== 'string')
  ) {
    throw new Error('Attestation shape is invalid');
  }
  return value as TargetAttestation;
}

export async function fetchAttestation(
  origin: string,
  timeoutMs = DEFAULT_ATTESTATION_TIMEOUT_MS,
): Promise<TargetAttestation> {
  const endpoint = new URL('/.well-known/arxic-test-target.json', origin);
  const response = await fetch(endpoint, {
    headers: { accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Attestation endpoint returned HTTP ${response.status}`);
  return parseAttestation(await response.json());
}

export function validSignedReceipt(attestation: TargetAttestation, key: string): boolean {
  if (!attestation.signedReceipt || !/^[a-f0-9]{64}$/i.test(attestation.signedReceipt))
    return false;
  const expected = createHmac('sha256', key)
    .update(`${attestation.buildDigest}.${attestation.nonce}`)
    .digest();
  const received = Buffer.from(attestation.signedReceipt, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
