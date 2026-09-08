import { toProposalConsumerInventory, type DomainInventory } from '@arxic/domain-inventory';
import type { Campaign, Run } from './types';

export type RowHistory = {
  executions: number;
  verified: number;
  contradicted: number;
  blocked: number;
  uncovered: number;
  pending: number;
};

/** Same outcome buckets as the campaign view, so history and execution totals read alike. */
export function rowHistoryOf(runs: Array<Run | undefined>): RowHistory {
  const history: RowHistory = {
    executions: 0,
    verified: 0,
    contradicted: 0,
    blocked: 0,
    uncovered: 0,
    pending: 0,
  };
  for (const run of runs) {
    history.executions++;
    if (run && ['queued', 'running'].includes(run.state)) history.pending++;
    else if (run?.result?.outcome === 'verified') history.verified++;
    else if (run?.result?.outcome === 'contradicted') history.contradicted++;
    else if (run?.result && ['hypothesized', 'observed'].includes(run.result.outcome))
      history.uncovered++;
    else history.blocked++;
  }
  return history;
}

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
  historyOf?: (inventoryRowId: string) => RowHistory,
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
    : campaign.rebinding?.discoveryRunId
      ? // Display-only rebind state: a drifted recurring campaign whose fresh
        // discovery is in flight. Cancelled keeps precedence above.
        'rebinding'
      : campaign.cron && !campaign.nextFireAt
        ? // A disarmed recurring schedule is a stopped campaign (drift stop,
          // exhausted/failed rebind), not a completed one.
          'blocked'
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
      ...(run?.workflowScope?.inventoryRowId && historyOf
        ? { history: historyOf(run.workflowScope.inventoryRowId) }
        : {}),
    })),
  };
}
