import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { ArtifactRef, StagedBundle } from '@arxic/contracts';
import { AUTH_DOMAIN, authDomainSeeder } from '@arxic/auth-domain-pack';
import { assembleBundle, BundlePromoterAdapter, scanTextForSecrets } from '@arxic/bundle-promoter';
import { ModelAdapter } from '@arxic/model-adapter';
import {
  serializeScreenshotPrivacyPolicy,
  type ScreenshotPrivacyPolicy,
} from '@arxic/playwright-screenshot-privacy';
import {
  PlaywrightVerifier,
  resetAndSeedFixtures,
  type VerificationPersona,
} from '@arxic/verifier';
import {
  FileStageCheckpointer,
  LangGraphOrchestrator,
  WorkerRestartError,
  type FixtureLeaseState,
  type OrchestratorInput,
  type OrchestratorOptions,
  type RunState,
} from '@arxic/orchestrator-langgraph';
import {
  INTENT_LEDGER_FILENAME,
  stageIntentLedger,
  type StageIntentLedgerOutcome,
} from '../../../packages/intent/src/ledger';
import { ARXIC_EXEC_RESUMED, cliDiagnostic } from './diagnostics';
import {
  runResultFromState,
  type DiagnosticSink,
  type RunExecutor,
  type RunRequest,
  type RunResult,
} from './executor';

export class LocalRunExecutor implements RunExecutor {
  async execute(request: RunRequest, sink: DiagnosticSink): Promise<RunResult> {
    const baseInput = toOrchestratorInput(request);
    const buildDigest = await targetBuildDigest(
      request.config.target.origin,
      request.config.target.attestationPath,
    );
    const input: OrchestratorInput = {
      ...baseInput,
      ...(buildDigest ? { appBuildDigest: buildDigest } : {}),
    };
    const orchestrator = new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(request.runDirectory),
      ...localPipelineOptions(request),
      ...(request.now === undefined ? {} : { now: request.now }),
    });
    const emitted = [];
    let state: RunState;
    try {
      state = await orchestrator.run(input);
    } catch (error) {
      if (!(error instanceof WorkerRestartError)) throw error;
      const resumed = cliDiagnostic(
        ARXIC_EXEC_RESUMED,
        'observed',
        request.runId,
        'Worker restarted; resumed once from the last stage checkpoint',
      );
      sink.emit(resumed);
      emitted.push(resumed);
      state = await orchestrator.run(input);
    }
    // DG-07 (#251, C-1): every run that produced a stage-13 inventory carries
    // an `intents.json` at its run root. Promoted/compiled runs staged it
    // before freeze inside the verify callback; this idempotent hook covers
    // the remaining runs (no model, uncompiled, blocked).
    const runRoot = resolve(request.runDirectory, request.runId);
    const postRunLedger = await stageIntentLedger({
      runDirectory: runRoot,
      generatedAt: ledgerTimestamp(request),
      scan: scanTextForSecrets,
      skipIfPresent: true,
    });
    if (!postRunLedger.ok) postRunLedger.diagnostics.forEach((diagnostic) => sink.emit(diagnostic));
    state.diagnostics.forEach((diagnostic) => sink.emit(diagnostic));
    const diagnostics = [...emitted, ...state.diagnostics];
    return runResultFromState(request, state, diagnostics);
  }
}

export function toOrchestratorInput(request: RunRequest): OrchestratorInput {
  const repository = resolve(request.config.source.repository);
  const commit = resolveCommit(repository, request.config.source.revision);
  return {
    runId: request.runId,
    origin: request.config.target.origin,
    revision: {
      repository: pathToFileURL(repository).href,
      commit,
      dirty: false,
    },
    rulepacksDir: request.rulepacksDir,
    artifactsDir: request.runDirectory,
    framework: request.config.scope.frameworks[0],
    features: request.config.scope.domains,
    languages: request.config.source.languages,
    personas: request.config.scope.personas,
    maxUrls: request.config.policy.maxUrls,
    maxDepth: request.config.policy.maxDepth,
    // DG-289 C-4 (#289, DECISION issuecomment-5360240026): config-declared
    // target.allowedOrigins flows into the runtime origin gates (crawl
    // origin gate + exploration PolicyEngine). Validation requires the field
    // for CLI configs, but programmatic RunRequest callers may omit it — the
    // conditional spread keeps that path fail-closed downstream (gates
    // default to the target origin only) instead of crashing here.
    ...(request.config.target.allowedOrigins?.length
      ? { allowedOrigins: [...request.config.target.allowedOrigins] }
      : {}),
  };
}

