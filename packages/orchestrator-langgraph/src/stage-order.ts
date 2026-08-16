import type { StageId } from './types';

/**
 * The canonical STAGE EXECUTION ORDER — the single source of truth for "which
 * stage runs after which" (DG-06 #250).
 *
 * Stage 13 (`domain-inventory`) uses the next AVAILABLE id (ids 0–12 are
 * stable for compatibility) but EXECUTES between structural extraction (2)
 * and framework rules (3) — the ADR-008 Consequences numbering decision
 * recorded at DG-06. Stage ID ≠ execution POSITION, and consumers that
 * validate stage sequences (the CLI's worker-result normalization, the
 * worker's StageId mirror) MUST consume THIS module rather than re-deriving
 * or hand-maintaining an order — the drift class this export exists to close.
 *
 * Topology is pinned by tests: the orchestrator suites assert a full run's
 * `completedStages` deep-equals this order, and this constant is a
 * permutation of STAGES in `orchestrator.ts` (every stage exactly once).
 */
export const STAGE_EXECUTION_ORDER: readonly StageId[] = [
  0, 1, 2, 13, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
] as const;

/**
 * The pre-stage-13 execution order (ids 0–12 in sequence). Results produced
 * by workers built BEFORE DG-06 are prefixes of this order and must keep
 * validating unchanged (backward compatibility): a legacy `[0,1,2,3,…]`
 * sequence is NOT a prefix of the current order, which diverges at position 3.
 */
export const LEGACY_STAGE_EXECUTION_ORDER: readonly StageId[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
] as const;

/** True when `stages` is a gapless prefix of `order` (position-exact, in order). */
function isPrefixOf(stages: readonly number[], order: readonly StageId[]): boolean {
  return (
    stages.length <= order.length &&
    order.slice(0, stages.length).every((expected, index) => stages[index] === expected)
  );
}

/**
 * True when a stage sequence is a complete, gapless prefix of a KNOWN
 * execution order: the current order (stage 13 between 2 and 3) or the
 * legacy 0–12 order (pre-DG-06 worker results). Sequence position is compared
 * against the canonical order, never against the stage id — a stage id is not
 * a position. Anything else (out-of-order, gaps, unknown ids, misplaced 13)
 * is rejected. Exported so sequence consumers validate against the
 * orchestrator's truth instead of re-deriving it.
 */
export function isStageExecutionPrefix(stages: readonly number[]): boolean {
  return matchingStageExecutionOrder(stages) !== undefined;
}

/**
 * The KNOWN execution order a sequence is a gapless prefix of (the CURRENT
 * order when both match — they agree on the first 3 positions), or undefined
 * when the sequence is not a prefix of any known order. Consumers that
 * validate multiple related sequences (checkpoints AND completed stages of
 * one pipeline result) should require BOTH to resolve to the SAME order, so a
 * mixed envelope (checkpoints in current order, completed stages in legacy
 * order, or vice versa) is rejected exactly like the id≡position check it
 * replaces.
 */
export function matchingStageExecutionOrder(
  stages: readonly number[],
): readonly StageId[] | undefined {
  if (isPrefixOf(stages, STAGE_EXECUTION_ORDER)) return STAGE_EXECUTION_ORDER;
  if (isPrefixOf(stages, LEGACY_STAGE_EXECUTION_ORDER)) return LEGACY_STAGE_EXECUTION_ORDER;
  return undefined;
}
