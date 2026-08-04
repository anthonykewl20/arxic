import type { EvidenceEvent } from '@arxic/contracts';
import { validateDiagnostic, validateEvidenceRef } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import * as exports from '..';
import { AstGrepAdapter, RULES_DIAGNOSTIC_CODES } from '..';
import { makeRepository, packDirs } from './test-repo';

describe('ADR §23.14 ast-grep process-boundary contract gate', () => {
  it('returns an AsyncIterable of frozen EvidenceEvent shapes', async () => {
    const repo = await makeRepository('vulnerable-auth-app');
    const stream = new AstGrepAdapter({ packs: packDirs }).index({ revision: repo.revision });
    expect(stream[Symbol.asyncIterator]).toBeTypeOf('function');
    const events: EvidenceEvent[] = [];
    for await (const event of stream) events.push(event);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events)
      expect(
        'ref' in event ? validateEvidenceRef(event.ref) : validateDiagnostic(event.diagnostic),
      ).toMatchObject({ ok: true });
  });

  it('loop-closes every exported ARXIC-RULES code through the frozen validator', () => {
    const codes = (Object.values(exports) as unknown[]).filter(
      (value): value is string => typeof value === 'string' && value.startsWith('ARXIC-RULES-'),
    );
    expect(codes.sort()).toEqual([...RULES_DIAGNOSTIC_CODES].sort());
    for (const code of codes)
      expect(
        validateDiagnostic({
          code,
          severity: 'blocked',
          subject: 'contract-gate',
          message: 'test',
        }),
      ).toMatchObject({ ok: true });
  });
});
