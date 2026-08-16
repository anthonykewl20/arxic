import { normalizeIntentSpec } from '@arxic/intent';
import { describe, expect, it } from 'vitest';

const baseProposal = {
  domain: 'billing',
  intent: 'pay an outstanding invoice',
  action: 'submit payment for an invoice',
  fromState: 'invoice-unpaid',
  toState: 'invoice-paid',
  persona: 'account-owner',
  inventoryRowIds: ['inv:route:POST:/invoices:00000000:12'],
  evidenceRefIds: ['src:api-invoices-ts:12-30'],
  rationale: 'POST /invoices handler mutates invoice state.',
};

describe('deterministic dedupe and ledger merge', () => {
  it('collapses exact duplicates and identical (domain, action, row set) variants deterministically', async () => {
    const { dedupeProposals } = await import('../proposer');
    const variant = {
      ...baseProposal,
      rationale: 'reworded rationale',
      intent: 'Pay an Outstanding Invoice',
    };
    const { kept, dropped } = dedupeProposals([variant, { ...baseProposal }, { ...baseProposal }]);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(2);
    expect(dropped.every((d) => d.diagnostic.code === 'ARXIC-PROPOSAL-DUPLICATE')).toBe(true);
  });

  it('keeps distinct intents that cite the same inventory row (multi-journey surfaces)', async () => {
    const { dedupeProposals } = await import('../proposer');
    const other = { ...baseProposal, intent: 'download an invoice PDF' };
    const { kept } = dedupeProposals([{ ...baseProposal }, other]);
    expect(kept).toHaveLength(2);
  });

  it('merges cross-run ledgers idempotently', async () => {
    const { mergeLedger } = await import('../proposer');
    const bound = (id: string) => ({
      ...baseProposal,
      id,
      truthState: 'hypothesized' as const,
      boundEvidenceRefs: [],
    });
    const first = mergeLedger([], [bound('prop:abc')]);
    expect(first.proposals).toHaveLength(1);
    const second = mergeLedger(first.proposals, [bound('prop:abc')]);
    expect(second.proposals).toHaveLength(1);
    expect(second.dropped).toHaveLength(1);
  });
});

describe('batching partitioning and token estimator (cost model)', () => {
  it('groups rows per domain hint and chunks oversized groups', async () => {
    const { partitionRows } = await import('../proposer');
    const rows = [1, 2, 3, 4].map((n) => ({
      id: `inv:route:GET:/r${n}:0000000${n}:1`,
      surface: 'route' as const,
      method: 'GET',
      path: `/r${n}`,
      sourcePath: `src/r${n}.ts`,
      domainHint: n % 2 === 0 ? 'alpha' : 'beta',
      evidenceIds: [`src:src-r${n}-ts:1-2`],
    }));
    const batches = partitionRows(rows, { kind: 'per-domain', maxRowsPerCall: 1 });
    expect(batches).toHaveLength(4);
    for (const batch of batches) {
      expect(new Set(batch.rows.map((row) => row.domainHint)).size).toBe(1);
      expect(batch.rows.length).toBeLessThanOrEqual(1);
    }
    const oneShot = partitionRows(rows, { kind: 'one-shot' });
    expect(oneShot).toHaveLength(1);
    expect(oneShot[0]?.rows).toHaveLength(4);
  });

  it('estimates prompt tokens linearly in rows plus a fixed overhead (hand-checked)', async () => {
    const { estimatePromptTokens, buildProposerMessages } = await import('../proposer');
    const row = {
      id: 'inv:route:GET:/r1:00000001:1',
      surface: 'route' as const,
      method: 'GET',
      path: '/r1',
      sourcePath: 'src/r1.ts',
      domainHint: 'beta',
      evidenceIds: ['src:src-r1-ts:1-2'],
    };
    const one = estimatePromptTokens([row]);
    const two = estimatePromptTokens([row, row]);
    const four = estimatePromptTokens([row, row, row, row]);
    // Linear growth in row count: doubling the row delta doubles the token
    // delta (within ceil rounding of the chars/4 estimate).
    expect(Math.abs(four - two - 2 * (two - one))).toBeLessThanOrEqual(2);
    expect(one).toBeGreaterThan(0);
    // The estimator must match the actual serialized message it claims to estimate.
    const messages = buildProposerMessages([row, row, row, row], 1);
    const serialized = messages.map((m) => m.content).join('\n');
    expect(estimatePromptTokens([row, row, row, row])).toBe(Math.ceil(serialized.length / 4));
  });
});

describe('IntentSpec bridge (ADR-004 compatibility)', () => {
  it('maps a bound proposal to a normalize-valid IntentSpecInput as hypothesized-only', async () => {
    const { toIntentSpecInput, bindProposals } = await import('../proposer');
    const evidenceIndex = {
      'src:api-invoices-ts:12-30': {
        kind: 'source' as const,
        repo: 'file:///fixture',
        commit: 'a'.repeat(40),
        path: 'api/invoices.ts',
        startLine: 12,
        endLine: 30,
        blobSha256: '0'.repeat(64),
        extractor: 'tree-sitter-typescript@0.25.0',
        ruleId: 'route:POST /invoices',
      },
    };
    const inventory = {
      kind: 'arxic-domain-inventory-standin-v1' as const,
      standIn: true as const,
      rows: [
        {
          id: 'inv:route:POST:/invoices:00000000:12',
          surface: 'route' as const,
          method: 'POST',
          path: '/invoices',
          sourcePath: 'api/invoices.ts',
          domainHint: 'invoices',
          evidenceIds: ['src:api-invoices-ts:12-30'],
        },
      ],
      source: { tool: 'source-ua-adapter', commit: 'a'.repeat(40), repository: 'file:///fixture' },
      diagnostics: [],
    };
    const bound = bindProposals(
      { schemaVersion: 'arxic-intent-proposal-v1', proposals: [{ ...baseProposal }] },
      { inventory, evidenceIndex },
    );
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    const specInput = toIntentSpecInput(bound.proposals[0], {
      commit: 'a'.repeat(40),
      appBuildDigest: 'b'.repeat(64),
      fixtureSeedDigest: 'c'.repeat(64),
      featureFlagsDigest: 'd'.repeat(64),
      policyDigest: 'e'.repeat(64),
    });
    const normalized = normalizeIntentSpec(specInput);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.spec.domain).toBe('billing');
      expect(normalized.spec.proposals[0]?.evidenceRefs.source).toContain(
        'src:api-invoices-ts:12-30',
      );
    }
  });
});
