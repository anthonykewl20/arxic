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
import { captureRunArtifacts, resolveArtifactPath, verifyArtifactHashes } from './artifacts';
import { classifyVerification } from './classify';
import {
  ARXIC_VERIFY_ARTIFACT_HASH_MISMATCH,
  ARXIC_VERIFY_ARTIFACT_MISSING,
  ARXIC_VERIFY_BLOCKED_FIXTURE,
  ARXIC_VERIFY_SUITE_UNAVAILABLE,
  verifyDiagnostic,
} from './diagnostics';
import { resetAndSeedFixtures } from './reset';
import { runPlaywrightSuite, type RunPass } from './runner';

const require = createRequire(import.meta.url);

export type PlaywrightVerifierOptions = {
  outputDirectory: string;
  origin: string;
  artifactsDir: string;
  persona?: { email: string; password: string };
  resetAndSeed?: (run: number) => Promise<void>;
  runSuite?: (run: number) => Promise<RunPass>;
  ensurePlaywrightModule?: boolean;
  now?: () => string;
};

export class PlaywrightVerifier implements WorkflowVerifier {
  readonly #outputDirectory: string;
  readonly #origin: string;
  readonly #artifactsDirectory: string;
  readonly #persona: { email: string; password: string } | undefined;
  readonly #resetAndSeed: ((run: number) => Promise<void>) | undefined;
  readonly #runSuite: ((run: number) => Promise<RunPass>) | undefined;
  readonly #ensureModule: boolean;

  constructor(options: PlaywrightVerifierOptions) {
    this.#outputDirectory = options.outputDirectory;
    this.#origin = new URL(options.origin).href;
    this.#artifactsDirectory = options.artifactsDir;
    this.#persona = options.persona;
    this.#resetAndSeed = options.resetAndSeed;
    this.#runSuite = options.runSuite;
    this.#ensureModule = options.ensurePlaywrightModule ?? true;
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
    const requiredTransitions = bundle.workflow.transitions
      .filter((transition) => transition.required !== false)
      .map((transition) => `${transition.from}->${transition.to}`);
    const observed = new Set<string>();
    const artifactFailures: Array<{ reason: 'missing' | 'mismatch'; detail: string }> = [];
    const networkErrors: string[] = [];
    const executionDiagnostics: Diagnostic[] = [];
    for (let run = 1; run <= policy.requiredRuns; run += 1) {
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
        result = await this.#execute(run, policy);
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
      for (const transition of result.observedTransitions ?? requiredTransitions) {
        observed.add(transition);
      }
      let captured: ArtifactRef[];
      try {
        captured = await captureRunArtifacts(this.#outputDirectory, this.#artifactsDirectory, run);
      } catch (error) {
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
      const missingScreenshots = result.passed
        ? (policy.screenshotCheckpoints ?? []).filter(
            (checkpoint) =>
              !captured.some(
                (artifact) =>
                  artifact.kind === 'screenshot' && artifact.path.endsWith(`-${checkpoint}.png`),
              ),
          )
        : [];
      if (missingScreenshots.length > 0) {
        artifactFailures.push({
          reason: 'missing',
          detail: `run ${run} lacks screenshots ${missingScreenshots.join(', ')}`,
        });
      }
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
      missingTransitions: requiredTransitions.filter((transition) => !observed.has(transition)),
    });
    return { ...classification, runs, artifacts };
  }

  async #reset(run: number): Promise<void> {
    if (this.#resetAndSeed) return this.#resetAndSeed(run);
    if (!this.#persona) throw new Error('No verification persona was configured');
    return resetAndSeedFixtures(this.#origin, this.#persona);
  }

  async #execute(run: number, policy: VerificationPolicy): Promise<RunPass> {
    const env = this.#persona
      ? {
          ARXIC_INPUT_PERSONA_EMAIL: this.#persona.email,
          ARXIC_INPUT_PERSONA_PASSWORD: this.#persona.password,
        }
      : {};
    if (!this.#runSuite) {
      return runPlaywrightSuite({
        testDirectory: this.#outputDirectory,
        env,
        trace: policy.trace,
      });
    }
    const previousEmail = process.env.ARXIC_INPUT_PERSONA_EMAIL;
    const previousPassword = process.env.ARXIC_INPUT_PERSONA_PASSWORD;
    if (this.#persona) {
      process.env.ARXIC_INPUT_PERSONA_EMAIL = this.#persona.email;
      process.env.ARXIC_INPUT_PERSONA_PASSWORD = this.#persona.password;
    }
    try {
      return await this.#runSuite(run);
    } finally {
      restoreEnvironment('ARXIC_INPUT_PERSONA_EMAIL', previousEmail);
      restoreEnvironment('ARXIC_INPUT_PERSONA_PASSWORD', previousPassword);
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
