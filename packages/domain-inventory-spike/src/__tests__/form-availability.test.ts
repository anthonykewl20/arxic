import { describe, expect, it } from 'vitest';
import { consumerRowId, formBackedConsumerRowIds } from '..';
import type { DomainInventory, InventoryRow } from '../types';

/**
 * #324 AC-3 (Cause C): stage 4 proposes from the SOURCE inventory, built at
 * stage 13 BEFORE the crawl, so `observedForms` is necessarily `[]` at
 * proposal time. The post-crawl re-proposal pass needs to know which rows the
 * crawl actually found a form for.
 *
 * The signal deliberately travels BESIDE the rows as a set of consumer row
 * ids, NEVER as a new field on `ProposalConsumerRow`: that type is a
 * type-only alias of the FROZEN `@arxic/intent-proposal-spike` `InventoryRow`,
 * held by an `Equal<>` lockstep assertion in `consumer-adapter.test.ts`.
 * Adding a field there would either edit frozen spike evidence or break the
 * lockstep. Sad paths first.
 */

function row(overrides: Partial<InventoryRow> = {}): InventoryRow {
  return {
    key: 'POST /login',
    surfaceKind: 'endpoint',
    method: 'POST',
    path: '/login',
    origin: 'source',
    sourceRefs: [
      {
        kind: 'source',
        repo: 'https://example.test/app',
        commit: 'a'.repeat(40),
        path: 'routes/web.php',
        startLine: 1,
        endLine: 2,
        extractor: 'laravel-routes',
      },
    ],
    runtimeRefs: [],
    runtimeUrls: [],
    observedForms: [],
    disposition: 'extracted',
    reason: '',
    domain: 'auth',
    verbs: ['create'],
    count: 1,
    ...overrides,
  } as InventoryRow;
}

function inventory(rows: InventoryRow[]): DomainInventory {
  return { rows } as unknown as DomainInventory;
}

describe('formBackedConsumerRowIds (#324 AC-3 crawl-form availability signal)', () => {
  it('returns an EMPTY set for a pre-crawl inventory (the Cause C condition)', () => {
    // Stage 13 builds this shape; nothing has been crawled yet.
    expect(formBackedConsumerRowIds(inventory([row()])).size).toBe(0);
  });

  it('names a row the crawl found a form for', () => {
    const backed = row({
      observedForms: [{ action: '/login', method: 'POST', destructive: false }],
    });
    const ids = formBackedConsumerRowIds(inventory([backed]));
    expect([...ids]).toEqual([
      consumerRowId({ surface: 'route', method: 'POST', key: 'POST /login' }),
    ]);
  });

  it('EXCLUDES a form-backed row that is not `extracted` — it can never be grounded', () => {
    // packages/intent/src/ledger.ts:376 gives non-extracted rows no
    // inventoryRowId, so a proposal could never cite one. Offering it to the
    // model would manufacture an uncitable proposal. Fail closed.
    const backed = row({
      disposition: 'unextracted-with-reason',
      reason: 'source-scan-diagnostic:ARXIC-SOURCE-BINARY-FILE',
      observedForms: [{ action: '/login', method: 'POST', destructive: false }],
    });
    expect(formBackedConsumerRowIds(inventory([backed])).size).toBe(0);
  });

  it('is deterministic and deduped across many rows', () => {
    const rows = [
      row({
        key: 'POST /a',
        path: '/a',
        observedForms: [{ action: '/a', method: 'POST', destructive: false }],
      }),
      row({
        key: 'POST /b',
        path: '/b',
        observedForms: [{ action: '/b', method: 'POST', destructive: true }],
      }),
      row({ key: 'POST /c', path: '/c' }),
    ];
    const first = [...formBackedConsumerRowIds(inventory(rows))].sort();
    const second = [...formBackedConsumerRowIds(inventory([...rows].reverse()))].sort();
    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
  });

  it('tolerates a missing observedForms array rather than throwing', () => {
    const malformed = { ...row(), observedForms: undefined } as unknown as InventoryRow;
    expect(() => formBackedConsumerRowIds(inventory([malformed]))).not.toThrow();
    expect(formBackedConsumerRowIds(inventory([malformed])).size).toBe(0);
  });
});
