import { describe, expect, it } from 'vitest';
import {
  LEGACY_STAGE_EXECUTION_ORDER,
  STAGE_EXECUTION_ORDER,
  isStageExecutionPrefix,
  matchingStageExecutionOrder,
} from '../stage-order';

/**
 * STAGE_EXECUTION_ORDER invariants (DG-06 #250): the exported order is the
 * single source of truth for consumers that validate stage sequences (the
 * CLI's worker-result normalization consumes it verbatim). It must be a
 * permutation of the stage ids and must place stage 13 between 2 and 3
 * (position ≠ id). The full-run equality to the ACTUAL orchestrator execution
 * order is asserted in inventory-stage.test.ts (completedStages deep-equals
 * this constant), so constant ↔ topology drift is machine-caught.
 *
 * `isStageExecutionPrefix` carries the mandated no-weakening contract
 * (exception 2 on #250), sad paths FIRST.
 */
describe('STAGE_EXECUTION_ORDER (canonical execution order)', () => {
  it('is a permutation of the stage ids 0–13 (every stage exactly once)', () => {
    expect(STAGE_EXECUTION_ORDER.length).toBe(14);
    expect(new Set(STAGE_EXECUTION_ORDER).size).toBe(14);
    expect([...STAGE_EXECUTION_ORDER].sort((left, right) => left - right)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });

  it('places stage 13 (id) at position 3, between structural extraction and framework rules', () => {
    expect(STAGE_EXECUTION_ORDER.slice(0, 4)).toEqual([0, 1, 2, 13]);
    expect(STAGE_EXECUTION_ORDER[4]).toBe(3);
    expect(STAGE_EXECUTION_ORDER.at(-1)).toBe(12);
  });

  it('diverges from the legacy order exactly at position 3 (id ≠ position)', () => {
    expect(LEGACY_STAGE_EXECUTION_ORDER.slice(0, 3)).toEqual(STAGE_EXECUTION_ORDER.slice(0, 3));
    expect(LEGACY_STAGE_EXECUTION_ORDER[3]).toBe(3);
    expect(STAGE_EXECUTION_ORDER[3]).toBe(13);
  });
});

describe('isStageExecutionPrefix (sequence validation)', () => {
  it('rejects a genuinely out-of-order sequence', () => {
    expect(isStageExecutionPrefix([0, 2, 1, 3])).toBe(false);
  });

  it('rejects a sequence missing an intermediate stage (gap mid-sequence)', () => {
    expect(isStageExecutionPrefix([0, 1, 2, 13, 3, 4, 6])).toBe(false);
    expect(isStageExecutionPrefix([0, 1, 2, 4])).toBe(false);
  });

  it('rejects a misplaced stage 13 (numeric-sorted is not canonical)', () => {
    expect(isStageExecutionPrefix([0, 1, 2, 3, 13, 4])).toBe(false);
  });

  it('rejects duplicates and unknown ids', () => {
    expect(isStageExecutionPrefix([0, 1, 2, 13, 3, 3])).toBe(false);
    expect(isStageExecutionPrefix([0, 99])).toBe(false);
  });

  it('accepts the real full execution sequence [0,1,2,13,3,…,12]', () => {
    expect(isStageExecutionPrefix(STAGE_EXECUTION_ORDER)).toBe(true);
    expect(isStageExecutionPrefix([0, 1, 2, 13, 3])).toBe(true);
  });

  it('accepts incomplete-but-gapless 0–12-only prefixes unchanged (legacy worker results)', () => {
    for (const length of [1, 4, 11, 13]) {
      expect(
        isStageExecutionPrefix(LEGACY_STAGE_EXECUTION_ORDER.slice(0, length)),
        `legacy prefix of length ${length}`,
      ).toBe(true);
    }
    expect(isStageExecutionPrefix([])).toBe(true);
  });

  it('resolves both kinds of prefixes to their order (selector); short prefixes resolve to the current order', () => {
    expect(matchingStageExecutionOrder([0, 1, 2, 13, 3])).toBe(STAGE_EXECUTION_ORDER);
    expect(matchingStageExecutionOrder([0, 1, 2, 3])).toBe(LEGACY_STAGE_EXECUTION_ORDER);
    // The orders agree on the first 3 positions: the CURRENT order wins ties.
    expect(matchingStageExecutionOrder([0, 1, 2])).toBe(STAGE_EXECUTION_ORDER);
    expect(matchingStageExecutionOrder([0, 2])).toBeUndefined();
  });
});
