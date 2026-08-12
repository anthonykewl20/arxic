import { BundlePromoterAdapter } from '@arxic/bundle-promoter';
import type { GateResult, PromotionReceipt, StagedBundle } from '@arxic/contracts';

/**
 * Keep the irreversible stage-12 publish in the trusted orchestrator boundary.
 * Worker mode supplies only the validated candidate and deterministic gates.
 */
export function promoteWorkerCandidate(
  input: Readonly<{
    bundle: StagedBundle;
    gates: readonly GateResult[];
    publicPath: string;
    now?: () => string;
  }>,
): Promise<PromotionReceipt> {
  return new BundlePromoterAdapter({
    publicPath: input.publicPath,
    ...(input.now ? { now: input.now } : {}),
  }).promote(input.bundle, [...input.gates]);
}
