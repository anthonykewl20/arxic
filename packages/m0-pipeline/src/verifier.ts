import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ArtifactRef,
  Diagnostic,
  TruthState,
  VerificationPolicy,
  Workflow,
} from '@arxic/contracts';
import {
  ARXIC_VERIFY_SUITE_UNAVAILABLE,
  artifactRef,
  captureRunArtifacts,
  classifyVerification,
  verifyDiagnostic,
  type ClassificationInput,
} from '@arxic/verifier';
import { installedChromiumVersion, runFallback } from '@arxic/playwright-agent-adapter';
import {
  SCREENSHOT_CAPTURE_CORRELATION_ENV,
  SCREENSHOT_CAPTURED_AT_ENV,
  SCREENSHOT_PRIVACY_POLICY_ENV,
  SCREENSHOT_PRIVACY_POLICY_SHA256_ENV,
  establishTrustedScreenshotCaptureBinding,
  expectedScreenshotPathsFromTrustedSpec,
  serializeScreenshotPrivacyPolicy,
  type ScreenshotPrivacyPolicy,
  type TrustedScreenshotCaptureBinding,
} from '@arxic/playwright-screenshot-privacy';
import { ARXIC_EXIT_EVIDENCE_GATE_BLOCKED, exitDiagnostic } from './diagnostics';

export type StagedSuitePass = {
  passed: boolean;
  browserVersion?: string;
  artifacts?: ArtifactRef[];
  diagnostics?: Diagnostic[];
  networkErrors?: string[];
  observedTransitions?: string[];
  artifactFailures?: string[];
};

type ScreenshotPrivacyAction = {
  policy: ScreenshotPrivacyPolicy;
  expectedSpec: string;
  specPath: string;
  runtimePath: string;
  allowedSourcePaths: readonly string[];
  trustedSourceContents: Readonly<Record<string, string>>;
  correlation: (run: number) => string;
  now: () => string;
};

export type VerifyStagedSuiteInput = {
  workflow: Workflow;
  origin: string;
  testDir: string;
  persona: { email: string; password: string };
  policy: VerificationPolicy;
  artifactsDir: string;
  resetAndSeed?: (run: number) => Promise<void>;
  executeRun?: (run: number) => Promise<StagedSuitePass>;
  screenshotPrivacy?: ScreenshotPrivacyAction;
};

export type VerifyStagedSuiteResult = {
  outcome: TruthState;
  runs: Array<{ passed: boolean }>;
  artifacts: ArtifactRef[];
  diagnostics: Diagnostic[];
  browserVersion?: string;
};

