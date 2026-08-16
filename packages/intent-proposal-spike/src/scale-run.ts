import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { Diagnostic } from '@arxic/contracts';
import { ModelAdapter } from '@arxic/model-adapter';
import { SourceUaAdapter } from '@arxic/source-ua-adapter';
import { ARXIC_PROPOSAL_SCALE_TARGET_MISSING, proposalDiagnostic } from './diagnostics';
import { buildEvidenceIndex, exportInventory } from './inventory';
import {
  IntentProposer,
  estimatePromptTokens,
  sanitizeArtifactJson,
  type BatchingStrategy,
  type ProposalRunOutcome,
} from './proposer';

const exec = promisify(execFile);

/**
 * DG-04 scale-run matrix (offline evidence generator, feeds #248/#255):
 * scans a real target repository with the real Tree-sitter adapter, exports
 * the stand-in inventory, then runs BOTH batching strategies (per-domain and
 * one-shot) through the real ModelAdapter against a real OpenAI-compatible
 * endpoint, recording per-call tokens/latency and a computed cost line.
 *
 * Refuses to run (fail-closed) without an explicit target repository — a
 * missing target is a blocked diagnostic, never a fabricated run.
 */

export type ScaleRunInput = {
  targetRepository: string;
  baseUrl: string;
  key: string;
  model: string;
  recordDir: string;
  maxRowsPerCall?: number;
  oneShotRowCap?: number;
  pricePerMillionPrompt?: number;
  pricePerMillionCompletion?: number;
};

export type ScaleRunOutcome =
  { ok: true; record: unknown } | { ok: false; diagnostics: readonly Diagnostic[] };