function localPipelineOptions(
  request: RunRequest,
): Omit<OrchestratorOptions, 'checkpointer' | 'now'> {
  const model = configuredModel(request);
  const persona = configuredPersona();
  const outputDirectory = join(request.runDirectory, request.runId);
  const verificationArtifacts = join(request.runDirectory, 'verification-artifacts');
  const options: Omit<OrchestratorOptions, 'checkpointer' | 'now'> = {
    verify: async (compilation) => {
      if (!compilation.stagedBundle) return uncompiledVerification();
      const verification = await new PlaywrightVerifier({
        outputDirectory,
        origin: request.config.target.origin,
        artifactsDir: verificationArtifacts,
        ...(persona ? { persona } : {}),
        screenshotPrivacyPolicy: cliScreenshotPolicy(
          request.runId,
          request.now?.() ?? new Date().toISOString(),
        ),
        ...(request.now === undefined ? {} : { now: request.now }),
      }).verify(compilation.stagedBundle, compilation.stagedBundle.workflow.verification);
      // DG-07 (#251, C-2 + C-6a): the deterministic ledger is built from the
      // run's stage artifacts (13/04/09 resolved from the run root; stage 10
      // supplied in-memory), redaction-scanned over its exact bytes, and
      // staged on the bundle BEFORE freeze. Any failure blocks the verified
      // result fail-closed — no ledger, no promotion.
      const ledger = await stageIntentLedger({
        runDirectory: outputDirectory,
        generatedAt: ledgerTimestamp(request),
        scan: scanTextForSecrets,
        verificationOverride: {
          outcome: verification.outcome,
          runs: verification.runs.map(({ passed }) => ({ passed })),
        },
      });
      if (!ledger.ok) {
        return {
          ...verification,
          outcome: 'blocked',
          diagnostics: [...verification.diagnostics, ...ledger.diagnostics],
          gates: [
            { gate: 'verify', passed: false },
            { gate: 'intent-ledger', passed: false },
          ],
        };
      }
      return {
        ...verification,
        stagedBundle: promotionReadyBundle(
          withIntentLedgerArtifact(compilation.stagedBundle, ledger),
          request,
        ),
        artifacts: verification.artifacts.map((artifact) => ({
          ...artifact,
          path: isAbsolute(artifact.path)
            ? artifact.path
            : resolve(request.runDirectory, artifact.path),
        })),
        gates: [
          { gate: 'verify', passed: verification.outcome === 'verified' },
          { gate: 'intent-ledger', passed: true },
        ],
      };
    },
    promote: async (bundle, gates) => {
      await assemblePromotedBundle(bundle, request);
      return new BundlePromoterAdapter({
        publicPath: join(request.runDirectory, 'promoted', `${request.runId}.bundle.json`),
        ...(request.now === undefined ? {} : { now: request.now }),
      }).promote(bundle, [...gates]);
    },
  };
  if (!model) {
    // DG-08 (ADR-008 Decision 4): with no model configured the pipeline stays
    // honestly empty — no fabricated candidates; the stage-13 inventory
    // dispositions remain the run's honest denominator.
    return options;
  }
  // DG-08: model output drives compilation directly. The canned
  // authentication.login replacement gate is REMOVED (ADR-008 Decision 4);
  // the auth domain pack participates only as an optional SEEDER whose
  // proposals flow through the same binding/dedupe/evidence gates as model
  // output (ADR-008 Decision 3). The domain literal lives in the pack
  // (AUTH_DOMAIN), never in pipeline code.
  const seeders = request.config.scope.domains.includes(AUTH_DOMAIN)
    ? [authDomainSeeder]
    : undefined;
  return {
    ...options,
    modelAdapter: model.adapter,
    model: model.name,
    ...(seeders ? { domainSeeders: seeders } : {}),
    ...(modelBudgetUsd() !== undefined ? { modelBudgetUsd: modelBudgetUsd() } : {}),
    ...(persona ? { explorationInputValues: personaInputValues(persona) } : {}),
    ...(persona ? { explorationInputKind: 'persona' } : {}),
    prepareFixtures: async ({ candidates }) => {
      // Proposal candidates (no workflow skeleton) drive their form under a
      // PERSONA lease at stage 8 (leased-fixtures-only mutation policy).
      // Without a configured persona nothing is provisioned: the mutation
      // step is then policy-skipped and the compile stage honestly blocks
      // OBSERVATION-MISSING — no fabricated assertions, no silent mutation.
      const drivesForm = candidates.some((candidate) => !candidate.workflow);
      if (!drivesForm || !persona) {
        return { provisioned: true, requirements: [], leases: [], diagnostics: [] };
      }
      await resetAndSeedFixtures(request.config.target.origin, persona);
      return {
        provisioned: true,
        requirements: [{ kind: 'persona' }],
        leases: [personaLeaseFor(request)],
        diagnostics: [],
      };
    },
  };
}

