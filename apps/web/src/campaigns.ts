import { toProposalConsumerInventory, type DomainInventory } from '@arxic/domain-inventory';
import type { Campaign, Run } from './types';

/** Preserve the whole source denominator, including rows the proposer cannot consume. */
export function campaignRows(inventory: DomainInventory): Campaign['rows'] {
  return inventory.rows.map((row) => {
    const projected = toProposalConsumerInventory({ ...inventory, rows: [row] }).rows[0];
    return {
      key: row.key,
      method: row.method,
      path: row.path,
      disposition: row.disposition,
      reason: row.reason,
      ...(projected ? { inventoryRowId: projected.id } : {}),
    };
  });
}

/** Campaign management state is separate from each verifier-owned workflow outcome. */
export function campaignView(
  campaign: Campaign,
  children: Array<Pick<Run, 'state' | 'result' | 'workflowScope'> | undefined>,
) {
  const counts = {
    selected: campaign.runIds.length,
    verified: 0,
    contradicted: 0,
    blocked: 0,
    uncovered: 0,
    pending: 0,
    unselected: campaign.rows.filter((row) => row.inventoryRowId && !row.runId).length,
    unsupported: campaign.rows.filter((row) => !row.inventoryRowId).length,
  };
  for (const run of children) {
    if (run && ['queued', 'running'].includes(run.state)) counts.pending++;
    else if (run?.result?.outcome === 'verified') counts.verified++;
    else if (run?.result?.outcome === 'contradicted') counts.contradicted++;
    else if (run?.result && ['hypothesized', 'observed'].includes(run.result.outcome))
      counts.uncovered++;
    else counts.blocked++;
  }
  const state = campaign.cancelledAt
    ? 'cancelled'
    : counts.pending
      ? children.every((run) => run?.state === 'queued')
        ? 'queued'
        : 'running'
      : counts.blocked
        ? 'blocked'
        : 'completed';
  return {
    ...campaign,
    state,
    counts,
    workflows: children.map((run, index) => ({
      id: campaign.runIds[index],
      inventoryRowId: run?.workflowScope?.inventoryRowId,
      state: run?.state ?? 'blocked',
      outcome: run?.result?.outcome,
      summary: run?.result?.summary,
    })),
  };
}
