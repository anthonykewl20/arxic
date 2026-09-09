import { describe, expect, it } from 'vitest';
import { determineFinding } from '../visual-review';

const rect = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
});

/**
 * Deterministic finding determination (refs #402): the pure truth-table over
 * retained evidence — masked pixels refute, failed deterministic checks
 * confirm, anything else stays explicitly unconfirmed; missing evidence is
 * fail-closed. No determination is ever inferred beyond the recorded facts.
 */
describe('determineFinding truth table', () => {
  const masked = [rect(0, 0, 200, 50)];
  const failedCheck = {
    id: 'document-horizontal-overflow',
    verdict: 'fail' as const,
    region: rect(300, 300, 200, 100),
  };

  it('refutes findings whose region sits on masked pixels', () => {
    // Entirely inside the mask: coverage 1 relative to the finding's area.
    expect(determineFinding(rect(10, 5, 100, 30), masked, [])).toEqual({
      determination: 'refuted',
      reason: 'masked-region',
      coverage: 1,
    });
  });

  it('does not refute when the masked overlap is partial', () => {
    // The mask covers only the left half of the finding: 50%, below 60%.
    const halfMask = [rect(0, 0, 100, 50)];
    expect(determineFinding(rect(0, 0, 200, 50), halfMask, []).determination).not.toBe('refuted');
  });

  it('confirms findings corroborated by a failed deterministic check', () => {
    expect(determineFinding(rect(320, 310, 100, 80), [], [failedCheck])).toEqual({
      determination: 'confirmed',
      reason: 'deterministic-check',
      checkIds: ['document-horizontal-overflow'],
      overlap: 1,
    });
  });

  it('ignores passing checks and failed checks outside the region', () => {
    const outside = { ...failedCheck, region: rect(600, 500, 50, 50) };
    const passing = { ...failedCheck, id: 'text-contrast-1', verdict: 'pass' as const };
    // Mixed check lists are filtered by the service itself.
    expect(determineFinding(rect(320, 310, 100, 80), [], [outside, passing])).toEqual({
      determination: 'unconfirmed',
      reason: 'no-deterministic-corroboration',
    });
  });

  it('is fail-closed when the retained assessment is unavailable', () => {
    expect(determineFinding(rect(0, 0, 10, 10), undefined, undefined)).toEqual({
      determination: 'unavailable',
      reason: 'assessment-evidence-missing',
    });
  });

  it('prefers refutation when both mask and failed check overlap', () => {
    const result = determineFinding(rect(0, 0, 180, 40), masked, [
      { ...failedCheck, region: rect(0, 0, 180, 40) },
    ]);
    expect(result.determination).toBe('refuted');
  });
});
