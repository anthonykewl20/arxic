import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { sha256, type Diagnostic, type StagedBundle } from '@arxic/contracts';
import { AUTH_DOMAIN, authDomainSeeder } from '@arxic/auth-domain-pack';
import { ModelAdapter, createHostCliTransport, hostCliConfigFromEnv } from '@arxic/model-adapter';
import {
  FileStageCheckpointer,
  LangGraphOrchestrator,
  ORCHESTRATOR_VERSION,
  WorkerRestartError,
  type FixtureLeaseState,
  type ModelPrices,
  type OrchestratorInput,
  type OrchestratorOptions,
  type RunState,
} from '@arxic/orchestrator-langgraph';
import {
  serializeScreenshotPrivacyPolicy,
  type ScreenshotPrivacyPolicy,
} from '@arxic/playwright-screenshot-privacy';
import {
  PlaywrightVerifier,
  resetAndSeedFixtures,
  type VerificationPersona,
} from '@arxic/verifier';
import { canonicalPipelineJson, PIPELINE_RESULT_PATH } from './pipeline-result';
import { projectPipelineResult, type VolumeFile } from './runner-project';
import type { RunSpec } from './run-spec';
import { hashSourceTree } from './source-tree-hash';

const RESULT_ROOT = '/work/result';
const PIPELINE_WORK_ROOT = '/work/pipeline';

async function main(): Promise<void> {
  const spec = readRunSpec();
  if (!spec) {
    process.stderr.write('ARXIC worker run specification is invalid\n');
    process.exit(2);
  }
  const workerTmpDir = '/work/.tmp';
  await mkdir(workerTmpDir, { recursive: true, mode: 0o700 });
  process.env.TMPDIR ??= workerTmpDir;
  const now = () => new Date().toISOString();
  let appBuildDigest: string | undefined;
  try {
    appBuildDigest = await targetBuildDigest(
      spec.config.target.origin,
      spec.config.target.attestationPath,
    );
    const input = orchestratorInput(spec, appBuildDigest);
    const orchestrator = new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(join(RESULT_ROOT, 'checkpoints')),
      ...pipelineOptions(spec, now),
      now,
    });
    let state: RunState;
    try {
      state = await orchestrator.run(input);
    } catch (error) {
      if (!(error instanceof WorkerRestartError)) throw error;
      state = await orchestrator.run(input);
    }
    await writeProjectedResult(spec, state, now, appBuildDigest);
    process.exit(0);
  } catch (error) {
    const name = error instanceof Error ? error.name : typeof error;
    const safeMessage = String(error instanceof Error ? error.message : String(error))
      .slice(0, 200)
      .split('\n')[0];
    process.stderr.write(`ARXIC-WORKER-RUNNER-ERROR name=${name} message=${safeMessage}\n`);
    await writeFailureResult(spec, now, appBuildDigest).catch(() => undefined);
    process.exit(1);
  }
}

