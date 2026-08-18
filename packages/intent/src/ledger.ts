import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import {
  canonicalJson as serializeCanonicalJson,
  sha256,
  validateDiagnostic,
  type Diagnostic,
  type EvidenceRefSource,
  type TruthState,
} from '@arxic/contracts';
import type { OracleKind } from './types';
import evidenceRefSchema from '../../../schemas/evidence/evidence-ref.schema.json';
import intentLedgerSchema from '../../../schemas/intent-ledger/intent-ledger.schema.json';

/**
 * DG-07 (#251, ADR-008 Decisions 1, 2, 6): the Intent Ledger — a DETERMINISTIC
 * pure function over persisted stage artifacts (zero model/network calls).
 *
 *   stage 13 (Domain Inventory envelope)  → every ledger row (100% join; rows
 *                                           with no proposal keep their
 *                                           disposition — never dropped)
 *   stage 04 (proposalRun.proposals)      → joined intents per row
 *   stage 09 (compiled workflow IR)       → candidate linkage
 *   stage 10 (verification outcome)       → truth state + replay status
 *
 * Truth state `verified` is derived ONLY from the stage-10 verifier artifact
 * (ADR-001 §2); a proposal claiming `verified` fails the build closed. Run
 * volatile fields (proposalRun.estimatedCostUsd, dedupe counters, request ids)
 * are deliberately NOT projected — repeat builds over identical artifacts are
 * byte-identical modulo `generatedAt`.
 *
 * All exports are Service-layer capability blocks (ADR-004 §3; charter §1):
 * structured results + stable `ARXIC-INTENT-LEDGER-*` diagnostics; run-level
 * failure classification belongs to the CLI actions that call them.
 */

export const INTENT_LEDGER_SCHEMA_VERSION = 'arxic-intent-ledger-v1' as const;
export const INTENT_LEDGER_FILENAME = 'intents.json' as const;

export const ARXIC_INTENT_LEDGER_INVENTORY_MISSING = 'ARXIC-INTENT-LEDGER-INVENTORY-MISSING' as const;
export const ARXIC_INTENT_LEDGER_INPUT_INVALID = 'ARXIC-INTENT-LEDGER-INPUT-INVALID' as const;
export const ARXIC_INTENT_LEDGER_EVIDENCE_UNRESOLVED =
  'ARXIC-INTENT-LEDGER-EVIDENCE-UNRESOLVED' as const;
export const ARXIC_INTENT_LEDGER_SCHEMA_INVALID = 'ARXIC-INTENT-LEDGER-SCHEMA-INVALID' as const;
export const ARXIC_INTENT_LEDGER_VERSION_UNKNOWN = 'ARXIC-INTENT-LEDGER-VERSION-UNKNOWN' as const;
export const ARXIC_INTENT_LEDGER_MISSING = 'ARXIC-INTENT-LEDGER-MISSING' as const;

export type IntentLedgerDiagnosticCode =
  | typeof ARXIC_INTENT_LEDGER_INVENTORY_MISSING
  | typeof ARXIC_INTENT_LEDGER_INPUT_INVALID
  | typeof ARXIC_INTENT_LEDGER_EVIDENCE_UNRESOLVED
  | typeof ARXIC_INTENT_LEDGER_SCHEMA_INVALID
  | typeof ARXIC_INTENT_LEDGER_VERSION_UNKNOWN
  | typeof ARXIC_INTENT_LEDGER_MISSING;

export function ledgerDiagnostic(
  code: IntentLedgerDiagnosticCode,
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity: 'blocked', subject, message };
  if (!validateDiagnostic(diagnostic).ok) throw new Error('intent ledger made an invalid Diagnostic');
  return diagnostic;
}

// ---------------------------------------------------------------------------
// Ledger document model (mirrors schemas/intent-ledger/intent-ledger.schema.json)
// ---------------------------------------------------------------------------

export type IntentLedgerReplayStatus =
  | 'not-attempted'
  | 'attempted:passed'
  | 'attempted:failed'
  | 'attempted:blocked';

export type IntentLedgerDisposition =
  | 'extracted'
  | 'unsupported'
  | 'unsafe'
  | 'unextracted-with-reason';

export type IntentLedgerObservedForm = Readonly<{
  action: string;
  method: string;
  destructive: boolean;
}>;

