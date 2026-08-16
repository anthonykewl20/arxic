// DG-03 sad-path-first unit tests: the truth-state policy matrix.
// Charter §4: every sad/edge case is mapped to a truth state BEFORE the happy
// path. An LLM never assigns a truth state — the policy is a pure function of
// deterministic inputs (surface, oracle kinds, deterministic replay outcome).
import { describe, expect, it } from 'vitest';
import type { OracleKind } from '@arxic/intent';
import {
  classifyReplaySurface,
  resolveReplayTruthState,
  truthStateCap,
  type ReplaySurface,
} from '../truth-policy';

const ACCEPTANCE_ORACLES: readonly OracleKind[] = ['domain-rule'];
const OBSERVED_ONLY: readonly OracleKind[] = ['observed-only'];

describe('classifyReplaySurface (deterministic surface classification)', () => {
  it('prefers the browser surface when the intent is UI-reachable', () => {
    expect(
      classifyReplaySurface({ uiReachable: true, httpReplayable: true, independentOracle: true }),
    ).toBe<ReplaySurface>('replayable-browser');
  });

  it('classifies non-UI HTTP-replayable intents as replayable-api', () => {
    expect(
      classifyReplaySurface({ uiReachable: false, httpReplayable: true, independentOracle: true }),
    ).toBe<ReplaySurface>('replayable-api');
  });

  it('classifies oracle-backed non-replayable intents as corroborated-only', () => {
    expect(
      classifyReplaySurface({ uiReachable: false, httpReplayable: false, independentOracle: true }),
    ).toBe<ReplaySurface>('corroborated-only');
  });

  it('classifies everything else as human-approved-only (never silently dropped)', () => {
    expect(
      classifyReplaySurface({
        uiReachable: false,
        httpReplayable: false,
        independentOracle: false,
      }),
    ).toBe<ReplaySurface>('human-approved-only');
  });
});

describe('truthStateCap (ADR-008 Decision 8 caps)', () => {
  it('caps corroborated-only at observed — an oracle corroborates the expectation, not a replay', () => {
    const result = truthStateCap({ surface: 'corroborated-only', oracleKinds: ACCEPTANCE_ORACLES });
    expect(result.cap).toBe('observed');
  });

  it('caps human-approved-only at observed — approval authorizes scope, never truth (ADR-004 §2)', () => {
    const result = truthStateCap({
      surface: 'human-approved-only',
      oracleKinds: ['human-approved'],
    });
    expect(result.cap).toBe('observed');
  });

  it('caps observed-only oracle assertions at observed even on a replayable surface (ADR-004 characterization)', () => {
    for (const surface of ['replayable-browser', 'replayable-api'] as const) {
      const result = truthStateCap({ surface, oracleKinds: OBSERVED_ONLY });
      expect(result.cap).toBe('observed');
    }
  });

  it('caps mixed observed-only + acceptance oracles at observed — the weakest assertion wins', () => {
    const result = truthStateCap({
      surface: 'replayable-browser',
      oracleKinds: ['domain-rule', 'observed-only'],
    });
    expect(result.cap).toBe('observed');
  });

  it('only a replayable surface with a full acceptance oracle set can reach verified', () => {
    for (const surface of ['replayable-browser', 'replayable-api'] as const) {
      const result = truthStateCap({ surface, oracleKinds: ACCEPTANCE_ORACLES });
      expect(result.cap).toBe('verified');
    }
  });

  it('caps oracle-less intents at observed — no provenance, no verification', () => {
    const result = truthStateCap({ surface: 'replayable-browser', oracleKinds: [] });
    expect(result.cap).toBe('observed');
  });
});

describe('resolveReplayTruthState (only deterministic replay assigns verified)', () => {
  it('passes a deterministic verified replay through only for acceptance-backed replayable intents', () => {
    const result = resolveReplayTruthState({
      surface: 'replayable-api',
      oracleKinds: ACCEPTANCE_ORACLES,
      replayOutcome: 'verified',
    });
    expect(result.truthState).toBe('verified');
    expect(result.capped).toBe(false);
  });

  it('caps a characterization replay at observed even when the deterministic replay verified', () => {
    const result = resolveReplayTruthState({
      surface: 'replayable-browser',
      oracleKinds: OBSERVED_ONLY,
      replayOutcome: 'verified',
    });
    expect(result.truthState).toBe('observed');
    expect(result.capped).toBe(true);
  });

  it('never lets corroborated-only or human-approved-only surfaces reach verified', () => {
    for (const surface of ['corroborated-only', 'human-approved-only'] as const) {
      const result = resolveReplayTruthState({
        surface,
        oracleKinds: ACCEPTANCE_ORACLES,
        replayOutcome: 'verified',
      });
      expect(result.truthState).toBe('observed');
      expect(result.capped).toBe(true);
    }
  });

  it('propagates a contradicted deterministic replay (drift never silently passes)', () => {
    const result = resolveReplayTruthState({
      surface: 'replayable-browser',
      oracleKinds: ACCEPTANCE_ORACLES,
      replayOutcome: 'contradicted',
    });
    expect(result.truthState).toBe('contradicted');
  });

  it('propagates a blocked deterministic replay (missing fixtures stay blocked)', () => {
    const result = resolveReplayTruthState({
      surface: 'replayable-api',
      oracleKinds: ACCEPTANCE_ORACLES,
      replayOutcome: 'blocked',
    });
    expect(result.truthState).toBe('blocked');
  });
});
