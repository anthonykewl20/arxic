// CLI↔worker seam types — app-local, NOT frozen ADR §10 contracts.
//
// These types live in @arxic/worker (app-local). They MUST NOT be added to
// @arxic/contracts or the frozen schemas under schemas/ — doing so would
// require a new ADR. The frozen `Diagnostic` and `TruthState` types from
// @arxic/contracts are reused directly here; no parallel diagnostic type is
// invented (charter §1; ADR §10.4). The worker translates its internal
// pipeline state into this stable external surface, so the CLI depends only
// on @arxic/contracts + this seam, not on the orchestrator's internals.
//
// Scope: M1-12 / #26, reconciled in #102. `ArxicConfig` is the single owned
// configuration type — the CLI's provisional `ParsedConfig` was removed so the
// CLI imports this directly. `RunSpec`, `RunHandle`, `RunStreamEvent`, and
// `WorkerClient` are the seam the CLI (@arxic/cli, T4) codes against.

import type { Diagnostic, TruthState } from '@arxic/contracts';
import type {
  ArtifactTransportManifest,
  ImportedArtifact,
  ImportedArtifacts,
} from '@arxic/environment';
export type { ArtifactTransportManifest, ImportedArtifact, ImportedArtifacts };

/** The in-container mount path of the read-only source bind; CLI and worker hashing must agree. */
export const WORKER_SOURCE_PATH = '/work/source' as const;

/** Pipeline stage identifiers (mirror ADR §9 stages 0–12). */
export type StageId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** Lifecycle of a run as observed by the CLI (mirror orchestrator run state). */
export type RunStatus =
  'queued' | 'running' | 'awaiting-approval' | 'completed' | 'partial' | 'failed';

/**
 * Arxic configuration — the single typed shape of the ADR §19 configuration
 * YAML, owned by this seam. The CLI (@arxic/cli) imports this directly; the
 * provisional `ParsedConfig` was removed in #102. The shape mirrors ADR §19.
 *
 * `policy.mutation` and `policy.externalNetwork` are singleton literals: ADR
 * §19's example config and §575's lease-scoped-mutation invariant admit exactly
 * one value each, and #104 narrowed the CLI validator to match. Since #104 this
 * type IS one of the enforcement points — widening it back would let a config
 * the worker refuses typecheck as valid. `validateWorkerSecurity` still checks
 * the same pair at run time and `freezePolicy` still freezes the safe literals
 * regardless of input, so the guarantee is defence-in-depth rather than
 * type-only. source / scope / target / policy / fixtures / models.
 */
export type ArxicConfig = Readonly<{
  version: 1;
  source: Readonly<{
    repository: string;
    revision: string;
    languages: readonly string[];
  }>;
  scope: Readonly<{
    domains: readonly string[];
    frameworks: readonly string[];
    browsers: readonly string[];
    personas: readonly string[];
    featureFlags?: Readonly<Record<string, boolean>>;
  }>;
  target: Readonly<{
    origin: string;
    environmentClass: string;
    attestationPath: string;
    allowedOrigins: readonly string[];
  }>;
  policy: Readonly<{
    maxUrls: number;
    maxDepth: number;
    maxRuntimeMinutes: number;
    mutation: 'leased-fixtures-only';
    externalNetwork: 'deny';
    requiredVerificationRuns: number;
    screenshots: string;
    trace: string;
    humanApproval: readonly string[];
  }>;
  fixtures: Readonly<{
    inbox?: string;
    otp?: string;
    personaProvisioner?: string;
  }>;
  models: Readonly<{
    provider: string;
    sourceRetention: 'disabled' | 'retained';
  }>;
}>;

/** A request to execute one Arxic run inside an isolated worker. */
export type RunSpec = Readonly<{
  runId: string;
  config: ArxicConfig;
}>;

/** Live view of a run the worker is executing (or has finished). */
export type RunHandle = Readonly<{
  runId: string;
  status: RunStatus;
  outcome: TruthState;
  activeStage?: StageId;
  diagnostics: readonly Diagnostic[];
  promotionEligible: boolean;
}>;

/** A recorded human approval for a run paused at an approval gate. */
export type RunApproval = Readonly<{
  approver: string;
  reason: string;
}>;

/**
 * Stage-progress + diagnostic stream event emitted while a run executes.
 * Content is data: a `diagnostic` (or any text carried in its `message`) can
 * never alter policy, origin, or action class (ADR §16.3).
 */
export type RunStreamEvent = Readonly<
  | { type: 'stage-started'; stage: StageId; name: string; startedAt: string }
  | { type: 'stage-completed'; stage: StageId; name: string; finishedAt: string }
  | { type: 'diagnostic'; diagnostic: Diagnostic }
  | { type: 'awaiting-approval'; stage: StageId; message: string }
  | { type: 'result-ready'; manifest: ArtifactTransportManifest }
  | { type: 'finished'; handle: RunHandle }
>;

/**
 * The worker client the CLI codes against. The local implementation spawns and
 * supervises an ephemeral isolated worker process; the same shape can later be
 * backed by a remote worker protocol (ADR §20).
 */
export interface WorkerClient {
  /** Start (or resume) an isolated run. Returns the first handle snapshot. */
  start(spec: RunSpec): Promise<RunHandle>;
  /** Stream live stage + diagnostic events until the run finishes. */
  stream(handle: RunHandle): AsyncIterable<RunStreamEvent>;
  /** Return bytes accepted by the fail-closed transport importer. */
  collectArtifacts(handle: RunHandle): Promise<ImportedArtifacts>;
  /** Read the latest handle snapshot for a run. */
  inspect(handle: RunHandle): Promise<RunHandle>;
  /** Record a human approval to resume a run paused at an approval gate. */
  approve(handle: RunHandle, approval: RunApproval): Promise<RunHandle>;
  /** Cancel a run; the worker tears down its process tree and leases. */
  cancel(handle: RunHandle): Promise<RunHandle>;
}