export type IntentLedgerEvidence = Readonly<{
  sourceRefs: readonly EvidenceRefSource[];
  runtimeUrls: readonly string[];
  runtimeForms: readonly IntentLedgerObservedForm[];
  runtimeObservationCount: number;
}>;

export type IntentLedgerIntent = Readonly<{
  proposalId: string;
  domain: string;
  intent: string;
  action: string;
  persona: string;
  fromState: string;
  toState: string;
  evidenceRefIds: readonly string[];
  oracleKinds: readonly OracleKind[];
  truthState: TruthState;
  replayStatus: IntentLedgerReplayStatus;
  isCandidate: boolean;
}>;

export type IntentLedgerRow = Readonly<{
  inventoryKey: string;
  inventoryRowId?: string;
  domain: string;
  surface: Readonly<{ kind: string; method: string; path: string }>;
  disposition: IntentLedgerDisposition;
  reason: string;
  verbs: readonly string[];
  evidence: IntentLedgerEvidence;
  oracleKinds: readonly OracleKind[];
  truthState: TruthState;
  replayStatus: IntentLedgerReplayStatus;
  intents: readonly IntentLedgerIntent[];
}>;

export type IntentLedger = Readonly<{
  schemaVersion: typeof INTENT_LEDGER_SCHEMA_VERSION;
  generatedAt: string;
  source: Readonly<{ repository: string; commit: string }>;
  inventory: Readonly<{
    totalRows: number;
    byDisposition: Readonly<Record<IntentLedgerDisposition, number>>;
  }>;
  candidate?: Readonly<{ workflowId: string }>;
  verification?: Readonly<{ outcome: TruthState; runs: number; passedRuns: number }>;
  rows: readonly IntentLedgerRow[];
}>;

// ---------------------------------------------------------------------------
// Structural views over persisted stage artifacts (JSON data, not code imports)
// ---------------------------------------------------------------------------

type InventoryRowJson = {
  key: string;
  surfaceKind: string;
  method: string;
  path: string;
  sourceRefs: EvidenceRefSource[];
  runtimeRefs?: unknown[];
  runtimeUrls?: string[];
  observedForms?: IntentLedgerObservedForm[];
  disposition: string;
  reason: string;
  domain: string;
  verbs: string[];
};

type LedgerInventoryEnvelope = {
  kind: string;
  inventory: { rows: InventoryRowJson[] };
};

type LedgerProposalJson = {
  id: string;
  domain: string;
  intent: string;
  action: string;
  fromState: string;
  toState: string;
  persona: string;
  inventoryRowIds: string[];
  evidenceRefIds: string[];
  truthState?: string;
};

type LedgerInferenceArtifact = {
  proposalRun?: {
    proposals: LedgerProposalJson[];
    rows?: unknown[];
    estimatedCostUsd?: unknown;
    dedupe?: unknown;
  };
};

type LedgerCompilationArtifact = {
  compiled: boolean;
  workflow?: { id: string };
};

type LedgerVerificationArtifact = {
  outcome: TruthState;
  runs: ReadonlyArray<{ passed: boolean }>;
};

export type IntentLedgerBuildInput = Readonly<{
  inventory: unknown;
  inference?: unknown;
  compilation?: unknown;
  verification?: unknown;
  generatedAt: string;
}>;

export type LedgerOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostics: readonly Diagnostic[] };

// ---------------------------------------------------------------------------
// Evidence id grammar — LOCKSTEP with the Domain Inventory consumer projection
// (consumer-adapter.ts `sourceEvidenceId`); the grammar is part of the ledger
// schema contract and must not drift.
// ---------------------------------------------------------------------------

export function sourceEvidenceId(ref: EvidenceRefSource): string {
  return `src:${sanitizePath(ref.path)}:${String(ref.startLine)}-${String(ref.endLine)}`;
}

