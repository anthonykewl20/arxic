import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

function buildDigest(): string {
  let buildId = 'reference-auth-app';
  try { buildId = readFileSync('.next/BUILD_ID', 'utf8').trim(); } catch { /* dev mode has no BUILD_ID */ }
  return createHash('sha256').update(buildId).digest('hex');
}

export function GET(request: Request): Response {
  const origin = process.env.ARXIC_TARGET_ORIGIN || new URL(request.url).origin;
  return Response.json({
    environmentClass: 'local-test',
    origin,
    allowedOrigins: [origin],
    buildDigest: buildDigest(),
    nonce: process.env.ARXIC_ATTESTATION_NONCE || 'reference-auth-app-fixture-v1',
  });
}
