import type { EvidenceEvent, SourceIndexer } from '@arxic/contracts';
import { validateDiagnostic, validateEvidenceRef } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import * as adapterExports from '..';
import { SOURCE_DIAGNOSTIC_CODES, SourceUaAdapter } from '..';
import { makeRepository } from './test-repo';

describe('ADR §23.14 SourceIndexer engine-upgrade contract gate', () => {
  it('returns an AsyncIterable of frozen EvidenceEvent shapes', async () => {
    const repo = await makeRepository(undefined, {
      'src/index.ts': 'export function run() { return ready(); }\n',
    });
    const indexer: SourceIndexer = new SourceUaAdapter();
    const stream = indexer.index(repo.request);
    expect(stream[Symbol.asyncIterator]).toBeTypeOf('function');
    const events: EvidenceEvent[] = [];
    for await (const event of stream) events.push(event);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const validation =
        'ref' in event ? validateEvidenceRef(event.ref) : validateDiagnostic(event.diagnostic);
      expect(validation).toMatchObject({ ok: true });
    }
  });

  it('loop-closes every exported adapter diagnostic code through the frozen validator', () => {
    const exported = (Object.values(adapterExports) as unknown[]).filter(
      (value): value is string => typeof value === 'string' && value.startsWith('ARXIC-SOURCE-'),
    );
    expect(exported.sort()).toEqual([...SOURCE_DIAGNOSTIC_CODES].sort());
    for (const code of exported) {
      expect(
        validateDiagnostic({
          code,
          severity: 'blocked',
          subject: 'contract-gate',
          message: 'test',
        }),
      ).toMatchObject({ ok: true });
    }
  });
});