function sanitizePath(value: string): string {
  return value.replace(/[^A-Za-z0-9._#-]/gu, '-') || 'unknown';
}

/**
 * LOCKSTEP with `consumer-adapter.ts consumerRowId`:
 * `inv:<surface>:<METHOD>:<sha256(fusion key) first 12 hex>`. The surface
 * projection (page vs route by extractor) mirrors `consumerSurface`.
 */
function consumerRowId(row: InventoryRowJson): string {
  const surface = row.sourceRefs.some((ref) => ref.extractor.includes('nextjs-file-conventions'))
    ? 'page'
    : 'route';
  return `inv:${surface}:${row.method}:${sha256(row.key).slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

function createLedgerValidator() {
  // $data: true is required by the referenced evidence-ref schema (its source
  // branch constrains endLine >= startLine via $data), mirroring contracts'
  // own EvidenceRef validator configuration.
  const ajv = new Ajv2020({ allErrors: true, $data: true });
  addFormats(ajv);
  ajv.addSchema(evidenceRefSchema);
  return ajv.compile<IntentLedger>(intentLedgerSchema);
}
let compiledValidator: ReturnType<typeof createLedgerValidator> | undefined;
const validator = () => (compiledValidator ??= createLedgerValidator());

function schemaDiagnostic(error: ErrorObject): Diagnostic {
  return ledgerDiagnostic(
    ARXIC_INTENT_LEDGER_SCHEMA_INVALID,
    `intent-ledger${error.instancePath || ''}`,
    `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
  );
}

export function validateIntentLedger(input: unknown): LedgerOutcome<IntentLedger> {
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const version = (input as Record<string, unknown>).schemaVersion;
    if (version !== INTENT_LEDGER_SCHEMA_VERSION) {
      return {
        ok: false,
        diagnostics: [
          ledgerDiagnostic(
            ARXIC_INTENT_LEDGER_VERSION_UNKNOWN,
            'intent-ledger.schemaVersion',
            `Intent ledger schemaVersion ${JSON.stringify(version)} is not ${INTENT_LEDGER_SCHEMA_VERSION}`,
          ),
        ],
      };
    }
  }
  if (validator()(input)) return { ok: true, value: input };
  return { ok: false, diagnostics: (validator().errors ?? []).map(schemaDiagnostic) };
}

// ---------------------------------------------------------------------------
// Deterministic builder (pure function over artifact JSON — C-1/C-5/C-7)
// ---------------------------------------------------------------------------