function readRunSpec(): RunSpec | undefined {
  const encoded = process.env.ARXIC_RUN_SPEC;
  if (!encoded) return undefined;
  try {
    const value = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as unknown;
    return isRunSpec(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isRunSpec(value: unknown): value is RunSpec {
  if (
    !isRecord(value) ||
    typeof value.runId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.runId) ||
    !isRecord(value.config)
  )
    return false;
  const config = value.config;
  return (
    config.version === 1 &&
    isRecord(config.source) &&
    typeof config.source.repository === 'string' &&
    typeof config.source.revision === 'string' &&
    Array.isArray(config.source.languages) &&
    isRecord(config.scope) &&
    Array.isArray(config.scope.domains) &&
    Array.isArray(config.scope.frameworks) &&
    Array.isArray(config.scope.personas) &&
    isRecord(config.target) &&
    typeof config.target.origin === 'string' &&
    typeof config.target.attestationPath === 'string' &&
    isRecord(config.policy) &&
    typeof config.policy.maxUrls === 'number' &&
    typeof config.policy.maxDepth === 'number' &&
    typeof config.policy.requiredVerificationRuns === 'number' &&
    isRecord(config.models) &&
    typeof config.models.provider === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function orchestratorInput(spec: RunSpec, appBuildDigest?: string): OrchestratorInput {
  return {
    runId: spec.runId,
    origin: spec.config.target.origin,
    revision: {
      repository: 'file:///work/source',
      commit: resolveCommit('/work/source', spec.config.source.revision),
      dirty: false,
    },
    rulepacksDir: '/app/rulepacks',
    artifactsDir: PIPELINE_WORK_ROOT,
    framework: spec.config.scope.frameworks[0],
    features: spec.config.scope.domains,
    languages: spec.config.source.languages,
    personas: spec.config.scope.personas,
    maxUrls: spec.config.policy.maxUrls,
    maxDepth: spec.config.policy.maxDepth,
    ...(appBuildDigest ? { appBuildDigest } : {}),
  };
}

function pipelineOptions(
  spec: RunSpec,
  now: () => string,
): Omit<OrchestratorOptions, 'checkpointer' | 'now'> {
  const model = configuredModel(spec, now);
  const persona = configuredPersona();
  const options: Omit<OrchestratorOptions, 'checkpointer' | 'now'> = {
    promote: async (bundle) => ({
      manifest: bundle.manifest,
      promotedAt: now(),
      location: `worker-candidate://${spec.runId}`,
      checksumSha256: sha256(spec.runId),
    }),
    verify: async (compilation) => {
      if (!compilation.stagedBundle) return uncompiledVerification();
      const verification = await new PlaywrightVerifier({
        outputDirectory: join(PIPELINE_WORK_ROOT, spec.runId),
        origin: spec.config.target.origin,
        artifactsDir: join(PIPELINE_WORK_ROOT, 'verification-artifacts'),
        ...(persona ? { persona } : {}),
        screenshotPrivacyPolicy: cliScreenshotPolicy(spec.runId, now()),
        now,
      }).verify(compilation.stagedBundle, compilation.stagedBundle.workflow.verification);
      const artifacts = await transportArtifacts(verification.artifacts, spec);
      return {
        ...verification,
        stagedBundle: await promotionReadyBundle(compilation.stagedBundle, spec),
        artifacts,
        gates: [{ gate: 'verify', passed: verification.outcome === 'verified' }],
      };
    },
  };
  if (!model) {
    // DG-08 (ADR-008 Decision 4): with no model configured the worker stays
    // honestly empty — no fabricated candidates; the stage-13 inventory
    // dispositions remain the run's honest denominator.
    return options;
  }
  // DG-08 remediation (P1, #252): the worker mirrors the CLI local executor —
  // the canned authentication.login substitution gate is GONE. Model output
  // drives compilation directly through the IntentProposer over the stage-13
  // Domain Inventory; the auth domain pack participates only as an optional
  // SEEDER whose proposals flow through the same binding/dedupe/evidence
  // gates as model output (ADR-008 Decision 3; the domain literal lives in
  // the pack, never here). Exploration is the orchestrator's inventory-derived
  // form drive (persona lease + transient input values), never a hardcoded
  // domain route.
  const seeders = spec.config.scope.domains.includes(AUTH_DOMAIN) ? [authDomainSeeder] : undefined;
  return {
    ...options,
    modelAdapter: model.adapter,
    model: model.name,
    ...(model.prices ? { modelPrices: model.prices } : {}),
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
      await resetAndSeedFixtures(spec.config.target.origin, persona);
      return {
        provisioned: true,
        requirements: [{ kind: 'persona' }],
        leases: [personaLeaseFor(spec, now)],
        diagnostics: [],
      };
    },
  };
}

/** A persona lease authorizing the stage-8 form submit (leased fixtures only). */
function personaLeaseFor(spec: RunSpec, now: () => string): FixtureLeaseState {
  return {
    id: `persona-${spec.runId}`,
    requirement: { kind: 'persona' },
    owner: spec.runId,
    expiresAt: new Date(Date.parse(now()) + 30 * 60 * 1000).toISOString(),
    inUse: false,
  };
}

/**
 * Transient exploration input values (inputRef -> value) for the default
 * form-drive plan, mirroring the CLI: the verifier's own persona env naming,
 * so the compiled spec replays from the same env. Values exist only in
 * memory — never in artifacts, checkpoints, or diagnostics.
 */
function personaInputValues(persona: VerificationPersona): Readonly<Record<string, string>> {
  const values: Record<string, string> = { 'persona.email': persona.email };
  if (persona.password !== undefined) values['persona.password'] = persona.password;
  if (persona.newPassword !== undefined) values['persona.newpassword'] = persona.newPassword;
  return values;
}

/** ADR-008 Decision 4 budget cap: owner-overridable via env, default $0.0253. */
function modelBudgetUsd(): number | undefined {
  const raw = process.env.ARXIC_MODEL_BUDGET_USD?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Zero-price marker for the host-bound CLI transport (#host-bound-model):
 * a local agent CLI is not metered per-token, so the pre-call budget
 * estimate must be pinned to zero explicitly rather than falling through to
 * `resolveModelPrices`, which would either throw (unknown model id) or —
 * worse — silently reuse another model's rates (the #337 bug). */
const HOST_CLI_PRICES: ModelPrices = { promptPerMillion: 0, completionPerMillion: 0 };

function configuredModel(
  spec: RunSpec,
  now: () => string,
): { adapter: ModelAdapter; name: string; prices?: ModelPrices } | undefined {
  const provider = spec.config.models.provider.trim();
  if (['none', 'disabled', 'unconfigured'].includes(provider.toLowerCase())) {
    return undefined;
  }

  if ((process.env.ARXIC_MODEL_PROVIDER?.trim().toLowerCase() ?? '') === 'host-cli') {
    const hostCliConfig = hostCliConfigFromEnv();
    if (!hostCliConfig) {
      throw new Error(
        'ARXIC_MODEL_PROVIDER=host-cli requires ARXIC_MODEL_HOST_CLI to name the agent CLI executable',
      );
    }
    return {
      adapter: new ModelAdapter({
        // Unused by the host-cli transport (no HTTP call is made); kept
        // non-empty only to satisfy ModelAdapterOptions' shape.
        baseUrl: 'host-cli://local',
        credentials: () => 'host-bound-local',
        transport: createHostCliTransport(hostCliConfig),
        providerMeta: {
          sourceSharing: spec.config.models.sourceRetention,
          provider: 'host-bound',
        },
        now,
      }),
      name: provider,
      prices: HOST_CLI_PRICES,
    };
  }

  const baseUrl = process.env.ARXIC_MODEL_BASE_URL?.trim();
  const apiKey = process.env.ARXIC_MODEL_API_KEY?.trim();
  if (!baseUrl || !apiKey) return undefined;
  return {
    adapter: new ModelAdapter({
      baseUrl,
      credentials: () => process.env.ARXIC_MODEL_API_KEY ?? '',
      providerMeta: { sourceSharing: spec.config.models.sourceRetention },
      now,
    }),
    name: provider,
  };
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

async function promotionReadyBundle(bundle: StagedBundle, spec: RunSpec): Promise<StagedBundle> {
  const artifacts = await transportArtifacts(bundle.artifacts, spec);
  return {
    ...bundle,
    artifacts,
    manifest: {
      ...bundle.manifest,
      fileHashes: artifacts.map(({ path, sha256 }) => ({ path, sha256 })),
    },
  };
}

async function transportArtifacts<T extends { path: string }>(
  artifacts: readonly T[],
  spec: RunSpec,
): Promise<T[]> {
  const runRoot = resolve(PIPELINE_WORK_ROOT, spec.runId);
  return Promise.all(
    artifacts.map(async (artifact) => {
      const source = isAbsolute(artifact.path) ? artifact.path : resolve(runRoot, artifact.path);
      const relativePath = relative(PIPELINE_WORK_ROOT, source).split(sep).join('/');
      if (relativePath.startsWith('../') || relativePath === '..' || isAbsolute(relativePath)) {
        throw new Error('Staged bundle artifact escapes the pipeline workspace');
      }
      const path = `candidate/${spec.runId}/${relativePath}`;
      const destination = resolve(RESULT_ROOT, path);
      await mkdir(resolve(destination, '..'), { recursive: true, mode: 0o700 });
      await copyFile(source, destination);
      return { ...artifact, path };
    }),
  );
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

async function writeProjectedResult(
  spec: RunSpec,
  state: RunState,
  now: () => string,
  appBuildDigest?: string,
): Promise<void> {
  const volumeFiles = await readVolumeFiles();
  const { sourceSha256 } = await hashSourceTree('/work/source');
  const projected = projectPipelineResult({
    spec,
    state,
    volumeFiles,
    sourceSha256,
    now,
    ...(appBuildDigest ? { appBuildDigest } : {}),
    orchestratorVersion: ORCHESTRATOR_VERSION,
  });
  await writeFile(join(RESULT_ROOT, PIPELINE_RESULT_PATH), projected.pipelineResultBytes, {
    mode: 0o600,
  });
  await writeFile(
    join(RESULT_ROOT, 'result-manifest.json'),
    `${canonicalPipelineJson(projected.manifest)}\n`,
    { mode: 0o600 },
  );
}

async function writeFailureResult(
  spec: RunSpec,
  now: () => string,
  appBuildDigest?: string,
): Promise<void> {
  const diagnostic: Diagnostic = {
    code: 'ARXIC-WORKER-RUN-FAILED',
    severity: 'blocked',
    subject: spec.runId,
    message: 'The isolated worker pipeline failed.',
  };
  const state: RunState = {
    runId: spec.runId,
    status: 'failed',
    outcome: 'blocked',
    completedStages: [],
    artifacts: {},
    checkpoints: [],
    diagnostics: [diagnostic],
    promotionEligible: false,
  };
  await writeProjectedResult(spec, state, now, appBuildDigest);
}

async function readVolumeFiles(): Promise<VolumeFile[]> {
  const files: VolumeFile[] = [];
  await walkVolume(RESULT_ROOT, RESULT_ROOT, files);
  return files
    .filter(({ path }) => path !== 'result-manifest.json' && path !== PIPELINE_RESULT_PATH)
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function walkVolume(root: string, directory: string, files: VolumeFile[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) await walkVolume(root, absolute, files);
    else if (entry.isFile()) {
      files.push({
        path: relative(root, absolute).split(sep).join('/'),
        bytes: await readFile(absolute),
      });
    }
  }
}

await main();
