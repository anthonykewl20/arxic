import { createHash } from 'node:crypto';
import type { Diagnostic, GateResult, StagedBundle } from '@arxic/contracts';
import { validateManifest } from '@arxic/contracts';
import {
  ARXIC_PROMOTION_GATE_FAILED,
  ARXIC_PROMOTION_HASH_MISMATCH,
  ARXIC_PROMOTION_VALIDATION_FAILED,
  promotionDiagnostic,
} from './diagnostics';

export type ValidationResult = { ok: true } | { ok: false; diagnostics: Diagnostic[] };

export function validateGates(gates: GateResult[]): ValidationResult {
  const failed = gates.filter((gate) => !gate.passed);
  if (failed.length === 0) return { ok: true };
  return {
    ok: false,
    diagnostics: failed.map((gate) =>
      promotionDiagnostic(
        ARXIC_PROMOTION_GATE_FAILED,
        `gate:${gate.gate}`,
        `Promotion gate ${gate.gate} did not pass`,
      ),
    ),
  };
}

export function validateStagedBundle(bundle: StagedBundle): ValidationResult {
  const manifest = validateManifest(bundle.manifest);
  if (manifest.ok) return { ok: true };
  return {
    ok: false,
    diagnostics: [
      promotionDiagnostic(
        ARXIC_PROMOTION_VALIDATION_FAILED,
        'bundle.manifest',
        manifest.diagnostics.map((diagnostic) => diagnostic.message).join('; '),
      ),
    ],
  };
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function validateStagedBytes(bytes: Uint8Array, expectedSha256: string): ValidationResult {
  const actual = sha256(bytes);
  if (actual === expectedSha256) return { ok: true };
  return {
    ok: false,
    diagnostics: [
      promotionDiagnostic(
        ARXIC_PROMOTION_HASH_MISMATCH,
        'bundle.staged-bytes',
        `Staged SHA-256 ${actual} does not match frozen SHA-256 ${expectedSha256}`,
      ),
    ],
  };
}
