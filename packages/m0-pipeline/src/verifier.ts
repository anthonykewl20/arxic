import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ArtifactRef,
  Diagnostic,
  TruthState,
  VerificationPolicy,
  Workflow,
} from '@arxic/contracts';
import { installedChromiumVersion, runFallback } from '@arxic/playwright-agent-adapter';
import { retainCaptureArtifacts } from '@arxic/playwright-trace-sanitizer';
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
import {
  ARXIC_EXIT_APP_DEFECT_CONTRADICTED,
  ARXIC_EXIT_EVIDENCE_GATE_BLOCKED,
  ARXIC_EXIT_FLAKY_RUNS,
  exitDiagnostic,
} from './diagnostics';

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
    return blockedResult([], [], 'Verification requires at least one clean-fixture run');
  }
  const requiredTransitions = input.workflow.transitions
    .filter((transition) => transition.required !== false)
    .map((transition) => `${transition.from}->${transition.to}`);
  const artifacts: ArtifactRef[] = [];
  const diagnostics: Diagnostic[] = [];
  const runs: Array<{ passed: boolean }> = [];
  const observed = new Set<string>();
  const artifactFailures: string[] = [];
  const browserVersions = new Set<string>();
  const specPath = join(input.testDir, 'workflow.spec.ts');
  try {
    artifacts.push(await artifactRef('spec', specPath));
  } catch (error) {
    return blockedResult(
      runs,
      artifacts,
      `The staged suite is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
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
      return blockedResult(
        runs,
        artifacts,
        `Screenshot privacy binding failed: ${error instanceof Error ? error.message : String(error)}`,
      );
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
      return blockedResult(
        runs,
        artifacts,
        `Clean-fixture pass ${run} could not execute: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const networkFailed = input.policy.forbidNetworkErrors && (pass.networkErrors?.length ?? 0) > 0;
    runs.push({ passed: pass.passed && !networkFailed });
    artifacts.push(...(pass.artifacts ?? []));
    diagnostics.push(...(pass.diagnostics ?? []));
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
  if (missing.length > 0) {
    return blockedResult(
      runs,
      artifacts,
      `Required transitions lack runtime observations: ${missing.join(', ')}`,
      diagnostics,
    );
  }
  const passed = runs.filter((run) => run.passed).length;
  if (passed === runs.length && runs.length >= input.policy.requiredRuns) {
    if (artifactFailures.length > 0)
      return blockedResult(runs, artifacts, artifactFailures.join('; '), diagnostics);
    if (browserVersions.size !== 1) {
      return blockedResult(
        runs,
        artifacts,
        'Clean-fixture passes did not record exactly one consistent browser version',
        diagnostics,
      );
    }
    return {
      outcome: 'verified',
      runs,
      artifacts,
      diagnostics,
      browserVersion: [...browserVersions][0],
    };
  }
  if (passed > 0) {
    diagnostics.push(
      exitDiagnostic(
        ARXIC_EXIT_FLAKY_RUNS,
        'contradicted',
        input.workflow.id,
        'Verification split between passing and failing clean-fixture runs',
      ),
    );
  } else {
    diagnostics.push(
      exitDiagnostic(
        ARXIC_EXIT_APP_DEFECT_CONTRADICTED,
        'contradicted',
        input.workflow.id,
        'Runtime disproved the candidate in every clean-fixture run',
      ),
    );
  }
  return { outcome: 'contradicted', runs, artifacts, diagnostics };
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
    runArtifacts = await retainRunArtifacts(
      input.testDir,
      input.artifactsDir,
      run,
      Object.values(input.persona),
      passed ? input.policy.screenshotCheckpoints : [],
      {
        binding: screenshot.binding,
        policy: screenshot.policy.policy,
        correlation,
        attestedAt: screenshot.action.now(),
      },
    );
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
    body: JSON.stringify({ personaId: 'm0-exit-user', ...persona }),
  });
  if (!seed.ok) throw new Error(`Fixture seed returned ${seed.status}`);
}

export async function retainRunArtifacts(
  testDir: string,
  artifactsDir: string,
  run: number,
  forbiddenSubstrings: readonly string[],
  screenshotCheckpoints: readonly string[] = [],
  screenshotPrivacy?: Readonly<{
    binding: TrustedScreenshotCaptureBinding;
    policy: ScreenshotPrivacyPolicy;
    correlation: string;
    attestedAt: string;
  }>,
): Promise<ArtifactRef[]> {
  const retained = await retainCaptureArtifacts({
    roots: [join(testDir, 'artifacts'), join(testDir, 'test-results')],
    destination: join(artifactsDir, 'verification', `run-${run}`),
    forbiddenSubstrings,
    screenshotCheckpoints,
    screenshotPrivacy: screenshotPrivacy
      ? {
          testDirectory: testDir,
          ...screenshotPrivacy,
          attester: '@arxic/m0-pipeline',
        }
      : undefined,
  });
  if (retained.ok) return retained.refs;
  throw new Error(`${retained.code}: ${retained.message}`);
}

export async function artifactRef(kind: string, path: string): Promise<ArtifactRef> {
  const bytes = await readFile(path);
  return { kind, path, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function blockedResult(
  runs: Array<{ passed: boolean }>,
  artifacts: ArtifactRef[],
  message: string,
  diagnostics: Diagnostic[] = [],
): VerifyStagedSuiteResult {
  return {
    outcome: 'blocked',
    runs,
    artifacts,
    diagnostics: [
      ...diagnostics,
      exitDiagnostic(ARXIC_EXIT_EVIDENCE_GATE_BLOCKED, 'blocked', 'verification.evidence', message),
    ],
  };
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
