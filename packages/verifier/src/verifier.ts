import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, rm, symlink } from 'node:fs/promises';
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
  REPLAY_PERSONA_STORAGE_STATE_ENV,
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
import {
  replayPersonaStorageState,
  ReplayPersonaLoginError,
  replayPersonaNotDeclaredRefusal,
  type ReplayPersonaDeclaration,
  type ReplayPersonaStorageState,
} from './replay-persona';
import { runPlaywrightSuite, type RunPass, type TransitionReceiptExpectation } from './runner';
import { extractRunFailureEvidence } from './failure-evidence';

const require = createRequire(import.meta.url);

export type PlaywrightVerifierOptions = {
  outputDirectory: string;
  origin: string;
  artifactsDir: string;
  /** Additive network origins permitted alongside the declared target origin. */
  allowedOrigins?: readonly string[];
  persona?: VerificationPersona;
  resetAndSeed?: (run: number) => Promise<void>;
  /**
   * #288: declared `fixtures.replayPersona` (mode `per-pass-login`). When
   * present — with a persona — the verifier provisions + logs in the persona
   * through the target's own login form before EVERY pass, in a fresh
   * context, instead of calling the target's arxic fixture endpoints
   * (first-party apps keep that protocol unchanged, C-4).
   */
  replayPersona?: ReplayPersonaDeclaration;
  /**
   * #308: the injected runner receives the ISOLATED suite directory (the
   * staging copy the verifier owns) — capture outputs must land there, not
   * in the caller's output directory.
   */
  runSuite?: (
    run: number,
    transitionReceipts: TransitionReceiptExpectation,
    suiteDirectory: string,
  ) => Promise<RunPass>;
  ensurePlaywrightModule?: boolean;
  now?: () => string;
  screenshotPrivacyPolicy?: ScreenshotPrivacyPolicy;
  captureCorrelation?: (run: number) => string;
};

export class PlaywrightVerifier implements WorkflowVerifier {
  readonly #outputDirectory: string;
  readonly #origin: string;
  readonly #artifactsDirectory: string;
  readonly #allowedOrigins: readonly string[] | undefined;
  readonly #persona: VerificationPersona | undefined;
  readonly #resetAndSeed: ((run: number) => Promise<void>) | undefined;
  readonly #replayPersona: ReplayPersonaDeclaration | undefined;
  readonly #runSuite:
    | ((
        run: number,
        transitionReceipts: TransitionReceiptExpectation,
        suiteDirectory: string,
      ) => Promise<RunPass>)
    | undefined;
  readonly #ensureModule: boolean;
  readonly #now: () => string;
  readonly #screenshotPrivacyPolicy: ScreenshotPrivacyPolicy | undefined;
  readonly #captureCorrelation: (run: number) => string;
  /** Set at verify() entry: the workflow id every #reset diagnostic names. */
  #subject: string | undefined;
  /** #308: set at verify() entry — the isolated suite staging directory. */
  #suiteDirectory: string | undefined;

