import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { canonicalJson, type Diagnostic } from '@arxic/contracts';
import {
  EnvironmentHandshake,
  type AttestationDecision,
  type AttestationPolicy,
} from './attestation';
import { ARXIC_ATTESTATION_ARTIFACT_WRITE_FAILED, attestationDiagnostic } from './diagnostics';

export type PreflightTargetResult = Omit<AttestationDecision, 'target'> & { id: string };

export type PreflightAttestationResult = {
  results: PreflightTargetResult[];
  accepted: string[];
  refused: string[];
  artifactPath: string;
  diagnostics: Diagnostic[];
};

type PreflightAttestationInput = {
  targets: Array<{ id: string; origin: string }>;
  policy: AttestationPolicy;
  artifactsDir: string;
  now?: () => string;
};

export async function runPreflightAttestation(
  input: PreflightAttestationInput,
): Promise<PreflightAttestationResult> {
  const generatedAt = (input.now ?? (() => new Date().toISOString()))();
  const policy = { ...input.policy, now: input.policy.now ?? (() => generatedAt) };
  const handshake = new EnvironmentHandshake();
  const results: PreflightTargetResult[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const target of input.targets) {
    const result = await handshake.attest({ origin: target.origin }, policy);
    const decision = result.decision;
    results.push({
      id: target.id,
      origin: decision.origin,
      environmentClass: decision.environmentClass,
      disposition: decision.disposition,
      reason: decision.reason,
      policyVersion: decision.policyVersion,
      timestamp: decision.timestamp,
      ...(decision.override ? { override: decision.override } : {}),
    });
    diagnostics.push(...result.diagnostics);
  }

  const accepted = results
    .filter(({ disposition }) => disposition === 'allowed')
    .map(({ id }) => id);
  const refused = results
    .filter(({ disposition }) => disposition === 'refused')
    .map(({ id }) => id);
  const artifactPath = resolve(input.artifactsDir, 'preflight-attestation.json');
  const stagedPath = resolve(
    dirname(artifactPath),
    `.${basename(artifactPath)}.${randomUUID()}.stage`,
  );
  const bytes = `${canonicalJson({ targets: results, generatedAt }, { mode: 'legacy' })}\n`;

  try {
    await mkdir(dirname(artifactPath), { recursive: true });
    await writeFile(stagedPath, bytes, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(stagedPath, artifactPath);
  } catch (error) {
    await unlink(stagedPath).catch(() => undefined);
    diagnostics.push(
      attestationDiagnostic(
        ARXIC_ATTESTATION_ARTIFACT_WRITE_FAILED,
        artifactPath,
        `Could not write preflight attestation artifact: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  return { results, accepted, refused, artifactPath, diagnostics };
}