async function resolveHead(root: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
      cwd: root,
      encoding: 'utf8',
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function runScaleMatrix(input: ScaleRunInput): Promise<ScaleRunOutcome> {
  if (!input.targetRepository) {
    return {
      ok: false,
      diagnostics: [
        proposalDiagnostic(
          ARXIC_PROPOSAL_SCALE_TARGET_MISSING,
          'blocked',
          'scale-run',
          'Scale run requires an explicit target repository path (ARXIC_DG04_SCALE_TARGET)',
        ),
      ],
    };
  }
  const commit = await resolveHead(input.targetRepository);
  if (!commit) {
    return {
      ok: false,
      diagnostics: [
        proposalDiagnostic(
          ARXIC_PROPOSAL_SCALE_TARGET_MISSING,
          'blocked',
          'scale-run',
          'Target repository has no resolvable HEAD commit',
        ),
      ],
    };
  }

  const scanAdapter = new SourceUaAdapter();
  const index = await scanAdapter.collect({
    revision: {
      repository: pathToFileURL(input.targetRepository).href,
      commit,
      dirty: false,
    },
  });
  const inventory = exportInventory(index);
  const evidenceIndex = buildEvidenceIndex(index);
  const rows = inventory.rows;

  const adapter = new ModelAdapter({
    credentials: input.key,
    baseUrl: input.baseUrl,
    timeoutMs: 120_000,
    canaries: input.key ? [input.key] : [],
  });

  const strategies: BatchingStrategy[] = [
    { kind: 'per-domain', maxRowsPerCall: input.maxRowsPerCall ?? 40 },
    { kind: 'one-shot', maxRows: input.oneShotRowCap ?? 400 },
  ];
  const runs: Array<{
    strategy: string;
    calls: number;
    promptTokens: number;
    completionTokens: number;
    latencyMsTotal: number;
    latencyMsMaxCall: number;
    proposals: number;
    coveredRows: number;
    rejected: number;
    dedupeDropped: number;
    estimatedPromptTokens: number;
    estimatedCostUsd: number | null;
  }> = [];
  const details: unknown[] = [];
  const failures: Diagnostic[] = [];
  const proposalSamples: unknown[] = [];

  for (const strategy of strategies) {
    const effectiveRows =
      strategy.kind === 'one-shot' && rows.length > (strategy.maxRows ?? 400)
        ? rows.slice(0, strategy.maxRows ?? 400)
        : rows;
    const proposer = new IntentProposer({ adapter, model: input.model, strategy, maxRetries: 1 });
    const outcome: ProposalRunOutcome = await proposer.propose({
      inventory: { rows: effectiveRows },
      evidenceIndex,
      runId: `scale-${strategy.kind}`,
    });
    const estimated = estimatePromptTokens(effectiveRows);
    if (!outcome.ok) {
      failures.push(
        proposalDiagnostic(
          ARXIC_PROPOSAL_SCALE_TARGET_MISSING,
          'blocked',
          `scale-run:${strategy.kind}`,
          'Strategy run failed; see companion diagnostics',
        ),
        ...outcome.diagnostics,
      );
      runs.push({
        strategy: strategy.kind,
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        latencyMsTotal: 0,
        latencyMsMaxCall: 0,
        proposals: 0,
        coveredRows: 0,
        rejected: 0,
        dedupeDropped: 0,
        estimatedPromptTokens: estimated,
        estimatedCostUsd: null,
      });
      continue;
    }
    const { result } = outcome;
    const promptTokens = result.calls.reduce((sum, call) => sum + call.runRecord.tokens.prompt, 0);
    const completionTokens = result.calls.reduce(
      (sum, call) => sum + call.runRecord.tokens.completion,
      0,
    );
    const latencies = result.calls.map((call) => call.latencyMs);
    const cost =
      input.pricePerMillionPrompt !== undefined && input.pricePerMillionCompletion !== undefined
        ? (promptTokens / 1_000_000) * input.pricePerMillionPrompt +
          (completionTokens / 1_000_000) * input.pricePerMillionCompletion
        : null;
    runs.push({
      strategy: strategy.kind,
      calls: result.calls.length,
      promptTokens,
      completionTokens,
      latencyMsTotal: latencies.reduce((sum, value) => sum + value, 0),
      latencyMsMaxCall: latencies.length > 0 ? Math.max(...latencies) : 0,
      proposals: result.proposals.length,
      coveredRows: result.coverage.coveredRows,
      rejected: result.rejected.length,
      dedupeDropped: result.dedupe.inBatchDropped + result.dedupe.crossBatchDropped,
      estimatedPromptTokens: estimated,
      estimatedCostUsd: cost,
    });
    details.push({
      strategy: strategy.kind,
      calls: result.calls.map((call) => ({
        callId: call.callId,
        strategyTag: call.strategyTag,
        rows: call.rows,
        latencyMs: call.latencyMs,
        requestId: call.runRecord.requestId,
        tokens: call.runRecord.tokens,
      })),
      domains: [...new Set(result.proposals.map((proposal) => proposal.domain))].sort(),
    });
    proposalSamples.push(
      result.proposals.slice(0, 12).map((proposal) => ({
        id: proposal.id,
        domain: proposal.domain,
        intent: proposal.intent,
        action: proposal.action,
        inventoryRowIds: proposal.inventoryRowIds,
        evidenceRefIds: proposal.evidenceRefIds,
        truthState: proposal.truthState,
      })),
    );
  }

  const record = {
    kind: 'dg04-scale-matrix',
    generatedAt: new Date().toISOString(),
    target: {
      repository: input.targetRepository,
      commit,
      rows: rows.length,
      domainHints: [...new Set(rows.map((row) => row.domainHint))].length,
      unsupportedLanguageDiagnostics: inventory.diagnostics.filter(
        (diagnostic) => diagnostic.code === 'ARXIC-SOURCE-UNSUPPORTED-LANGUAGE',
      ).length,
    },
    model: input.model,
    pricing: {
      note: 'Cost = measured tokens x list price passed by the operator; prices must be re-verified at read time.',
      pricePerMillionPrompt: input.pricePerMillionPrompt ?? null,
      pricePerMillionCompletion: input.pricePerMillionCompletion ?? null,
    },
    runs,
    details,
    proposalSamples,
    failures,
  };

  if (input.recordDir) {
    await mkdir(input.recordDir, { recursive: true });
    const artifact = sanitizeArtifactJson(JSON.stringify(record, null, 2), [input.key]);
    await writeFile(`${input.recordDir}/scale-matrix.json`, `${artifact}\n`, {
      encoding: 'utf8',
      mode: 0o640,
    });
    const inventorySummary = sanitizeArtifactJson(
      JSON.stringify(
        {
          kind: 'dg04-inventory-summary',
          target: record.target,
          rows: rows.slice(0, 400),
        },
        null,
        2,
      ),
      [input.key],
    );
    await writeFile(`${input.recordDir}/inventory-summary.json`, `${inventorySummary}\n`, {
      encoding: 'utf8',
      mode: 0o640,
    });
  }
  if (failures.length > 0) return { ok: false, diagnostics: failures };
  return { ok: true, record };
}

export async function readScaleArtifacts(recordDir: string): Promise<string[]> {
  const entries = await readdir(recordDir);
  const artifacts: string[] = [];
  for (const entry of entries.filter((name) => name.endsWith('.json'))) {
    artifacts.push(await readFile(`${recordDir}/${entry}`, 'utf8'));
  }
  return artifacts;
}
