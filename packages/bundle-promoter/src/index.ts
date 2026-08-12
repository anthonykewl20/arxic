import type {
  BundlePromoter,
  Diagnostic,
  GateResult,
  PromotionReceipt,
  StagedBundle,
} from '@arxic/contracts';
import { resolve } from 'node:path';
import { validateScreenshotArtifactSet } from '@arxic/playwright-screenshot-privacy';
import { atomicReplace } from './atomic-store';
import {
  ARXIC_PROMOTION_FREEZE_FAILED,
  ARXIC_PROMOTION_REDACTION_FAILED,
  ARXIC_PROMOTION_SCREENSHOT_PRIVACY_FAILED,
  promotionDiagnostic,
} from './diagnostics';
import { freezeBundle } from './freeze';
import { scanTextForSecrets } from './redaction-gate';
import { validateTraceArtifacts } from './trace-artifact-gate';
import { sha256, validateGates, validateStagedBundle } from './validator';

export * from './atomic-store';
export * from './bundle-assembler';
export * from './diagnostics';
export * from './freeze';
export * from './redaction-gate';
export * from './trace-artifact-gate';
export * from './validator';
export * from './verified-projection';
export const PACKAGE_NAME = '@arxic/bundle-promoter' as const;

export type BundlePromoterOptions = {
  publicPath: string;
  now?: () => string;
  lockTimeoutMs?: number;
};

export type PromotionResult =
  | { receipt: PromotionReceipt; diagnostics: [] }
  | { receipt?: undefined; diagnostics: Diagnostic[] };

export class PromotionError extends Error {
  readonly diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join('; '));
    this.name = 'PromotionError';
    this.diagnostics = diagnostics;
  }
}

export class BundlePromoterAdapter implements BundlePromoter {
  private readonly options: BundlePromoterOptions;
  constructor(options: BundlePromoterOptions) {
    this.options = options;
  }

  async promote(bundle: StagedBundle, gates: GateResult[]): Promise<PromotionReceipt> {
    const result = await this.promoteWithDiagnostics(bundle, gates);
    if (!result.receipt) throw new PromotionError(result.diagnostics);
    return result.receipt;
  }

  async promoteWithDiagnostics(
    bundle: StagedBundle,
    gates: GateResult[],
  ): Promise<PromotionResult> {
    const gateResult = validateGates(gates);
    if (!gateResult.ok) return gateResult;
    const validation = validateStagedBundle(bundle);
    if (!validation.ok) return validation;
    const traceGate = await validateTraceArtifacts(bundle.artifacts);
    if (!traceGate.ok) {
      return {
        diagnostics: [
          promotionDiagnostic(
            ARXIC_PROMOTION_REDACTION_FAILED,
            'bundle.artifacts',
            traceGate.reason,
          ),
        ],
      };
    }
    try {
      await validateScreenshotArtifactSet({ artifacts: bundle.artifacts });
    } catch {
      return {
        diagnostics: [
          promotionDiagnostic(
            ARXIC_PROMOTION_SCREENSHOT_PRIVACY_FAILED,
            'bundle.artifacts',
            'Screenshot artifacts failed the independent privacy/provenance gate',
          ),
        ],
      };
    }
    let frozen: Uint8Array;
    try {
      frozen = freezeBundle(bundle);
    } catch (error) {
      return {
        diagnostics: [
          promotionDiagnostic(
            ARXIC_PROMOTION_FREEZE_FAILED,
            'bundle',
            error instanceof Error ? error.message : String(error),
          ),
        ],
      };
    }
    const redactionDiagnostics = scanTextForSecrets(Buffer.from(frozen).toString('utf8'));
    if (redactionDiagnostics.length > 0) {
      return { diagnostics: [...redactionDiagnostics] };
    }
    const checksumSha256 = sha256(frozen);
    let receipt: PromotionReceipt;
    try {
      const promoted = JSON.parse(Buffer.from(frozen).toString('utf8')) as StagedBundle;
      receipt = {
        manifest: promoted.manifest,
        promotedAt: (this.options.now ?? (() => new Date().toISOString()))(),
        location: resolve(this.options.publicPath),
        checksumSha256,
      };
      assertReceipt(receipt);
    } catch (error) {
      return {
        diagnostics: [
          promotionDiagnostic(
            ARXIC_PROMOTION_FREEZE_FAILED,
            'promotion.receipt',
            error instanceof Error ? error.message : String(error),
          ),
        ],
      };
    }
    const stored = await atomicReplace(
      this.options.publicPath,
      frozen,
      checksumSha256,
      this.options.lockTimeoutMs,
    );
    if (!stored.ok) return stored;
    receipt.location = stored.location;
    return { receipt, diagnostics: [] };
  }
}

function assertReceipt(receipt: PromotionReceipt): void {
  const parsedDate = new Date(receipt.promotedAt);
  if (
    !receipt.manifest ||
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString() !== receipt.promotedAt ||
    !receipt.location.startsWith('/') ||
    !/^[0-9a-f]{64}$/.test(receipt.checksumSha256)
  ) {
    throw new Error('bundle promoter manufactured invalid PromotionReceipt');
  }
}
