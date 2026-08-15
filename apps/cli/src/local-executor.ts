import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { StagedBundle } from '@arxic/contracts';
import { authCandidates, type AuthSurface } from '@arxic/auth-domain-pack';
import { assembleBundle, BundlePromoterAdapter } from '@arxic/bundle-promoter';
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
  runPlannedExploration,
  stage4Infer,
  WorkerRestartError,
  type Candidate,
  type ExplorationResult,
  type InferenceInput,
  type InferenceResult,
  type OrchestratorInput,
  type OrchestratorOptions,
  type RunState,
} from '@arxic/orchestrator-langgraph';
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
      ...localPipelineOptions(request, input),
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
  };
}

function localPipelineOptions(
  request: RunRequest,
  input: OrchestratorInput,
): Omit<OrchestratorOptions, 'checkpointer' | 'now'> {
  const model = configuredModel(request);
  const persona = configuredPersona();
  const outputDirectory = join(request.runDirectory, request.runId);
  const verificationArtifacts = join(request.runDirectory, 'verification-artifacts');
  const inferredSourceEvidence: Array<InferenceInput['evidenceRefs'][number]> = [];
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
      return {
        ...verification,
        stagedBundle: promotionReadyBundle(compilation.stagedBundle, request),
        artifacts: verification.artifacts.map((artifact) => ({
          ...artifact,
          path: isAbsolute(artifact.path)
            ? artifact.path
            : resolve(request.runDirectory, artifact.path),
        })),
        gates: [{ gate: 'verify', passed: verification.outcome === 'verified' }],
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
  if (!model) return options;

  const inferWithModel = stage4Infer(model.adapter, model.name);
  return {
    ...options,
    modelAdapter: model.adapter,
    model: model.name,
    inferCandidates: async (inferenceInput) => {
      inferredSourceEvidence.splice(
        0,
        inferredSourceEvidence.length,
        ...inferenceInput.evidenceRefs,
      );
      const inferred = await inferWithModel(inferenceInput);
      return authDomainCandidates(inferred, inferenceInput, input, request);
    },
    prepareFixtures: async ({ candidates }) => {
      const requirements = candidates.flatMap(
        (candidate) =>
          candidate.workflow?.preconditions.map(({ fixture: kind }) => ({ kind })) ?? [],
      );
      if (requirements.length === 0) {
        return { provisioned: true, requirements: [], leases: [], diagnostics: [] };
      }
      if (!persona) {
        return {
          provisioned: false,
          requirements,
          leases: [],
          diagnostics: [],
        };
      }
      await resetAndSeedFixtures(request.config.target.origin, persona);
      return {
        provisioned: true,
        requirements,
        leases: [],
        diagnostics: [],
      };
    },
    explore: async (explorationInput) => {
      const explored = await runPlannedExploration({
        ...explorationInput,
        plan: {
          steps: [
            {
              kind: 'navigate',
              intent: 'observe authentication entry surface',
              action: 'navigation',
              actionClass: 'read-only',
              url: new URL(
                authSurfaceFromEvidence(inferredSourceEvidence, input.framework).login
                  .entryState === 'home'
                  ? '/'
                  : '/login',
                request.config.target.origin,
              ).href,
              required: true,
            },
          ],
        },
      });
      return withSourceEvidence(explored, inferredSourceEvidence);
    },
  };
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

function authDomainCandidates(
  inferred: unknown,
  inferenceInput: InferenceInput,
  input: OrchestratorInput,
  request: RunRequest,
): unknown {
  if (!isInferenceResult(inferred) || inferred.candidates.length === 0) return inferred;
  if (!request.config.scope.domains.includes('authentication')) return inferred;
  const surface = authSurfaceFromEvidence(inferenceInput.evidenceRefs, input.framework);
  const packed = authCandidates(surface, input.revision.commit).map(toCandidate);
  const packedIds = new Set(packed.map(({ id }) => id));
  const candidates = [...packed, ...inferred.candidates.filter(({ id }) => !packedIds.has(id))];
  return { requestId: inferred.requestId, candidates } satisfies InferenceResult;
}

function authSurfaceFromEvidence(
  evidenceRefs: InferenceInput['evidenceRefs'],
  framework?: string,
): AuthSurface {
  const hasLoginRoute = evidenceRefs.some(
    (evidence) => evidence.kind === 'source' && /(?:^|\/)login(?:\/|\.|$)/iu.test(evidence.path),
  );
  const loginPage = hasLoginRoute || framework === 'nextjs';
  return {
    login: {
      entryState: loginPage ? 'login-page' : 'home',
      successState: 'home',
      assertion: 'url:/',
    },
    logout: { assertion: 'text:Logged out' },
    passwordChange: { supported: false, reason: 'not established by stage-4 source evidence' },
    totp: { supported: false, reason: 'not established by stage-4 source evidence' },
  };
}

function toCandidate(candidate: ReturnType<typeof authCandidates>[number]): Candidate {
  return {
    id: candidate.workflow.id,
    title: candidate.workflow.title,
    evidenceRefs: candidate.workflow.evidenceRefs,
    workflow: candidate.workflow,
  };
}

function withSourceEvidence(
  explored: ExplorationResult,
  sourceEvidence: InferenceInput['evidenceRefs'],
): ExplorationResult {
  return {
    ...explored,
    evidenceRefs: [
      ...sourceEvidence.filter((evidence) => evidence.kind === 'source'),
      ...explored.evidenceRefs,
    ],
  };
}

function isInferenceResult(value: unknown): value is InferenceResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    'candidates' in value &&
    Array.isArray(value.candidates)
  );
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
