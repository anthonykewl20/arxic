/**
 * DG-03 research spike (#247): generalized verification — observation-derived
 * assertions + API-level replay. Feeds ADR-008 (Decisions 7–8); conclusions
 * are provisional pending cross-review.
 *
 * All exports are Service-layer capability blocks (charter §1): they return
 * structured results and diagnostics; the orchestrator that will own run-level
 * classification is DG-09 (#253) implementation work, not this spike.
 */
export const PACKAGE_NAME = '@arxic/verification-spike' as const;

export * from './api-replay';
export * from './derive-assertions';
export * from './diagnostics';
export * from './intent-binding';
export * from './observation';
export * from './truth-policy';
