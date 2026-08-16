/**
 * @arxic/intent-proposal-spike — DG-04 research spike (#248).
 *
 * Everything here is Service-layer capability (charter §1): structured returns,
 * no run-level truth-state classification. The spike report lives at
 * docs/spikes/dg-04-model-proposal.md; conclusions are provisional pending
 * cross-review (ADR-008 §11).
 *
 * PROVISIONAL: the Domain Inventory consumed here is the DG-04 stand-in
 * (inventory.ts), not the DG-02 pipeline stage (#246). The consumer contract
 * is documented in inventory.ts and must be reconciled when DG-06 lands.
 */
export const PACKAGE_NAME = '@arxic/intent-proposal-spike' as const;

export * from './diagnostics';
export * from './inventory';
export * from './proposer';
export * from './schema';
export * from './scale-run';
