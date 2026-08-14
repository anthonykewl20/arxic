import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  BundleManifest,
  Diagnostic,
  EvidenceIndex,
  GateResult,
  PromotionReceipt,
  StagedBundle,
  TruthState,
  Workflow,
} from '@arxic/contracts';
import { ARXIC_VERSION, validateManifest, validateWorkflow } from '@arxic/contracts';
import { AstGrepAdapter, diagnosticsOf } from '@arxic/ast-grep-adapter';
import { BundlePromoterAdapter, projectVerifiedBundle } from '@arxic/bundle-promoter';
import { EnvironmentHandshake } from '@arxic/environment';
import { artifactRef } from '@arxic/verifier';
import {
  generateSpecFromWorkflow,
  renderFallbackConfig,
  renderFallbackSpec,
} from '@arxic/playwright-agent-adapter';
import {
  screenshotPrivacyRuntimeSource,
  type ScreenshotPrivacyPolicy,
} from '@arxic/playwright-screenshot-privacy';
import {
  ARXIC_EXIT_COMPILE_FAILED,
  ARXIC_EXIT_EVIDENCE_GATE_BLOCKED,
  ARXIC_EXIT_PREFLIGHT_FAILED,
  ARXIC_EXIT_PROMOTION_SKIPPED,
  exitDiagnostic,
} from './diagnostics';
import { verifyStagedSuite } from './verifier';

const FIXTURE_NONCE = 'reference-auth-app-fixture-v1';

export type RunM0VerticalInput = {
  candidate: Workflow;
  target: { origin: string; appDir: string; commit: string; appBuildDigest: string };
  rulepacksDir: string;
  artifactsDir: string;
  persona: { email: string; password: string };
  requiredRuns?: number;
  now?: () => string;
  screenshotPrivacyPolicy: ScreenshotPrivacyPolicy;
};

export type M0VerticalResult = {
  outcome: TruthState;
  runs: Array<{ passed: boolean }>;
  receipt?: PromotionReceipt;
  stagedBundle?: StagedBundle;
  diagnostics: Diagnostic[];
};

export type M0PipelineServices = {
  generateSpec: typeof generateSpecFromWorkflow;
};