/**
 * A persona lease authorizing the stage-8 exploration's reversible form
 * submit under the policy engine (leased-fixtures-only mutation policy).
 */
function personaLeaseFor(request: RunRequest): FixtureLeaseState {
  const now = Date.parse(request.now?.() ?? new Date().toISOString());
  return {
    id: `persona-${request.runId}`,
    requirement: { kind: 'persona' },
    owner: request.runId,
    expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
    inUse: false,
  };
}

/**
 * Transient exploration input values (inputRef -> value) for the default
 * form-drive plan: the verifier's own persona env naming, so the same values
 * exploration used are what the compiled spec replays from env. Values exist
 * only in memory — never in artifacts, checkpoints, or diagnostics.
 */
function personaInputValues(persona: VerificationPersona): Readonly<Record<string, string>> {
  const values: Record<string, string> = { 'persona.email': persona.email };
  if (persona.password !== undefined) values['persona.password'] = persona.password;
  if (persona.newPassword !== undefined) values['persona.newpassword'] = persona.newPassword;
  return values;
}

/** ADR-008 Decision 4 budget cap: owner-overridable via env, default $0.025. */
function modelBudgetUsd(): number | undefined {
  const raw = process.env.ARXIC_MODEL_BUDGET_USD?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function assemblePromotedBundle(bundle: StagedBundle, request: RunRequest): Promise<void> {
  const stagedDirectory = resolve(request.runDirectory, request.runId);
  const verificationArtifacts = bundle.artifacts.filter(
    ({ kind }) =>
      kind === 'screenshot' ||
      kind === 'screenshot-privacy-report' ||
      kind === 'trace' ||
      kind === 'trace-sanitization-report',
  );
  const stagedArtifacts = bundle.artifacts
    .filter((artifact) => !verificationArtifacts.includes(artifact))
    .map((artifact) => ({ ...artifact, path: relative(stagedDirectory, artifact.path) }));
  const stagedBundle: StagedBundle = {
    ...bundle,
    artifacts: stagedArtifacts,
  };
  await assembleBundle({
    bundle: stagedBundle,
    stagedDirectory,
    outputDirectory: join(request.runDirectory, 'promoted', `${request.runId}.bundle`),
    verificationArtifacts,
    provenance: {
      repository: bundle.manifest.repository,
      commit: bundle.manifest.commit,
      appBuildDigest: bundle.manifest.appBuildDigest,
      toolVersions: { '@arxic/cli': bundle.manifest.generator.version },
    },
    ...(request.now === undefined ? {} : { now: request.now }),
  });
}

function promotionReadyBundle(bundle: StagedBundle, request: RunRequest): StagedBundle {
  const runRoot = resolve(request.runDirectory, request.runId);
  const artifacts = bundle.artifacts.map((artifact) => ({
    ...artifact,
    path: isAbsolute(artifact.path) ? artifact.path : resolve(runRoot, artifact.path),
  }));
  return {
    ...bundle,
    artifacts,
    manifest: {
      ...bundle.manifest,
      fileHashes: artifacts.map(({ path, sha256 }) => ({ path, sha256 })),
    },
  };
}

/**
 * DG-07 (#251, C-2 + D-1): declares the run-root `intents.json` as a staged
 * bundle artifact (kind `intent-ledger`) so it rides `manifest.fileHashes`,
 * the frozen bundle artifact refs, and — via `assembleBundle` — the assembled
 * bundle root + `checksums.sha256`. NO manifest schema change.
 */
function withIntentLedgerArtifact(
  bundle: StagedBundle,
  ledger: Extract<StageIntentLedgerOutcome, { ok: true }>,
): StagedBundle {
  const artifact: ArtifactRef = {
    kind: 'intent-ledger',
    path: INTENT_LEDGER_FILENAME,
    sha256: ledger.sha256,
  };
  return { ...bundle, artifacts: [...bundle.artifacts, artifact] };
}

function ledgerTimestamp(request: RunRequest): string {
  return request.now?.() ?? new Date().toISOString();
}

function configuredModel(request: RunRequest): { adapter: ModelAdapter; name: string } | undefined {
  const baseUrl = process.env.ARXIC_MODEL_BASE_URL?.trim();
  const apiKey = process.env.ARXIC_MODEL_API_KEY?.trim();
  const provider = request.config.models.provider.trim();
  if (!baseUrl || !apiKey || isUnconfiguredProvider(provider)) return undefined;
  return {
    adapter: new ModelAdapter({
      baseUrl,
      credentials: () => process.env.ARXIC_MODEL_API_KEY ?? '',
      providerMeta: { sourceSharing: request.config.models.sourceRetention },
      ...(request.now === undefined ? {} : { now: request.now }),
    }),
    name: provider,
  };
}

function isUnconfiguredProvider(provider: string): boolean {
  return ['none', 'disabled', 'unconfigured'].includes(provider.toLowerCase());
}

function configuredPersona(): VerificationPersona | undefined {
  const email = process.env.ARXIC_INPUT_PERSONA_EMAIL?.trim();
  const password = process.env.ARXIC_INPUT_PERSONA_PASSWORD;
  if (!email || !password) return undefined;
  const newPassword = process.env.ARXIC_INPUT_PERSONA_NEWPASSWORD;
  return { email, password, ...(newPassword ? { newPassword } : {}) };
}

function uncompiledVerification() {
  return {
    outcome: 'observed' as const,
    diagnostics: [],
    artifacts: [],
    runs: [],
    gates: [{ gate: 'verify', passed: false }],
  };
}

function cliScreenshotPolicy(runId: string, recordedAt: string): ScreenshotPrivacyPolicy {
  return serializeScreenshotPrivacyPolicy({
    schemaVersion: 1,
    id: `${runId}-cli-main-mask`,
    authority: {
      kind: 'repository-policy',
      reference: 'arxic.yaml:policy.screenshots',
      recordedAt,
    },
    capture: {
      mode: 'masked-page',
      fullPage: true,
      masks: [{ kind: 'role', role: 'main', exact: true }],
    },
  }).policy;
}

async function targetBuildDigest(
  origin: string,
  attestationPath: string,
): Promise<string | undefined> {
  try {
    const response = await fetch(new URL(attestationPath, origin));
    if (!response.ok) return undefined;
    const value = (await response.json()) as { buildDigest?: unknown };
    return typeof value.buildDigest === 'string' && /^[0-9a-f]{64}$/iu.test(value.buildDigest)
      ? value.buildDigest
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveCommit(repository: string, revision: string): string {
  if (/^[0-9a-f]{40}$/u.test(revision)) return revision;
  try {
    return execFileSync(
      'git',
      ['-C', repository, 'rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return revision;
  }
}