export function buildIntentLedger(input: IntentLedgerBuildInput): LedgerOutcome<IntentLedger> {
  const inventory = asInventoryEnvelope(input.inventory);
  if (!inventory.ok) return inventory;

  const rows = inventory.value.inventory.rows;
  const evidenceIndex: Record<string, EvidenceRefSource> = {};
  for (const row of rows) {
    if (!isSourceRefs(row.sourceRefs)) {
      return inputInvalid(`inventory row ${row.key} carries malformed sourceRefs`);
    }
    for (const ref of row.sourceRefs) evidenceIndex[sourceEvidenceId(ref)] ??= ref;
  }

  const extractedIds = new Set<string>();
  for (const row of rows) {
    if (row.disposition === 'extracted') extractedIds.add(consumerRowId(row));
  }

  const proposals: LedgerProposalJson[] = [];
  if (isPresent(input.inference)) {
    const inference = input.inference as LedgerInferenceArtifact;
    if (inference.proposalRun !== undefined) {
      if (!Array.isArray(inference.proposalRun.proposals)) {
        return inputInvalid('stage-04 proposalRun.proposals is not an array');
      }
      proposals.push(...inference.proposalRun.proposals);
    }
  }
  for (const [proposalIndex, proposal] of proposals.entries()) {
    if (!isProposalShape(proposal)) {
      return inputInvalid(`stage-04 proposal at index ${proposalIndex} violates the bound shape`);
    }
    if (proposal.truthState === 'verified') {
      // ADR-001 §2: model output can never assert `verified`; the build
      // fails closed rather than launder the claim (C-5).
      return inputInvalid(`stage-04 proposal ${proposal.id} claims truthState verified`);
    }
    const danglingRow = proposal.inventoryRowIds.find((id) => !extractedIds.has(id));
    if (danglingRow !== undefined) {
      return inputInvalid(
        `stage-04 proposal ${proposal.id} cites inventory row ${danglingRow} which is not an extracted inventory row`,
      );
    }
    const danglingEvidence = proposal.evidenceRefIds.find((id) => evidenceIndex[id] === undefined);
    if (danglingEvidence !== undefined) {
      return {
        ok: false,
        diagnostics: [
          ledgerDiagnostic(
            ARXIC_INTENT_LEDGER_EVIDENCE_UNRESOLVED,
            `evidence-ref:${danglingEvidence}`,
            `Proposal ${proposal.id} cites an EvidenceRef that does not resolve in the stage-13 inventory evidence index`,
          ),
        ],
      };
    }
  }

  let candidate: { workflowId: string } | undefined;
  if (isPresent(input.compilation)) {
    const compilation = input.compilation as LedgerCompilationArtifact;
    if (compilation.compiled === true) {
      if (typeof compilation.workflow?.id !== 'string' || compilation.workflow.id.length === 0) {
        return inputInvalid('stage-09 compiled artifact lacks a workflow id');
      }
      candidate = { workflowId: compilation.workflow.id };
    }
  }

  let verification: { outcome: TruthState; runs: number; passedRuns: number } | undefined;
  if (isPresent(input.verification)) {
    const artifact = input.verification as LedgerVerificationArtifact;
    if (
      !isTruthState(artifact.outcome) ||
      !Array.isArray(artifact.runs) ||
      !artifact.runs.every((run) => typeof run?.passed === 'boolean')
    ) {
      return inputInvalid('stage-10 verification artifact is malformed');
    }
    verification = {
      outcome: artifact.outcome,
      runs: artifact.runs.length,
      passedRuns: artifact.runs.filter((run) => run.passed).length,
    };
  }

  const byDisposition: Record<IntentLedgerDisposition, number> = {
    extracted: 0,
    unsupported: 0,
    unsafe: 0,
    'unextracted-with-reason': 0,
  };

  const ledgerRows: IntentLedgerRow[] = [];
  for (const row of [...rows].sort((left, right) => compare(left.key, right.key))) {
    if (!isDisposition(row.disposition)) {
      return inputInvalid(`inventory row ${row.key} carries an unknown disposition`);
    }
    byDisposition[row.disposition] += 1;
    const inventoryRowId =
      row.disposition === 'extracted' ? consumerRowId(row) : undefined;
    const rowIntents: IntentLedgerIntent[] = proposals
      .filter((proposal) =>
        inventoryRowId === undefined
          ? false
          : proposal.inventoryRowIds.includes(inventoryRowId),
      )
      .sort((left, right) => compare(left.id, right.id))
      .map((proposal) => {
        const isCandidate = candidate !== undefined && proposal.id === candidate.workflowId;
        const replay = replayStatusFor(isCandidate, verification);
        return {
          proposalId: proposal.id,
          domain: proposal.domain,
          intent: proposal.intent,
          action: proposal.action,
          persona: proposal.persona,
          fromState: proposal.fromState,
          toState: proposal.toState,
          evidenceRefIds: [...proposal.evidenceRefIds].sort(compare),
          oracleKinds: ['repository-specification' as const],
          truthState: replay === 'attempted:passed' ? ('verified' as const) : ('hypothesized' as const),
          replayStatus: replay,
          isCandidate,
        };
      });
    const runtimeForms = (row.observedForms ?? []).map((form) => ({
      action: form.action,
      method: form.method,
      destructive: form.destructive,
    }));
    const runtimeUrls = [...(row.runtimeUrls ?? [])].sort(compare);
    ledgerRows.push({
      inventoryKey: row.key,
      ...(inventoryRowId === undefined ? {} : { inventoryRowId }),
      domain: row.domain,
      surface: { kind: row.surfaceKind, method: row.method, path: row.path },
      disposition: row.disposition,
      reason: row.reason,
      verbs: [...row.verbs].sort(compare),
      evidence: {
        sourceRefs: row.sourceRefs,
        runtimeUrls,
        runtimeForms,
        runtimeObservationCount: row.runtimeRefs?.length ?? 0,
      },
      oracleKinds: rowOracleKinds(row),
      truthState: rollUpTruthState(rowIntents),
      replayStatus: rollUpReplayStatus(rowIntents),
      intents: rowIntents,
    });
  }

  const firstRef = rows.find((row) => row.sourceRefs[0])?.sourceRefs[0];
  const ledger: IntentLedger = {
    schemaVersion: INTENT_LEDGER_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    source: {
      repository: firstRef?.repo ?? 'unknown',
      commit: firstRef?.commit ?? 'unknown',
    },
    inventory: { totalRows: rows.length, byDisposition },
    ...(candidate === undefined ? {} : { candidate }),
    ...(verification === undefined ? {} : { verification }),
    rows: ledgerRows,
  };
  const selfCheck = validateIntentLedger(ledger);
  if (!selfCheck.ok) return { ok: false, diagnostics: selfCheck.diagnostics };
  return { ok: true, value: ledger };
}