export async function runM0Vertical(
  input: RunM0VerticalInput,
  services: Partial<M0PipelineServices> = {},
): Promise<M0VerticalResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const requiredRuns = input.requiredRuns ?? 2;
  const diagnostics: Diagnostic[] = [];
  const handshake = await new EnvironmentHandshake().attest(
    { origin: input.target.origin },
    {
      allowedOrigins: [input.target.origin],
      allowedEnvironmentClasses: ['local-test'],
      expectedNonce: FIXTURE_NONCE,
      now,
    },
  );
  if (handshake.disposition !== 'allowed') {
    return {
      outcome: 'blocked',
      runs: [],
      diagnostics: [
        ...handshake.diagnostics,
        exitDiagnostic(
          ARXIC_EXIT_PREFLIGHT_FAILED,
          'blocked',
          input.target.origin,
          'PREFLIGHT target attestation was refused',
        ),
      ],
    };
  }
  const validation = validateWorkflow(input.candidate);
  if (!validation.ok) {
    return compileFailure(input.candidate.id, validation.diagnostics);
  }
  const runId = `m0-exit-${randomUUID()}`;
  const evidenceIndex: EvidenceIndex = {};
  try {
    const source = await new AstGrepAdapter({
      packs: [resolve(input.rulepacksDir, 'nextjs')],
      now,
    }).scan({
      revision: {
        repository: pathToFileURL(resolve(input.target.appDir)).href,
        commit: input.target.commit,
        dirty: false,
      },
      features: ['login'],
      framework: 'nextjs',
    });
    diagnostics.push(...diagnosticsOf(source.events));
    const loginChain = source.chains.find(
      (chain) =>
        chain.framework === 'nextjs' && chain.feature === 'login' && chain.status === 'connected',
    );
    indexSourceEvidence(input.candidate, loginChain?.evidence ?? [], evidenceIndex);
  } catch (error) {
    diagnostics.push(
      exitDiagnostic(
        ARXIC_EXIT_EVIDENCE_GATE_BLOCKED,
        'blocked',
        input.target.appDir,
        `Committed source evidence could not be collected: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
  const testDir = join(input.artifactsDir, 'staged', input.candidate.id, runId);
  const generated = await (services.generateSpec ?? generateSpecFromWorkflow)(input.candidate, {
    origin: input.target.origin,
    testDir,
  });
  if (!generated.ok || !generated.specPath || !generated.configPath || !generated.runtimePath) {
    return compileFailure(input.candidate.id, [...diagnostics, ...generated.diagnostics]);
  }
  let prepared: { spec: string; config: string };
  try {
    prepared = await prepareGeneratedSuite(
      generated.configPath,
      generated.specPath,
      renderFallbackConfig(),
      renderFallbackSpec(input.candidate, input.target.origin),
      input.candidate.verification.forbidNetworkErrors,
    );
  } catch (error) {
    return compileFailure(
      input.candidate.id,
      [...diagnostics, ...generated.diagnostics],
      error instanceof Error ? error.message : String(error),
    );
  }
  // Pre-verification evidence gate: every workflow evidence reference must
  // resolve to trusted indexed evidence BEFORE any Chromium run is spent.
  // Source evidence is indexed above (ast-grep); runtime evidence is added by
  // the pipeline AFTER verification, so any `run:` ref already present in the
  // candidate is inherently unresolvable and is caught here. Checking before
  // verifyStagedSuite keeps this gate deterministic rather than dependent on a
  // browser launch completing (ADR §15; charter §3).
  const unresolvedEvidence = workflowEvidenceIds(input.candidate).filter(
    (evidenceId) => evidenceIndex[evidenceId] === undefined,
  );
  if (unresolvedEvidence.length > 0) {
    diagnostics.push(
      exitDiagnostic(
        ARXIC_EXIT_EVIDENCE_GATE_BLOCKED,
        'blocked',
        input.candidate.id,
        'Workflow evidence references do not resolve to trusted indexed evidence',
      ),
    );
    return skipped('blocked', [], diagnostics, input.candidate.id);
  }
  const verification = await verifyStagedSuite({
    workflow: input.candidate,
    origin: input.target.origin,
    testDir,
    persona: input.persona,
    policy: {
      requiredRuns,
      forbidNetworkErrors: input.candidate.verification.forbidNetworkErrors,
      screenshotCheckpoints: input.candidate.verification.screenshotCheckpoints,
      trace: 'retain',
    },
    artifactsDir: join(input.artifactsDir, 'runs', runId),
    screenshotPrivacy: {
      policy: input.screenshotPrivacyPolicy,
      expectedSpec: prepared.spec,
      specPath: 'workflow.spec.ts',
      runtimePath: 'screenshot-privacy.ts',
      allowedSourcePaths: ['workflow.spec.ts', 'playwright.config.ts', 'screenshot-privacy.ts'],
      trustedSourceContents: {
        'workflow.spec.ts': prepared.spec,
        'playwright.config.ts': prepared.config,
        'screenshot-privacy.ts': screenshotPrivacyRuntimeSource(),
      },
      correlation: (run) => `${runId}-run-${run}`,
      now,
    },
  });
  diagnostics.push(...verification.diagnostics);
  if (verification.outcome !== 'verified') {
    return skipped(verification.outcome, verification.runs, diagnostics, input.candidate.id);
  }
  const supporting = await writeSupportingArtifacts(input, runId, now());
  const boundSourceArtifacts = await Promise.all([
    artifactRef('playwright-config', generated.configPath),
    artifactRef('screenshot-capture-runtime', generated.runtimePath),
  ]);
  const artifacts = [...verification.artifacts, ...boundSourceArtifacts, ...supporting];
  const timestamp = now();
  if (!verification.browserVersion) {
    diagnostics.push(
      exitDiagnostic(
        ARXIC_EXIT_EVIDENCE_GATE_BLOCKED,
        'blocked',
        input.candidate.id,
        'Deterministic verification did not record the trusted Chromium installation version',
      ),
    );
    return skipped('blocked', verification.runs, diagnostics, input.candidate.id);
  }
  const runtimeEvidenceId = `run:${runId}`;
  const projectedCandidate = structuredClone(input.candidate);
  projectedCandidate.evidenceRefs = [
    ...new Set([...projectedCandidate.evidenceRefs, runtimeEvidenceId]),
  ];
  projectedCandidate.transitions = projectedCandidate.transitions.map((transition) =>
    transition.required === false
      ? transition
      : {
          ...transition,
          evidenceRefs: [...new Set([...transition.evidenceRefs, runtimeEvidenceId])],
        },
  );
  evidenceIndex[runtimeEvidenceId] = {
    kind: 'runtime',
    runId,
    appBuildDigest: input.target.appBuildDigest,
    browser: input.candidate.scope.browser,
    browserVersion: verification.browserVersion,
    url: input.target.origin,
    timestamp,
    ...(verification.artifacts.find(({ kind }) => kind === 'screenshot')
      ? {
          screenshotRef: verification.artifacts.find(({ kind }) => kind === 'screenshot')!.path,
        }
      : {}),
  };
  const manifest: BundleManifest = {
    schemaVersion: 1,
    bundleVersion: 1,
    workflow: { id: input.candidate.id, status: input.candidate.status },
    repository: pathToFileURL(resolve(input.target.appDir)).href,
    commit: input.target.commit,
    appBuildDigest: input.target.appBuildDigest,
    environment: {
      class: 'local-test',
      browser: 'chromium',
      persona: input.candidate.persona,
    },
    generator: { id: '@arxic/m0-pipeline', version: ARXIC_VERSION },
    verification: {
      requiredRuns,
      runs: verification.runs.map((run) => ({
        startedAt: timestamp,
        finishedAt: timestamp,
        passed: run.passed,
      })),
    },
    fileHashes: artifacts.map(({ path, sha256 }) => ({ path, sha256 })),
    gateResults: [{ gate: 'attestation', passed: true }],
    coverage: { denominator: 1, verified: 0, contradicted: 0, blocked: 0, uncovered: 1 },
    runId,
  };
  const manifestValidation = validateManifest(manifest);
  if (!manifestValidation.ok)
    return compileFailure(input.candidate.id, manifestValidation.diagnostics);
  const stagedBundleBeforeProjection: StagedBundle = {
    manifest,
    workflow: projectedCandidate,
    evidenceIndex,
    artifacts,
    plan: 'Replay the seeded login workflow twice from clean fixture state.',
  };
  const projection = projectVerifiedBundle(
    stagedBundleBeforeProjection,
    { ...verification, gates: [{ gate: 'verify', passed: true }] },
    timestamp,
  );
  if (!projection.ok) {
    diagnostics.push(
      exitDiagnostic(
        ARXIC_EXIT_EVIDENCE_GATE_BLOCKED,
        'blocked',
        input.candidate.id,
        'Deterministic verification could not produce one coherent staged bundle',
      ),
    );
    return skipped('blocked', verification.runs, diagnostics, input.candidate.id);
  }
  const stagedBundle = projection.value;
  const gates: GateResult[] = [
    { gate: 'attestation', passed: true },
    { gate: 'verify', passed: verification.outcome === 'verified' },
  ];
  try {
    const receipt = await new BundlePromoterAdapter({
      publicPath: join(input.artifactsDir, 'promoted', `${input.candidate.id}.bundle.json`),
      now,
    }).promote(stagedBundle, gates);
    return {
      outcome: verification.outcome,
      runs: verification.runs,
      receipt,
      stagedBundle,
      diagnostics,
    };
  } catch (error) {
    const promotionDiagnostics =
      error && typeof error === 'object' && 'diagnostics' in error
        ? (error.diagnostics as Diagnostic[])
        : [
            exitDiagnostic(
              ARXIC_EXIT_PROMOTION_SKIPPED,
              'blocked',
              input.candidate.id,
              error instanceof Error ? error.message : String(error),
            ),
          ];
    return {
      outcome: 'blocked',
      runs: verification.runs,
      stagedBundle,
      diagnostics: [
        ...diagnostics,
        ...promotionDiagnostics,
        exitDiagnostic(
          ARXIC_EXIT_PROMOTION_SKIPPED,
          'blocked',
          input.candidate.id,
          'Atomic promotion failed; the last-known-good bundle was preserved',
        ),
      ],
    };
  }
}

async function prepareGeneratedSuite(
  configPath: string,
  specPath: string,
  generatedConfig: string,
  generatedSpec: string,
  forbidNetworkErrors: boolean,
): Promise<{ config: string; spec: string }> {
  const config = await readFile(configPath, 'utf8');
  if (config !== generatedConfig) throw new Error('Generated config differs from returned bytes');
  const traceTarget = "trace: 'retain-on-failure'";
  if (!generatedConfig.includes(traceTarget))
    throw new Error('Generated config lacks the retained-trace seam');
  const preparedConfig = generatedConfig.replace(traceTarget, "trace: 'on'");
  await writeFile(configPath, preparedConfig);
  const spec = await readFile(specPath, 'utf8');
  if (spec !== generatedSpec) throw new Error('Generated spec differs from returned bytes');
  if (!forbidNetworkErrors) return { config: preparedConfig, spec: generatedSpec };
  const instrumentationTarget = '\n\ntest(';
  if (!generatedSpec.includes(instrumentationTarget))
    throw new Error('Generated spec lacks the network instrumentation seam');
  const instrumentation = [
    'const arxicNetworkErrors = new WeakMap<object, string[]>();',
    "test.beforeEach(async ({ page }) => { const errors: string[] = []; arxicNetworkErrors.set(page, errors); page.on('requestfailed', request => { const failure = request.failure()?.errorText; if (failure && !/ERR_ABORTED|NS_BINDING_ABORTED/u.test(failure)) errors.push(`${failure} ${request.url()}`); }); });",
    'test.afterEach(async ({ page }) => { expect(arxicNetworkErrors.get(page) ?? []).toEqual([]); });',
    '',
  ].join('\n');
  const preparedSpec = generatedSpec.replace(instrumentationTarget, `\n\n${instrumentation}test(`);
  await writeFile(specPath, preparedSpec);
  return { config: preparedConfig, spec: preparedSpec };
}

function indexSourceEvidence(
  workflow: Workflow,
  refs: Array<EvidenceIndex[string]>,
  evidenceIndex: EvidenceIndex,
): void {
  const remaining = [...refs];
  for (const evidenceId of workflowEvidenceIds(workflow).filter((id) => id.startsWith('src:'))) {
    const preferred = preferredSourceEvidence(evidenceId, remaining);
    if (!preferred) continue;
    evidenceIndex[evidenceId] = preferred;
    remaining.splice(remaining.indexOf(preferred), 1);
  }
  let generatedIndex = 1;
  for (const ref of remaining) {
    while (evidenceIndex[`src:login-${generatedIndex}`]) generatedIndex += 1;
    evidenceIndex[`src:login-${generatedIndex}`] = ref;
    generatedIndex += 1;
  }
}

function workflowEvidenceIds(workflow: Workflow): string[] {
  return [
    ...new Set([
      ...workflow.evidenceRefs,
      ...workflow.transitions.flatMap(({ evidenceRefs }) => evidenceRefs),
    ]),
  ];
}

function preferredSourceEvidence(
  evidenceId: string,
  refs: Array<EvidenceIndex[string]>,
): EvidenceIndex[string] | undefined {
  const category = evidenceId.match(/(?:route|handler|guard)$/u)?.[0];
  let marker: RegExp | undefined;
  if (category === 'route') marker = /(?:page-route|express-route)/u;
  if (category === 'handler') marker = /(?:server-action|inline-handler)/u;
  if (category === 'guard') marker = /auth-guard/u;
  return refs.find((ref) => ref.kind === 'source' && marker?.test(ref.ruleId ?? '')) ?? refs[0];
}

async function writeSupportingArtifacts(
  input: RunM0VerticalInput,
  runId: string,
  generatedAt: string,
) {
  const directory = join(input.artifactsDir, 'bundle-support', runId);
  await mkdir(directory, { recursive: true });
  const noticePath = join(directory, 'NOTICE');
  const provenancePath = join(directory, 'provenance.json');
  await writeFile(
    noticePath,
    'Arxic M0 pipeline bundle. See repository NOTICE for dependencies.\n',
  );
  await writeFile(
    provenancePath,
    `${JSON.stringify({ repository: pathToFileURL(resolve(input.target.appDir)).href, commit: input.target.commit, appBuildDigest: input.target.appBuildDigest, generatedAt })}\n`,
  );
  return Promise.all([
    artifactRef('notice', noticePath),
    artifactRef('provenance', provenancePath),
  ]);
}

function compileFailure(
  subject: string,
  diagnostics: Diagnostic[],
  detail = 'The staged Playwright suite could not be compiled',
): M0VerticalResult {
  return {
    outcome: 'blocked',
    runs: [],
    diagnostics: [
      ...diagnostics,
      exitDiagnostic(ARXIC_EXIT_COMPILE_FAILED, 'blocked', subject, detail),
      exitDiagnostic(
        ARXIC_EXIT_PROMOTION_SKIPPED,
        'blocked',
        subject,
        'Promotion was skipped because compilation did not pass',
      ),
    ],
  };
}

function skipped(
  outcome: TruthState,
  runs: Array<{ passed: boolean }>,
  diagnostics: Diagnostic[],
  subject: string,
): M0VerticalResult {
  return {
    outcome,
    runs,
    diagnostics: [
      ...diagnostics,
      exitDiagnostic(
        ARXIC_EXIT_PROMOTION_SKIPPED,
        outcome === 'contradicted' ? 'contradicted' : 'blocked',
        subject,
        'Promotion was skipped because deterministic verification did not produce verified',
      ),
    ],
  };
}
