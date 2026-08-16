// DG-03 sad-path-first unit tests: observation-derived assertion derivation.
import { describe, expect, it } from 'vitest';
import { ARXIC_DG03_DERIVATION_EMPTY, ARXIC_DG03_OBSERVATION_DRIFTED } from '../diagnostics';
import { deriveAssertionsFromObservation } from '../derive-assertions';

describe('deriveAssertionsFromObservation', () => {
  it('blocks on an observation with no usable URL (never invents an assertion)', () => {
    for (const url of ['about:blank', 'data:text/plain,hi', '']) {
      const result = deriveAssertionsFromObservation({ url });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.code).toBe(ARXIC_DG03_DERIVATION_EMPTY);
        expect(result.diagnostics[0]?.severity).toBe('blocked');
      }
    }
  });

  it('blocks when the observed URL left the allowed origin (drift is not an assertion)', () => {
    const result = deriveAssertionsFromObservation({
      url: 'http://evil.example.test/dashboard',
      allowedOrigin: 'http://127.0.0.1:3210',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe(ARXIC_DG03_OBSERVATION_DRIFTED);
      expect(result.diagnostics[0]?.severity).toBe('blocked');
    }
  });

  it('derives the path-only url: assertion, dropping origin, query, and fragment', () => {
    const result = deriveAssertionsFromObservation({
      url: 'http://127.0.0.1:3210/dashboard?welcome=1#main',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assertions).toEqual([
      { kind: 'url', intent: 'url:/dashboard', expectedValue: 'url:/dashboard' },
    ]);
  });

  it('derives text: assertions from observed headings, deduped and capped', () => {
    const result = deriveAssertionsFromObservation({
      url: 'http://127.0.0.1:3210/dashboard',
      headings: ['Dashboard', 'Dashboard', 'Orders', 'Billing'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assertions.map(({ intent }) => intent)).toEqual([
      'url:/dashboard',
      'text:Dashboard',
      'text:Orders',
    ]);
  });

  it('caps text assertions at the configured maximum', () => {
    const result = deriveAssertionsFromObservation(
      { url: 'http://127.0.0.1:3210/d', headings: ['A', 'B', 'C'] },
      { maxTextAssertions: 1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assertions.map(({ intent }) => intent)).toEqual(['url:/d', 'text:A']);
  });

  it('drops empty or whitespace headings instead of emitting empty assertions', () => {
    const result = deriveAssertionsFromObservation({
      url: 'http://127.0.0.1:3210/x',
      headings: ['', '   ', 'Real Heading'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assertions.map(({ intent }) => intent)).toEqual(['url:/x', 'text:Real Heading']);
  });
});