/**
 * D-4 replay semantics: only rows joined into the promoted candidate may carry
 * an `attempted:*` value, and `attempted:passed` additionally requires the
 * stage-10 verifier artifact to report `verified` with every run passed.
 */
function replayStatusFor(
  isCandidate: boolean,
  verification: { outcome: TruthState; runs: number; passedRuns: number } | undefined,
): IntentLedgerReplayStatus {
  if (!isCandidate || verification === undefined || verification.runs === 0) {
    return 'not-attempted';
  }
  if (verification.outcome === 'verified' && verification.passedRuns === verification.runs) {
    return 'attempted:passed';
  }
  if (verification.outcome === 'blocked') return 'attempted:blocked';
  return 'attempted:failed';
}

function rowOracleKinds(row: InventoryRowJson): OracleKind[] {
  const kinds: OracleKind[] = [];
  if (row.sourceRefs.length > 0) kinds.push('repository-specification');
  if ((row.runtimeRefs?.length ?? 0) > 0) kinds.push('observed-only');
  if (kinds.length === 0) kinds.push('observed-only');
  return kinds;
}

function rollUpTruthState(intents: readonly IntentLedgerIntent[]): TruthState {
  if (intents.length === 0) return 'observed';
  if (intents.some(({ truthState }) => truthState === 'verified')) return 'verified';
  return 'hypothesized';
}

function rollUpReplayStatus(intents: readonly IntentLedgerIntent[]): IntentLedgerReplayStatus {
  if (intents.some(({ replayStatus }) => replayStatus === 'attempted:passed')) {
    return 'attempted:passed';
  }
  if (intents.some(({ replayStatus }) => replayStatus === 'attempted:failed')) {
    return 'attempted:failed';
  }
  if (intents.some(({ replayStatus }) => replayStatus === 'attempted:blocked')) {
    return 'attempted:blocked';
  }
  return 'not-attempted';
}

// ---------------------------------------------------------------------------
// Per-lane input resolution (C-1)
// ---------------------------------------------------------------------------

export type LedgerStageInputs = Readonly<{
  inventory: unknown;
  inference?: unknown;
  compilation?: unknown;
  verification?: unknown;
}>;

function stageArtifactName(stage: number): string {
  return `${String(stage).padStart(2, '0')}.json`;
}

/**
 * Resolves a stage artifact CONTENT file for either lane layout:
 * local `RUNID/artifacts/NN.json`; worker-imported
 * `RUNID/artifacts/checkpoints/<RUNID>/artifacts/NN.json`. Ambiguous nested
 * candidates THROW (fail closed) instead of silently resolving to nothing.
 */
