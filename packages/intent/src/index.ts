/**
 * All exports in this package are Service-layer capability blocks (ADR-004 §3; charter §1).
 * They return structured results and diagnostics; the orchestrator (a later slice) owns
 * run-level truth-state classification.
 */
export const PACKAGE_NAME = '@arxic/intent' as const;

export * from './canonical';
export * from './compile-bridge';
export * from './diagnostics';
export * from './normalize';
export * from './resolve';
export * from './staleness';
export * from './types';
