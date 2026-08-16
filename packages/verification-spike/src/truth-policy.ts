// DG-03 truth-state policy (ADR-008 Decision 8). Pure deterministic functions:
// an LLM is never in this loop. Only deterministic replay on a replayable
// surface with full acceptance provenance can yield `verified`; everything
// else caps at `observed` (characterization), or propagates the replay's own
// `contradicted`/`blocked` verdict.
import type { TruthState } from '@arxic/contracts';
import type { AssertionKind, OracleKind } from '@arxic/intent';

export type ReplaySurface =
  'replayable-browser' | 'replayable-api' | 'corroborated-only' | 'human-approved-only';

const ACCEPTANCE_ORACLE_KINDS: ReadonlySet<OracleKind> = new Set([
  'domain-rule',
  'repository-specification',
  'human-approved',
]);

/** Deterministic surface classification. Order is normative (ADR-008 §8). */
export function classifyReplaySurface(input: {
  uiReachable: boolean;
  httpReplayable: boolean;
  independentOracle: boolean;
}): ReplaySurface {
  if (input.uiReachable) return 'replayable-browser';
  if (input.httpReplayable) return 'replayable-api';
  if (input.independentOracle) return 'corroborated-only';
  return 'human-approved-only';
}

/**
 * The maximum truth state an intent may ever reach given its surface and its
 * oracle provenance. `verified` requires (a) a replayable surface and (b) that
 * every required assertion carries at least one independent (acceptance)
 * oracle — observed-only characterization caps at `observed` (ADR-004 §2).
 */
export function truthStateCap(input: {
  surface: ReplaySurface;
  oracleKinds: readonly OracleKind[];
}): { cap: TruthState; reason: string } {
  if (input.surface === 'corroborated-only') {
    return {
      cap: 'observed',
      reason: 'independent oracle corroborates the expectation; no deterministic replay surface',
    };
  }
  if (input.surface === 'human-approved-only') {
    return {
      cap: 'observed',
      reason: 'approval authorizes scope, never truth (ADR-004 §2)',
    };
  }
  if (input.oracleKinds.length === 0) {
    return { cap: 'observed', reason: 'assertion has no oracle provenance' };
  }
  const acceptanceCapable = input.oracleKinds.every((kind) => ACCEPTANCE_ORACLE_KINDS.has(kind));
  if (!acceptanceCapable) {
    return {
      cap: 'observed',
      reason: 'observed-only oracle is characterization; it cannot justify verified (ADR-004 §2)',
    };
  }
  return { cap: 'verified', reason: 'acceptance-backed deterministic replay may assign verified' };
}

/**
 * Resolves the final truth state from a deterministic replay outcome under the
 * cap. Replay classification itself stays with the deterministic executors
 * (browser verifier / API replay executor); this layer only applies the
 * ADR-008 §8 caps so a characterization can never be laundered into `verified`.
 */
export function resolveReplayTruthState(input: {
  surface: ReplaySurface;
  oracleKinds: readonly OracleKind[];
  replayOutcome: TruthState;
}): { truthState: TruthState; capped: boolean; reason: string } {
  const cap = truthStateCap(input);
  if (cap.cap === 'verified') {
    return { truthState: input.replayOutcome, capped: false, reason: cap.reason };
  }
  const cappedState: TruthState =
    input.replayOutcome === 'verified' ? 'observed' : input.replayOutcome;
  return {
    truthState: cappedState,
    capped: input.replayOutcome === 'verified',
    reason: cap.reason,
  };
}

/** Convenience wrapper over `truthStateCap` for already-resolved assertion kinds. */
export function capForAssertionKinds(input: {
  surface: ReplaySurface;
  assertionKinds: readonly AssertionKind[];
}): { cap: TruthState; reason: string } {
  const oracleKinds = input.assertionKinds.some((kind) => kind === 'characterization')
    ? (['observed-only'] as const)
    : (['domain-rule'] as const);
  return truthStateCap({ surface: input.surface, oracleKinds });
}