export async function resolveStageArtifact(
  runDirectory: string,
  stage: number,
): Promise<string | undefined> {
  const local = join(runDirectory, 'artifacts', stageArtifactName(stage));
  if (await isFile(local)) return local;
  const checkpoints = join(runDirectory, 'artifacts', 'checkpoints');
  let entries;
  try {
    entries = await readdir(checkpoints, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = join(checkpoints, entry.name, 'artifacts', stageArtifactName(stage));
    if (await isFile(nested)) candidates.push(nested);
  }
  if (candidates.length > 1) {
    throw new Error(
      `ambiguous nested stage-${stage} artifacts: ${candidates.sort().join(', ')}`,
    );
  }
  return candidates[0];
}

export async function resolveLedgerInputs(
  runDirectory: string,
): Promise<LedgerOutcome<LedgerStageInputs>> {
  let inventoryPath: string | undefined;
  try {
    inventoryPath = await resolveStageArtifact(runDirectory, 13);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        ledgerDiagnostic(
          ARXIC_INTENT_LEDGER_INPUT_INVALID,
          'intent-ledger.inputs',
          `The stage-13 inventory artifact under ${runDirectory} is ambiguous or unreadable (${error instanceof Error ? error.message : 'unknown error'})`,
        ),
      ],
    };
  }
  if (inventoryPath === undefined) {
    return {
      ok: false,
      diagnostics: [
        ledgerDiagnostic(
          ARXIC_INTENT_LEDGER_INVENTORY_MISSING,
          'intent-ledger.inventory',
          `No resolvable artifacts/13.json (Domain Inventory) under ${runDirectory} in either lane layout`,
        ),
      ],
    };
  }
  let inputs: LedgerStageInputs;
  try {
    inputs = {
      inventory: JSON.parse(await readFile(inventoryPath, 'utf8')),
      ...(await optionalStageJson(runDirectory, 4)),
      ...(await optionalStageJson(runDirectory, 9)),
      ...(await optionalStageJson(runDirectory, 10)),
    };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        ledgerDiagnostic(
          ARXIC_INTENT_LEDGER_INPUT_INVALID,
          'intent-ledger.inputs',
          `A stage artifact consumed by the intent ledger could not be resolved or parsed under ${runDirectory} (${error instanceof Error ? error.message : 'unknown error'})`,
        ),
      ],
    };
  }
  return { ok: true, value: inputs };
}

async function optionalStageJson(
  runDirectory: string,
  stage: number,
): Promise<Partial<LedgerStageInputs>> {
  const path = await resolveStageArtifact(runDirectory, stage);
  if (path === undefined) return {};
  return { [stageKey(stage)]: JSON.parse(await readFile(path, 'utf8')) } as Partial<LedgerStageInputs>;
}

function stageKey(stage: number): keyof LedgerStageInputs {
  if (stage === 4) return 'inference';
  if (stage === 9) return 'compilation';
  return 'verification';
}

// ---------------------------------------------------------------------------
// Serialization, redaction-gated write, and staging (C-6a, D-3)
// ---------------------------------------------------------------------------

export function serializeIntentLedger(ledger: IntentLedger): string {
  return `${serializeCanonicalJson(ledger)}\n`;
}

/**
 * Byte-compare normalization (G-5): replaces the run-volatile `generatedAt`
 * with a constant and re-serializes canonically. Two ledgers are
 * "byte-identical modulo timestamps" exactly when their normalized bytes equal.
 */
export function normalizeLedgerBytes(bytes: string): string {
  const parsed = JSON.parse(bytes) as IntentLedger;
  return serializeIntentLedger({ ...parsed, generatedAt: '1970-01-01T00:00:00.000Z' });
}

export type WriteLedgerOutcome =
  | { ok: true; path: string; bytes: Uint8Array; sha256: string }
  | { ok: false; diagnostics: readonly Diagnostic[] };

/**
 * Writes the ledger atomically at `outputPath` (run root, D-3) AFTER the
 * injected build-time redaction scan (C-6a) passes over the exact bytes.
 * Redaction findings are returned unchanged (ARXIC_PROMOTION_REDACTION_FAILED)
 * and NOTHING is written — the caller blocks staging/promotion on them.
 */
export async function writeIntentLedger(
  outputPath: string,
  ledger: IntentLedger,
  options: Readonly<{ scan?: (text: string) => readonly Diagnostic[] }> = {},
): Promise<WriteLedgerOutcome> {
  const text = serializeIntentLedger(ledger);
  const findings = options.scan ? options.scan(text) : [];
  if (findings.length > 0) return { ok: false, diagnostics: findings };
  const bytes = Buffer.from(text, 'utf8');
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, outputPath);
  return { ok: true, path: outputPath, bytes, sha256: sha256(bytes) };
}

export type StageIntentLedgerOutcome =
  | { ok: true; runDirectory: string; ledger: IntentLedger; wrote: boolean; sha256: string }
  | { ok: false; diagnostics: readonly Diagnostic[] };

/**
 * Full staging action over a run directory: resolve per lane (C-1), build
 * deterministically (C-5), validate, redact-scan, and atomically write
 * `intents.json` at the run ROOT (sibling of run.json — D-3). With
 * `skipIfPresent` an existing ledger is kept byte-identical (idempotent
 * post-run hook); without it a resume rebuilds over it deterministically.
 */
