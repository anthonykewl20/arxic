import type { Diagnostic } from '@arxic/contracts';
import {
  formBackedConsumerRowIds,
  toProposalConsumerInventory,
  type DomainInventory,
} from '@arxic/domain-inventory';
import type { ModelAdapter } from '@arxic/model-adapter';
import { ARXIC_ORCH_POSTCRAWL_REPROPOSAL, orchDiagnostic } from './diagnostics';
import {
  DEFAULT_MODEL_PRICES,
  proposeCandidates,
  type BoundProposal,
  type ModelPrices,
} from './intent-proposer';
import type { CoverageMatrix } from './types';

export type PostCrawlReproposalRecord = NonNullable<CoverageMatrix['postCrawl']>;

export type PostCrawlReproposalOutcome = Readonly<{
  record: PostCrawlReproposalRecord;
  diagnostics: readonly Diagnostic[];
}>;

/**
 * #324 AC-3 (Cause C): the POST-CRAWL re-proposal pass.
 *
 * WHY IT EXISTS. Stage 4 proposes from the SOURCE inventory built at stage 13,
 * and stage 13 executes BEFORE the crawl (`STAGE_EXECUTION_ORDER` =
 * 0,1,2,13,3,4,5,…). `observedForms` is therefore necessarily `[]` at proposal
 * time, so the model is form-blind and cannot prefer rows that are actually
 * replayable. Stage 6 is the first point where a runtime-FUSED inventory
 * exists, so the corrective pass runs from here.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not write back to the stage-4
 * artifact. That artifact is content-hashed and its checkpoint is part of the
 * bundle integrity chain; rewriting a hashed artifact after the fact to
 * improve a coverage ratio would invalidate the very gate the ratio is
 * measured by. The caller records this result on stage 6's own artifact.
 *
 * IT IS ADDITIVE. A run that stage 4 already satisfied must never be failed by
 * this pass, so every failure path returns zero proposals plus an
 * OBSERVED-severity diagnostic — visible, accounted, never blocking and never
 * silent. Nothing here can invent a proposal: model output still travels
 * through `proposeCandidates`' unchanged binding + dedupe + evidence-
 * resolvability gates.
 */
export async function runPostCrawlReproposal(input: {
  readonly adapter: ModelAdapter;
  readonly model: string;
  readonly runId: string;
  /** The runtime-fused inventory (stage-13 source rows + stage-5 crawl). */
  readonly fusedInventory: DomainInventory;
  readonly inventoryRowIds?: readonly string[];
  /** Proposals stage 4 already accepted — used only to find unbound rows. */
  readonly stage4Proposals: readonly BoundProposal[];
  /** Stage 4's own estimate, subtracted from the cap so the run stays bounded. */
  readonly stage4EstimatedCostUsd: number;
  readonly budgetUsd: number;
  readonly prices?: ModelPrices;
}): Promise<PostCrawlReproposalOutcome> {
  const formBackedRowIds = [...formBackedConsumerRowIds(input.fusedInventory)].sort();
  const observed = (message: string): readonly Diagnostic[] => [
    orchDiagnostic(ARXIC_ORCH_POSTCRAWL_REPROPOSAL, 'observed', `run:${input.runId}`, message),
  ];
  const skip = (reason: string, reproposedRowIds: readonly string[] = []) => ({
    record: { formBackedRowIds, reproposedRowIds, proposals: [], skippedReason: reason },
    diagnostics: observed(`Post-crawl re-proposal skipped: ${reason}`),
  });

  if (formBackedRowIds.length === 0) {
    return skip('the crawl observed no form-backed inventory row');
  }

  const bound = new Set<string>();
  for (const proposal of input.stage4Proposals) {
    for (const rowId of proposal.inventoryRowIds) bound.add(rowId);
  }
  const reproposedRowIds = formBackedRowIds.filter(
    (rowId) =>
      !bound.has(rowId) &&
      (input.inventoryRowIds === undefined || input.inventoryRowIds.includes(rowId)),
  );
  if (reproposedRowIds.length === 0) {
    return skip(
      input.inventoryRowIds === undefined
        ? 'stage 4 already bound every form-backed row'
        : 'no unbound form-backed row remains inside the selected scope',
      reproposedRowIds,
    );
  }

  // Bound the whole run, not just this pass: whatever stage 4 estimated is
  // already spent against the cap. No headroom -> zero provider calls.
  const headroomUsd = input.budgetUsd - input.stage4EstimatedCostUsd;
  if (!(headroomUsd > 0)) {
    return skip(
      `no budget headroom remains after stage 4 ($${input.stage4EstimatedCostUsd.toFixed(4)} of $${input.budgetUsd.toFixed(4)})`,
      reproposedRowIds,
    );
  }

  // Project the FUSED inventory through the canonical consumer adapter, then
  // narrow to exactly the rows this pass is for. Narrowing preserves the
  // evidence index, so every citation stays resolvable.
  const projected = toProposalConsumerInventory(input.fusedInventory);
  const wanted = new Set(reproposedRowIds);
  const inventory = { ...projected, rows: projected.rows.filter((row) => wanted.has(row.id)) };
  if (inventory.rows.length === 0) {
    return skip('no fused consumer row projected for the form-backed ids', reproposedRowIds);
  }

  let outcome: Awaited<ReturnType<typeof proposeCandidates>>;
  try {
    outcome = await proposeCandidates({
      adapter: input.adapter,
      model: input.model,
      inventory,
      runId: input.runId,
      budgetUsd: headroomUsd,
      prices: input.prices ?? DEFAULT_MODEL_PRICES,
      formBackedRowIds: new Set(reproposedRowIds),
      // One bounded pass. The stage-4 coverage passes already ran; this exists
      // to add the form signal, not to grind the provider a second time.
      maxCoveragePasses: 0,
    });
  } catch {
    // Never surface a thrown message: it may carry prompt or credential bytes
    // (the same redaction contract stage 4 holds).
    return {
      record: {
        formBackedRowIds,
        reproposedRowIds,
        proposals: [],
        skippedReason: 'the post-crawl provider call threw',
      },
      diagnostics: observed(
        `Post-crawl re-proposal over ${reproposedRowIds.length} form-backed row(s) threw; stage-4 proposals are unaffected`,
      ),
    };
  }

  if (!outcome.ok) {
    return {
      record: {
        formBackedRowIds,
        reproposedRowIds,
        proposals: [],
        skippedReason: 'the post-crawl pass was blocked by the model adapter',
      },
      diagnostics: [
        ...observed(
          `Post-crawl re-proposal over ${reproposedRowIds.length} form-backed row(s) produced no proposals; stage-4 proposals are unaffected`,
        ),
        // Carry the cause verbatim, but demoted: this pass is additive, so a
        // blocked-severity cause must not fail a stage 4 already satisfied.
        ...outcome.diagnostics.map((diagnostic) =>
          diagnostic.severity === 'blocked'
            ? { ...diagnostic, severity: 'observed' as const }
            : diagnostic,
        ),
      ],
    };
  }

  const proposals = outcome.result.proposalRun.proposals;
  return {
    record: { formBackedRowIds, reproposedRowIds, proposals },
    diagnostics: observed(
      `Post-crawl re-proposal produced ${proposals.length} proposal(s) over ${reproposedRowIds.length} form-backed row(s) stage 4 left unbound`,
    ),
  };
}
