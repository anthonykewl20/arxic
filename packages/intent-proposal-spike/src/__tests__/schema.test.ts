import { describe, expect, it } from 'vitest';

const VALID_OUTPUT = {
  schemaVersion: 'arxic-intent-proposal-v1',
  proposals: [
    {
      domain: 'billing',
      intent: 'pay an outstanding invoice',
      action: 'submit payment for an invoice',
      fromState: 'invoice-unpaid',
      toState: 'invoice-paid',
      persona: 'account-owner',
      inventoryRowIds: ['inv:route:POST:/invoices:00000000:12'],
      evidenceRefIds: ['src:api-invoices-ts:12-30'],
      rationale: 'POST /invoices handler mutates invoice state.',
    },
  ],
};

describe('intent proposal schema vNext (arxic-intent-proposal-v1)', () => {
  it('accepts a minimal valid arbitrary-domain proposal output', async () => {
    const { validateProposalOutput, INTENT_PROPOSAL_SCHEMA_VERSION } = await import('../schema');
    expect(INTENT_PROPOSAL_SCHEMA_VERSION).toBe('arxic-intent-proposal-v1');
    const result = validateProposalOutput(VALID_OUTPUT);
    expect(result).toMatchObject({ ok: true });
  });

  it('rejects a non-auth-flavoured domain string no more strictly than any other (no auth bias)', async () => {
    const { validateProposalOutput } = await import('../schema');
    for (const domain of ['authentication', 'billing', 'inventory-management', 'z-a9.']) {
      const result = validateProposalOutput({
        ...VALID_OUTPUT,
        proposals: [{ ...VALID_OUTPUT.proposals[0], domain }],
      });
      expect(result).toMatchObject({ ok: true });
    }
  });

  it('rejects outputs with no schemaVersion, unknown extra fields, or empty citation arrays', async () => {
    const { validateProposalOutput } = await import('../schema');
    const noVersion = structuredClone(VALID_OUTPUT);
    delete (noVersion as { schemaVersion?: string }).schemaVersion;
    expect(validateProposalOutput(noVersion).ok).toBe(false);
    expect(
      validateProposalOutput({
        ...VALID_OUTPUT,
        truthState: 'verified',
      }).ok,
    ).toBe(false);
    expect(
      validateProposalOutput({
        ...VALID_OUTPUT,
        proposals: [{ ...VALID_OUTPUT.proposals[0], inventoryRowIds: [] }],
      }).ok,
    ).toBe(false);
    expect(
      validateProposalOutput({
        ...VALID_OUTPUT,
        proposals: [{ ...VALID_OUTPUT.proposals[0], evidenceRefIds: [] }],
      }).ok,
    ).toBe(false);
    expect(
      validateProposalOutput({
        ...VALID_OUTPUT,
        proposals: [{ ...VALID_OUTPUT.proposals[0], domain: '' }],
      }).ok,
    ).toBe(false);
    // A model may NEVER assert a truth state: the field simply does not exist in vNext.
    expect(JSON.stringify(await import('../schema')).includes('truthState')).toBe(false);
  });

  it('bounds every free-text field and forbids control characters (injection surface)', async () => {
    const { validateProposalOutput } = await import('../schema');
    expect(
      validateProposalOutput({
        ...VALID_OUTPUT,
        proposals: [{ ...VALID_OUTPUT.proposals[0], rationale: 'x'.repeat(501) }],
      }).ok,
    ).toBe(false);
    expect(
      validateProposalOutput({
        ...VALID_OUTPUT,
        proposals: [{ ...VALID_OUTPUT.proposals[0], intent: 'line\nbreak injection' }],
      }).ok,
    ).toBe(false);
  });
});