  constructor(options: PlaywrightVerifierOptions) {
    this.#outputDirectory = options.outputDirectory;
    this.#origin = new URL(options.origin).href;
    this.#artifactsDirectory = options.artifactsDir;
    this.#allowedOrigins = options.allowedOrigins;
    this.#persona = options.persona;
    this.#resetAndSeed = options.resetAndSeed;
    this.#replayPersona = options.replayPersona;
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
    this.#subject = subject;
    // #308 (F-E7): the suite MUST NOT run in the caller's output directory.
    // The screenshot-privacy retention treats its source roots as an
    // EXCLUSIVE capture workspace (inventories and purges everything under
    // 'artifacts'/'test-results' relative to the suite directory) — when the
    // CLI wired the suite to the run root, that purged the orchestrator's
    // committed stage artifacts (directus-dg12-run5: artifacts/{00..09,13}
    // destroyed during stage-10; stage-11 failed INVENTORY-MISSING
    // downstream). The suite now runs in a verifier-owned staging copy; the
    // caller's directory is never written or purged.
    let suiteDirectory: string;
    try {
      suiteDirectory = await stageIsolatedSuite(this.#outputDirectory, bundle);
      this.#suiteDirectory = suiteDirectory;
    } catch (error) {
      return blocked(
        runs,
        artifacts,
        verifyDiagnostic(
          ARXIC_VERIFY_SUITE_UNAVAILABLE,
          'blocked',
          subject,
          `The verification suite could not be staged in isolation: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    }
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
      resolveArtifactPath(suiteDirectory, spec.path);
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
    const stagedFailures = await verifyArtifactHashes(bundle.artifacts, suiteDirectory);
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
        await ensurePlaywrightModule(suiteDirectory);
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
      const expectedSpec = generateSpec(bundle.workflow, this.#origin, runtime.url, {
        ...(this.#allowedOrigins ? { allowedOrigins: this.#allowedOrigins } : {}),
      }).spec;
      const expectedFixture = generateFixture(
        bundle.workflow,
        this.#allowedOrigins ? [...this.#allowedOrigins] : undefined,
      );
      const expectedTransitionReceiptRuntime = transitionReceiptRuntimeSource();
      const expectedConfig = generateConfig(bundle.workflow);
      const expectedRuntime = screenshotPrivacyRuntimeSource();
      screenshotBinding = await establishTrustedScreenshotCaptureBinding({
        testDirectory: suiteDirectory,
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
    const receiptRedactionFailures: string[] = [];
    const missingTransitions: string[] = [];
    const runFailures: string[] = [];
    const failureEvidenceRedactionFailures: string[] = [];
    const executionDiagnostics: Diagnostic[] = [];
    for (let run = 1; run <= policy.requiredRuns; run += 1) {
      const captureCorrelation = this.#captureCorrelation(run);
      const capturedAt = this.#now();
      try {
        await Promise.all([
          // Clean ONLY this verifier's own receipt file (the sole thing it
          // writes under outputDirectory/artifacts). The pre-DG-08 wholesale
          // `rm(outputDirectory/artifacts)` destroyed the pipeline's stage
          // artifacts whenever the caller's output directory was also the
          // run directory (the CLI layout) — a pre-existing data-loss that
          // purged failure evidence before stage 10 could report it.
          rm(join(suiteDirectory, 'artifacts', 'arxic-transition-receipts.json'), {
            force: true,
          }),
          rm(join(suiteDirectory, 'test-results'), { recursive: true, force: true }),
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
      let replayPersonaState: ReplayPersonaStorageState | undefined;
      try {
        replayPersonaState = await this.#reset(run);
      } catch (error) {
        executionDiagnostics.push(
          error instanceof ReplayPersonaLoginError
            ? // #288: the per-pass login failure carries its own frozen
              // ARXIC-VERIFY-FIXTURE-* diagnostic (LOGIN-BLOCKED / refusal).
              error.diagnostic
            : verifyDiagnostic(
                ARXIC_VERIFY_BLOCKED_FIXTURE,
                'blocked',
                subject,
                `Clean fixture reset/seed failed before run ${run}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
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
          {
            path: join(suiteDirectory, 'artifacts', 'arxic-transition-receipts.json'),
            nonce: randomBytes(32).toString('hex'),
            testTitle: bundle.workflow.id,
            transitions: requiredTransitionReceipts,
            forbiddenSubstrings: personaForbiddenSubstrings(this.#persona),
          },
          replayPersonaState,
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
      // #258: failed runs retain a bounded, redacted failure summary so the
      // classification surfaces WHY the replay failed instead of purging it.
      // Redaction is fail-closed: confident secret patterns are scrubbed, and
      // content that cannot be confidently classified is scrubbed AND flagged
      // so the result carries an ARXIC-VERIFY-REDACTION-FAILED signal.
      if (!result.passed) {
        const evidence = extractRunFailureEvidence(
          result.output,
          personaForbiddenSubstrings(this.#persona),
        );
        runFailures.push(`run ${run}: ${evidence.evidence}`);
        if (evidence.redactionIncomplete) {
          failureEvidenceRedactionFailures.push(
            `run ${run}: retained failure evidence is pattern-scrubbed only`,
          );
        }
      }
      networkErrors.push(...result.networkErrors.map((item) => `run ${run}: ${item}`));
      if (result.passed && result.receiptRedactionFailure) {
        receiptRedactionFailures.push(`run ${run}: ${result.receiptRedactionFailure}`);
      } else if (result.passed && result.receiptError) {
        receiptFailures.push(`run ${run}: ${result.receiptError}`);
      } else if (result.passed && result.observedTransitions === undefined) {
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
      if (result.passed && (result.receiptError || result.receiptRedactionFailure)) continue;
      let captured: ArtifactRef[];
      try {
        captured = await captureRunArtifacts(suiteDirectory, this.#artifactsDirectory, run, {
          forbiddenSubstrings: personaForbiddenSubstrings(this.#persona),
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
      runFailures,
      failureEvidenceRedactionFailures,
      networkErrors,
      receiptFailures,
      receiptRedactionFailures,
      missingTransitions,
    });
    return { ...classification, runs, artifacts };
  }

  async #reset(run: number): Promise<ReplayPersonaStorageState | undefined> {
    if (this.#resetAndSeed) {
      await this.#resetAndSeed(run);
      return undefined;
    }
    // #288 (C-1): a declared replay persona provisions through the target's
    // OWN login form per pass (the leased mutation); the endpoint protocol is
    // never attempted against an endpoint-less third-party target.
    if (this.#replayPersona && this.#persona) {
      return replayPersonaStorageState({
        origin: this.#origin,
        declaration: this.#replayPersona,
        persona: this.#persona,
        subject: this.#subject ?? 'verification.replay-persona',
      });
    }
    if (this.#replayPersona && !this.#persona) {
      throw new ReplayPersonaLoginError(
        'No verification persona was configured for the declared fixtures.replayPersona',
        replayPersonaNotDeclaredRefusal(this.#subject ?? 'verification.replay-persona'),
      );
    }
    if (!this.#persona) throw new Error('No verification persona was configured');
    await resetAndSeedFixtures(this.#origin, this.#persona);
    return undefined;
  }

  async #execute(
    run: number,
    policy: VerificationPolicy,
    screenshot: {
      policy: ReturnType<typeof serializeScreenshotPrivacyPolicy>;
      correlation: string;
      capturedAt: string;
    },
    transitionReceipts: TransitionReceiptExpectation,
    replayPersonaState: ReplayPersonaStorageState | undefined,
  ): Promise<RunPass> {
    const env = {
      ...personaEnvironment(this.#persona),
      [SCREENSHOT_PRIVACY_POLICY_ENV]: screenshot.policy.json,
      [SCREENSHOT_PRIVACY_POLICY_SHA256_ENV]: screenshot.policy.sha256,
      [SCREENSHOT_CAPTURE_CORRELATION_ENV]: screenshot.correlation,
      [SCREENSHOT_CAPTURED_AT_ENV]: screenshot.capturedAt,
      ...(replayPersonaState
        ? { [REPLAY_PERSONA_STORAGE_STATE_ENV]: JSON.stringify(replayPersonaState) }
        : {}),
    };
    if (!this.#runSuite) {
      return runPlaywrightSuite({
        testDirectory: this.#suiteDirectory!,
        env,
        trace: policy.trace,
        transitionReceipts,
      });
    }
    const previous = new Map(Object.keys(env).map((name) => [name, process.env[name]] as const));
    Object.assign(process.env, env);
    try {
      return await this.#runSuite(run, transitionReceipts, this.#suiteDirectory!);
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

function personaForbiddenSubstrings(persona: VerificationPersona | undefined): string[] {
  return Object.values(persona ?? {}).filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

/**
 * #308 (F-E7): stage the bundle's suite files into a verifier-owned
 * directory (a hidden sibling of the caller's output directory) and return
 * it. The verification run (and the screenshot-privacy retention's EXCLUSIVE
 * workspace purge) executes against this copy; the caller's directory —
 * which the CLI wires to the orchestrator's run root — is never written or
 * purged. Only the staged suite's own artifact paths are copied; runtime
 * dependencies (node_modules) are re-provisioned in the copy by
 * ensurePlaywrightModule.
 */
async function stageIsolatedSuite(outputDirectory: string, bundle: StagedBundle): Promise<string> {
  const suiteDirectory = join(outputDirectory, '.arxic-verification-suite');
  await rm(suiteDirectory, { recursive: true, force: true });
  const written = new Set<string>();
  for (const artifact of bundle.artifacts) {
    const relative = artifact.path
      .replace(/^\/+/u, '')
      .split('/')
      .filter((segment) => segment !== '.' && segment !== '..')
      .join('/');
    if (relative === '' || written.has(relative)) continue;
    // Only suite SOURCE files are staged (spec/fixtures/config/plan). Other
    // artifact kinds (screenshots, traces, reports) are capture outputs that
    // belong to the retention flow, not the suite.
    const source = resolveArtifactPath(outputDirectory, artifact.path);
    const destination = join(suiteDirectory, relative);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    written.add(relative);
  }
  return suiteDirectory;
}