export async function stageIntentLedger(input: Readonly<{
  runDirectory: string;
  generatedAt: string;
  scan?: (text: string) => readonly Diagnostic[];
  skipIfPresent?: boolean;
  verificationOverride?: unknown;
}>): Promise<StageIntentLedgerOutcome> {
  const outputPath = join(input.runDirectory, INTENT_LEDGER_FILENAME);
  if (input.skipIfPresent && (await isFile(outputPath))) {
    try {
      const existing = validateIntentLedger(JSON.parse(await readFile(outputPath, 'utf8')));
      if (existing.ok) {
        return {
          ok: true,
          runDirectory: input.runDirectory,
          ledger: existing.value,
          wrote: false,
          sha256: sha256(await readFile(outputPath)),
        };
      }
      // A present-but-invalid ledger is never silently kept.
      return { ok: false, diagnostics: existing.diagnostics };
    } catch {
      return {
        ok: false,
        diagnostics: [
          ledgerDiagnostic(
            ARXIC_INTENT_LEDGER_SCHEMA_INVALID,
            'intent-ledger',
            `An existing ${INTENT_LEDGER_FILENAME} at ${input.runDirectory} is not valid JSON`,
          ),
        ],
      };
    }
  }
  const resolved = await resolveLedgerInputs(input.runDirectory);
  if (!resolved.ok) return { ok: false, diagnostics: resolved.diagnostics };
  const built = buildIntentLedger({
    ...resolved.value,
    ...(input.verificationOverride === undefined
      ? {}
      : { verification: input.verificationOverride }),
    generatedAt: input.generatedAt,
  });
  if (!built.ok) return { ok: false, diagnostics: built.diagnostics };
  const written = await writeIntentLedger(outputPath, built.value, {
    ...(input.scan === undefined ? {} : { scan: input.scan }),
  });
  if (!written.ok) return { ok: false, diagnostics: written.diagnostics };
  return {
    ok: true,
    runDirectory: input.runDirectory,
    ledger: built.value,
    wrote: true,
    sha256: written.sha256,
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function asInventoryEnvelope(value: unknown): LedgerOutcome<LedgerInventoryEnvelope> {
  if (!isRecord(value)) return inputInvalid('stage-13 inventory artifact is not an object');
  if (value.kind !== 'arxic-domain-inventory-stage-v1') {
    return inputInvalid('stage-13 artifact kind is not arxic-domain-inventory-stage-v1');
  }
  const rows = (value as LedgerInventoryEnvelope).inventory?.rows;
  if (!Array.isArray(rows)) return inputInvalid('stage-13 inventory.rows is not an array');
  return { ok: true, value: value as LedgerInventoryEnvelope };
}

function isProposalShape(value: unknown): value is LedgerProposalJson {
  if (!isRecord(value)) return false;
  const record = value as Record<string, unknown>;
  for (const key of ['id', 'domain', 'intent', 'action', 'fromState', 'toState', 'persona']) {
    if (typeof record[key] !== 'string') return false;
  }
  for (const key of ['inventoryRowIds', 'evidenceRefIds'] as const) {
    if (
      !Array.isArray(record[key]) ||
      record[key].length === 0 ||
      !record[key].every((item): item is string => typeof item === 'string' && item.length > 0)
    ) {
      return false;
    }
  }
  return true;
}

function isSourceRefs(value: unknown): value is EvidenceRefSource[] {
  return (
    Array.isArray(value) &&
    value.every(
      (ref) =>
        isRecord(ref) &&
        typeof ref.path === 'string' &&
        typeof ref.startLine === 'number' &&
        typeof ref.endLine === 'number',
    )
  );
}

function isDisposition(value: string): value is IntentLedgerDisposition {
  return ['extracted', 'unsupported', 'unsafe', 'unextracted-with-reason'].includes(value);
}

function isTruthState(value: unknown): value is TruthState {
  return (
    value === 'hypothesized' ||
    value === 'observed' ||
    value === 'verified' ||
    value === 'contradicted' ||
    value === 'blocked'
  );
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inputInvalid(message: string): { ok: false; diagnostics: Diagnostic[] } {
  return {
    ok: false,
    diagnostics: [
      ledgerDiagnostic(ARXIC_INTENT_LEDGER_INPUT_INVALID, 'intent-ledger.inputs', message),
    ],
  };
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