export async function verifyStagedSuite(
  input: VerifyStagedSuiteInput,
): Promise<VerifyStagedSuiteResult> {
  if (!Number.isInteger(input.policy.requiredRuns) || input.policy.requiredRuns < 1) {
    return classifiedResult(input, [], [], {});
  }
  const requiredTransitions = input.workflow.transitions
    .filter((transition) => transition.required !== false)
    .map((transition) => `${transition.from}->${transition.to}`);
  const artifacts: ArtifactRef[] = [];
  const executionDiagnostics: Diagnostic[] = [];
  const networkErrors: string[] = [];
  const runs: Array<{ passed: boolean }> = [];
  const observed = new Set<string>();
  const artifactFailures: string[] = [];
  const browserVersions = new Set<string>();
  const specPath = join(input.testDir, 'workflow.spec.ts');
  try {
    artifacts.push(await artifactRef('spec', specPath));
  } catch (error) {
    return classifiedResult(input, runs, artifacts, {
      executionDiagnostics: [
        unavailableDiagnostic(
          input.workflow.id,
          `The staged suite is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
    });
  }
  let screenshot:
    | {
        binding: TrustedScreenshotCaptureBinding;
        policy: ReturnType<typeof serializeScreenshotPrivacyPolicy>;
        action: ScreenshotPrivacyAction;
      }
    | undefined;
  if (!input.executeRun || input.screenshotPrivacy) {
    try {
      if (!input.screenshotPrivacy) {
        throw new Error('An explicit action-owned screenshot privacy policy is required');
      }
      const action = input.screenshotPrivacy;
      const privacyPolicy = serializeScreenshotPrivacyPolicy(action.policy);
      const binding = await establishTrustedScreenshotCaptureBinding({
        testDirectory: input.testDir,
        specPath: action.specPath,
        runtimePath: action.runtimePath,
        expectedSpec: action.expectedSpec,
        allowedSourcePaths: action.allowedSourcePaths,
        trustedSourceContents: action.trustedSourceContents,
        expectedScreenshots: expectedScreenshotPathsFromTrustedSpec(action.expectedSpec),
      });
      screenshot = { binding, policy: privacyPolicy, action };
    } catch (error) {
      return classifiedResult(input, runs, artifacts, {
        executionDiagnostics: [
          unavailableDiagnostic(
            input.workflow.id,
            `Screenshot privacy binding failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ],
      });
    }
  }
  for (let run = 1; run <= input.policy.requiredRuns; run += 1) {
    let pass: StagedSuitePass;
    try {
      await Promise.all([
        rm(join(input.testDir, 'artifacts'), { recursive: true, force: true }),
        rm(join(input.testDir, 'test-results'), { recursive: true, force: true }),
      ]);
      await (input.resetAndSeed ?? (() => resetAndSeed(input.origin, input.persona)))(run);
      pass = input.executeRun
        ? await input.executeRun(run)
        : await executeFallbackRun(input, run, requiredTransitions, screenshot!);
    } catch (error) {
      return classifiedResult(input, runs, artifacts, {
        executionDiagnostics: [
          unavailableDiagnostic(
            input.workflow.id,
            `Clean-fixture pass ${run} could not execute: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ],
      });
    }
    runs.push({ passed: pass.passed });
    artifacts.push(...(pass.artifacts ?? []));
    executionDiagnostics.push(...(pass.diagnostics ?? []));
    networkErrors.push(...(pass.networkErrors ?? []));
    artifactFailures.push(...(pass.artifactFailures ?? []).map((item) => `pass ${run} ${item}`));
    if (pass.browserVersion) browserVersions.add(pass.browserVersion);
    for (const transition of pass.observedTransitions ?? []) observed.add(transition);
    const runArtifacts = pass.artifacts ?? [];
    const missingScreenshots = (input.policy.screenshotCheckpoints ?? []).filter(
      (checkpoint) =>
        !runArtifacts.some(
          (artifact) =>
            artifact.kind === 'screenshot' && artifact.path.endsWith(`-${checkpoint}.png`),
        ),
    );
    const missingTrace =
      input.policy.trace === 'retain' &&
      !runArtifacts.some((artifact) => artifact.kind === 'trace');
    if (missingScreenshots.length > 0 || missingTrace) {
      artifactFailures.push(
        `pass ${run} lacks ${[
          ...(missingScreenshots.length > 0
            ? [`screenshots ${missingScreenshots.join(', ')}`]
            : []),
          ...(missingTrace ? ['trace'] : []),
        ].join(' and ')}`,
      );
    }
  }
  const missing = requiredTransitions.filter((transition) => !observed.has(transition));
  const classified = classifiedResult(input, runs, artifacts, {
    ...(executionDiagnostics.length > 0 ? { executionDiagnostics } : {}),
    ...(networkErrors.length > 0 ? { networkErrors } : {}),
    ...(artifactFailures.length > 0
      ? {
          artifactFailures: artifactFailures.map((detail) => ({
            reason: 'missing' as const,
            detail,
          })),
        }
      : {}),
    ...(missing.length > 0 ? { missingTransitions: missing } : {}),
  });
  if (classified.outcome !== 'verified') return classified;
  if (browserVersions.size !== 1) {
    return {
      ...classified,
      outcome: 'blocked',
      diagnostics: [
        ...classified.diagnostics,
        exitDiagnostic(
          ARXIC_EXIT_EVIDENCE_GATE_BLOCKED,
          'blocked',
          input.workflow.id,
          'Clean-fixture passes did not record exactly one consistent browser version',
        ),
      ],
    };
  }
  return { ...classified, browserVersion: [...browserVersions][0] };
}

async function executeFallbackRun(
  input: VerifyStagedSuiteInput,
  run: number,
  requiredTransitions: string[],
  screenshot: {
    binding: TrustedScreenshotCaptureBinding;
    policy: ReturnType<typeof serializeScreenshotPrivacyPolicy>;
    action: ScreenshotPrivacyAction;
  },
): Promise<StagedSuitePass> {
  const browserVersion = await installedChromiumVersion();
  const correlation = screenshot.action.correlation(run);
  const capturedAt = screenshot.action.now();
  const env = {
    ARXIC_INPUT_PERSONA_EMAIL: input.persona.email,
    ARXIC_INPUT_PERSONA_PASSWORD: input.persona.password,
    [SCREENSHOT_PRIVACY_POLICY_ENV]: screenshot.policy.json,
    [SCREENSHOT_PRIVACY_POLICY_SHA256_ENV]: screenshot.policy.sha256,
    [SCREENSHOT_CAPTURE_CORRELATION_ENV]: correlation,
    [SCREENSHOT_CAPTURED_AT_ENV]: capturedAt,
  };
  const previous = new Map(Object.keys(env).map((name) => [name, process.env[name]] as const));
  Object.assign(process.env, env);
  let result: Awaited<ReturnType<typeof runFallback>>;
  try {
    result = await runFallback({ testDir: input.testDir });
  } finally {
    for (const [name, value] of previous) restoreEnvironment(name, value);
  }
  const passed = result.failed === 0 && result.passed > 0;
  let runArtifacts: ArtifactRef[] = [];
  const artifactFailures: string[] = [];
  try {
    runArtifacts = await captureRunArtifacts(input.testDir, input.artifactsDir, run, {
      forbiddenSubstrings: Object.values(input.persona),
      screenshotCheckpoints: passed ? input.policy.screenshotCheckpoints : [],
      screenshotPrivacy: {
        binding: screenshot.binding,
        policy: screenshot.policy.policy,
        correlation,
        attester: '@arxic/verifier',
        attestedAt: screenshot.action.now(),
      },
    });
  } catch (error) {
    artifactFailures.push(
      `screenshot artifacts failed closed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const networkErrors =
    result.output.match(/(?:net::ERR_[A-Z_]+|requestfailed|network error)/giu) ?? [];
  return {
    passed,
    browserVersion,
    artifacts: runArtifacts,
    diagnostics: result.listed === 0 ? result.diagnostics : [],
    networkErrors,
    observedTransitions: result.listed > 0 ? requiredTransitions : [],
    artifactFailures,
  };
}

async function resetAndSeed(
  origin: string,
  persona: { email: string; password: string },
): Promise<void> {
  const reset = await fetch(`${origin}/api/__arxic/reset`, { method: 'POST' });
  if (!reset.ok) throw new Error(`Fixture reset returned ${reset.status}`);
  const seed = await fetch(`${origin}/api/__arxic/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ personaId: 'arxic-verifier-user', ...persona }),
  });
  if (!seed.ok) throw new Error(`Fixture seed returned ${seed.status}`);
}

function classifiedResult(
  input: VerifyStagedSuiteInput,
  runs: Array<{ passed: boolean }>,
  artifacts: ArtifactRef[],
  classificationInput: Omit<ClassificationInput, 'subject' | 'runs' | 'policy'>,
): VerifyStagedSuiteResult {
  const classification = classifyVerification({
    subject: input.workflow.id,
    runs,
    policy: input.policy,
    ...classificationInput,
  });
  return {
    outcome: classification.outcome,
    runs,
    artifacts,
    diagnostics: classification.diagnostics,
  };
}

function unavailableDiagnostic(subject: string, message: string): Diagnostic {
  return verifyDiagnostic(ARXIC_VERIFY_SUITE_UNAVAILABLE, 'blocked', subject, message);
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
