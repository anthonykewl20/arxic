import { randomBytes } from 'node:crypto';
import { mkdir, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type {
  ArtifactRef,
  Diagnostic,
  StagedBundle,
  VerificationPolicy,
  VerificationResult,
  WorkflowVerifier,
} from '@arxic/contracts';
import {
  generateConfig,
  generateFixture,
  generateSpec,
  transitionReceiptId,
  transitionReceiptRuntimeSource,
} from '@arxic/playwright-compiler';
import {
  SCREENSHOT_CAPTURE_CORRELATION_ENV,
  SCREENSHOT_CAPTURED_AT_ENV,
  SCREENSHOT_PRIVACY_POLICY_ENV,
  SCREENSHOT_PRIVACY_POLICY_SHA256_ENV,
  establishTrustedScreenshotCaptureBinding,
  expectedScreenshotPathsFromTrustedSpec,
  screenshotPrivacyRuntimeSource,
  serializeScreenshotPrivacyPolicy,
  type ScreenshotPrivacyPolicy,
  type TrustedScreenshotCaptureBinding,
} from '@arxic/playwright-screenshot-privacy';
import {
  captureRunArtifacts,
  resolveArtifactPath,
  TraceSanitizationError,
  verifyArtifactHashes,
} from './artifacts';
import { classifyVerification } from './classify';
import {
  ARXIC_VERIFY_ARTIFACT_HASH_MISMATCH,
  ARXIC_VERIFY_ARTIFACT_MISSING,
  ARXIC_VERIFY_BLOCKED_FIXTURE,
  ARXIC_VERIFY_SUITE_UNAVAILABLE,
  ARXIC_VERIFY_SCREENSHOT_PRIVACY,
  ARXIC_VERIFY_TRACE_SANITIZATION_FAILED,
  verifyDiagnostic,
} from './diagnostics';
import { resetAndSeedFixtures, type VerificationPersona } from './reset';
import { runPlaywrightSuite, type RunPass, type TransitionReceiptExpectation } from './runner';

const require = createRequire(import.meta.url);

export type PlaywrightVerifierOptions = {
  outputDirectory: string;
  origin: string;
  artifactsDir: string;
  persona?: VerificationPersona;
  resetAndSeed?: (run: number) => Promise<void>;
  runSuite?: (run: number) => Promise<RunPass>;
  ensurePlaywrightModule?: boolean;
  now?: () => string;
  screenshotPrivacyPolicy?: ScreenshotPrivacyPolicy;
  captureCorrelation?: (run: number) => string;
};

export class PlaywrightVerifier implements WorkflowVerifier {
  readonly #outputDirectory: string;
  readonly #origin: string;
  readonly #artifactsDirectory: string;
  readonly #persona: VerificationPersona | undefined;
  readonly #resetAndSeed: ((run: number) => Promise<void>) | undefined;
  readonly #runSuite: ((run: number) => Promise<RunPass>) | undefined;
  readonly #ensureModule: boolean;
  readonly #now: () => string;
  readonly #screenshotPrivacyPolicy: ScreenshotPrivacyPolicy | undefined;
  readonly #captureCorrelation: (run: number) => string;

  constructor(options: PlaywrightVerifierOptions) {
    this.#outputDirectory = options.outputDirectory;
    this.#origin = new URL(options.origin).href;
    this.#artifactsDirectory = options.artifactsDir;
    this.#persona = options.persona;
    this.#resetAndSeed = options.resetAndSeed;
    this.#runSuite = options.runSuite;
    this.#ensureModule = options.ensurePlaywrightModule ?? true;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#screenshotPrivacyPolicy = options.screenshotPrivacyPolicy;
    this.#captureCorrelation =
      options.captureCorrelation ?? ((run) => `run-${run}-${randomBytes(24).toString('hex')}`);
  }

  async verify(bundle: StagedBundle, policy: VerificationPolicy): Promise<VerificationResult> {
    const runs: Array<{ passed: boolean }> = [];
    const artifacts: ArtifactRef[] = [];
    const subject = bundle.workflow.id;
    if (!Number.isInteger(policy.requiredRuns) || policy.requiredRuns < 1) {
      return blocked(
        runs,
        artifacts,
        verifyDiagnostic(
          ARXIC_VERIFY_SUITE_UNAVAILABLE,
          'blocked',
          subject,
          'Verification requires at least one clean-fixture run',
        ),
      );
    }
    const spec = bundle.artifacts.find(
      (artifact) =>
        artifact.kind === 'playwright-spec' || /(?:^|\/)workflow\.spec\.ts$/u.test(artifact.path),
    );
    if (!spec) {
      return blocked(
        runs,
        artifacts,
        verifyDiagnostic(
          ARXIC_VERIFY_SUITE_UNAVAILABLE,
          'blocked',
          subject,
          'The staged bundle has no Playwright workflow spec',
        ),
      );
    }
    try {
      resolveArtifactPath(this.#outputDirectory, spec.path);
    } catch (error) {
      return blocked(
        runs,
        artifacts,
        verifyDiagnostic(
          ARXIC_VERIFY_SUITE_UNAVAILABLE,
          'blocked',
          subject,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
    const stagedFailures = await verifyArtifactHashes(bundle.artifacts, this.#outputDirectory);
    if (stagedFailures.length > 0) {
      const specMissing = stagedFailures.some(
        ({ artifact, reason }) => artifact.path === spec.path && reason === 'missing',
      );
      const mismatch = stagedFailures.some(({ reason }) => reason === 'mismatch');
      const code = specMissing
        ? ARXIC_VERIFY_SUITE_UNAVAILABLE
        : mismatch
          ? ARXIC_VERIFY_ARTIFACT_HASH_MISMATCH
          : ARXIC_VERIFY_ARTIFACT_MISSING;
      return blocked(
        runs,
        artifacts,
        verifyDiagnostic(
          code,
          'blocked',
          subject,
          `Staged artifact validation failed: ${stagedFailures.map(({ artifact, reason }) => `${artifact.path} (${reason})`).join(', ')}`,
        ),
      );
    }
    if (this.#ensureModule) {
      try {
        await ensurePlaywrightModule(this.#outputDirectory);
      } catch (error) {
        return blocked(
          runs,
          artifacts,
          verifyDiagnostic(
            ARXIC_VERIFY_SUITE_UNAVAILABLE,
            'blocked',
            subject,
            `Playwright module is unavailable: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }
    let screenshotBinding: TrustedScreenshotCaptureBinding;
    let screenshotPolicy: ReturnType<typeof serializeScreenshotPrivacyPolicy>;
    try {
      if (!this.#screenshotPrivacyPolicy) {
        throw new Error('An explicit action-owned screenshot privacy policy is required');
      }
      screenshotPolicy = serializeScreenshotPrivacyPolicy(this.#screenshotPrivacyPolicy);
      const runtime = Object.values(bundle.evidenceIndex).find((item) => item.kind === 'runtime');
      if (!runtime) throw new Error('Runtime evidence is required to bind the generated spec');
      const expectedSpec = generateSpec(bundle.workflow, this.#origin, runtime.url).spec;
      const expectedFixture = generateFixture(bundle.workflow);
      const expectedTransitionReceiptRuntime = transitionReceiptRuntimeSource();
      const expectedConfig = generateConfig(bundle.workflow);
      const expectedRuntime = screenshotPrivacyRuntimeSource();
      screenshotBinding = await establishTrustedScreenshotCaptureBinding({
        testDirectory: this.#outputDirectory,
        specPath: spec.path,
        runtimePath: 'fixtures/screenshot-privacy.ts',
        expectedSpec,
        allowedSourcePaths: [
          'tests/workflow.spec.ts',
          'fixtures/workflow.fixture.ts',
          'fixtures/transition-receipts.ts',
          'fixtures/screenshot-privacy.ts',
          'playwright.config.ts',
        ],
        trustedSourceContents: {
          'tests/workflow.spec.ts': expectedSpec,
          'fixtures/workflow.fixture.ts': expectedFixture,
          'fixtures/transition-receipts.ts': expectedTransitionReceiptRuntime,
          'fixtures/screenshot-privacy.ts': expectedRuntime,
          'playwright.config.ts': expectedConfig,
        },
        expectedScreenshots: expectedScreenshotPathsFromTrustedSpec(expectedSpec),
      });
    } catch (error) {
      return blocked(
        runs,
        artifacts,
        verifyDiagnostic(
          ARXIC_VERIFY_SCREENSHOT_PRIVACY,
          'blocked',
          subject,
          `Screenshot privacy binding failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
    const requiredWorkflowTransitions = bundle.workflow.transitions.filter(
      (transition) => transition.required !== false,
    );
    const requiredTransitionReceipts = requiredWorkflowTransitions.map((transition, index) => ({
      id: transitionReceiptId(requiredWorkflowTransitions, index),
      stepName: `${transition.from} → ${transition.to}`,
    }));
    const requiredTransitions = requiredTransitionReceipts.map(({ id }) => id);
    const artifactFailures: Array<{ reason: 'missing' | 'mismatch'; detail: string }> = [];
    const networkErrors: string[] = [];
    const receiptFailures: string[] = [];
    const missingTransitions: string[] = [];
    const executionDiagnostics: Diagnostic[] = [];
    for (let run = 1; run <= policy.requiredRuns; run += 1) {
      const captureCorrelation = this.#captureCorrelation(run);
      const capturedAt = this.#now();
      try {
        await Promise.all([
          rm(join(this.#outputDirectory, 'artifacts'), { recursive: true, force: true }),
          rm(join(this.#outputDirectory, 'test-results'), { recursive: true, force: true }),
        ]);
      } catch (error) {
        executionDiagnostics.push(
          verifyDiagnostic(
            ARXIC_VERIFY_SUITE_UNAVAILABLE,
            'blocked',
            subject,
            `Prior run artifacts could not be cleaned before run ${run}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        break;
      }
      try {
        await this.#reset(run);
      } catch (error) {
        executionDiagnostics.push(
          verifyDiagnostic(
            ARXIC_VERIFY_BLOCKED_FIXTURE,
            'blocked',
            subject,
            `Clean fixture reset/seed failed before run ${run}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        break;
      }
      let result: RunPass;
      try {
        result = await this.#execute(
          run,
          policy,
          {
            policy: screenshotPolicy,
            correlation: captureCorrelation,
            capturedAt,
          },
          requiredTransitionReceipts.length > 0
            ? {
                path: join(this.#outputDirectory, 'artifacts', 'arxic-transition-receipts.json'),
                nonce: randomBytes(32).toString('hex'),
                testTitle: bundle.workflow.id,
                transitions: requiredTransitionReceipts,
              }
            : undefined,
        );
      } catch (error) {
        executionDiagnostics.push(
          verifyDiagnostic(
            ARXIC_VERIFY_SUITE_UNAVAILABLE,
            'blocked',
            subject,
            `Playwright run ${run} could not execute: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        break;
      }
      runs.push({ passed: result.passed });
      networkErrors.push(...result.networkErrors.map((item) => `run ${run}: ${item}`));
      if (result.passed && result.receiptError) {
        receiptFailures.push(`run ${run}: ${result.receiptError}`);
      } else if (
        result.passed &&
        result.observedTransitions === undefined &&
        requiredTransitions.length > 0
      ) {
        receiptFailures.push(
          `run ${run}: no transition receipt was returned by the Playwright runner`,
        );
      }
      if (result.passed && result.observedTransitions) {
        missingTransitions.push(
          ...requiredTransitions
            .filter((transition) => !result.observedTransitions?.includes(transition))
            .map((transition) => `run ${run}: ${transition}`),
        );
      }
      let captured: ArtifactRef[];
      try {
        captured = await captureRunArtifacts(this.#outputDirectory, this.#artifactsDirectory, run, {
          forbiddenSubstrings: Object.values(this.#persona ?? {}).filter(
            (value): value is string => typeof value === 'string' && value.length > 0,
          ),
          screenshotCheckpoints: result.passed ? policy.screenshotCheckpoints : [],
          screenshotPrivacy: {
            binding: screenshotBinding,
            policy: screenshotPolicy.policy,
            correlation: captureCorrelation,
            attester: '@arxic/verifier',
            attestedAt: this.#now(),
          },
        });
      } catch (error) {
        if (error instanceof TraceSanitizationError) {
          executionDiagnostics.push(
            verifyDiagnostic(
              ARXIC_VERIFY_TRACE_SANITIZATION_FAILED,
              'blocked',
              subject,
              `Trace sanitization blocked verification run ${run} (${error.failure.code})`,
            ),
          );
          break;
        }
        artifactFailures.push({
          reason: 'missing',
          detail: `run ${run} artifacts could not be retained: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }
      artifacts.push(...captured);
      const hashFailures = await verifyArtifactHashes(captured);
      artifactFailures.push(
        ...hashFailures.map(({ artifact, reason }) => ({
          reason,
          detail: `run ${run} ${artifact.path} (${reason})`,
        })),
      );
      if (policy.trace === 'retain' && !captured.some(({ kind }) => kind === 'trace')) {
        artifactFailures.push({ reason: 'missing', detail: `run ${run} lacks a trace` });
      }
    }
    const classification = classifyVerification({
      subject,
      runs,
      policy,
      executionDiagnostics,
      artifactFailures,
      networkErrors,
      receiptFailures,
      missingTransitions,
    });
    return { ...classification, runs, artifacts };
  }

  async #reset(run: number): Promise<void> {
    if (this.#resetAndSeed) return this.#resetAndSeed(run);
    if (!this.#persona) throw new Error('No verification persona was configured');
    return resetAndSeedFixtures(this.#origin, this.#persona);
  }

  async #execute(
    run: number,
    policy: VerificationPolicy,
    screenshot: {
      policy: ReturnType<typeof serializeScreenshotPrivacyPolicy>;
      correlation: string;
      capturedAt: string;
    },
    transitionReceipts: TransitionReceiptExpectation | undefined,
  ): Promise<RunPass> {
    const env = {
      ...personaEnvironment(this.#persona),
      [SCREENSHOT_PRIVACY_POLICY_ENV]: screenshot.policy.json,
      [SCREENSHOT_PRIVACY_POLICY_SHA256_ENV]: screenshot.policy.sha256,
      [SCREENSHOT_CAPTURE_CORRELATION_ENV]: screenshot.correlation,
      [SCREENSHOT_CAPTURED_AT_ENV]: screenshot.capturedAt,
    };
    if (!this.#runSuite) {
      return runPlaywrightSuite({
        testDirectory: this.#outputDirectory,
        env,
        trace: policy.trace,
        ...(transitionReceipts ? { transitionReceipts } : {}),
      });
    }
    const previous = new Map(Object.keys(env).map((name) => [name, process.env[name]] as const));
    Object.assign(process.env, env);
    try {
      return await this.#runSuite(run);
    } finally {
      for (const [name, value] of previous) restoreEnvironment(name, value);
    }
  }
}

export async function ensurePlaywrightModule(testDirectory: string): Promise<void> {
  const packageRoot = dirname(require.resolve('@playwright/test/package.json'));
  const scope = join(testDirectory, 'node_modules', '@playwright');
  const destination = join(scope, 'test');
  await mkdir(scope, { recursive: true });
  try {
    await symlink(packageRoot, destination, 'dir');
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') {
      throw error;
    }
  }
}

function blocked(
  runs: Array<{ passed: boolean }>,
  artifacts: ArtifactRef[],
  diagnostic: Diagnostic,
): VerificationResult {
  return { outcome: 'blocked', runs, artifacts, diagnostics: [diagnostic] };
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function personaEnvironment(persona: VerificationPersona | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(persona ?? {})) {
    if (value !== undefined) {
      env[`ARXIC_INPUT_PERSONA_${key.replace(/[^A-Za-z0-9]+/gu, '_').toUpperCase()}`] = value;
    }
  }
  return env;
}
