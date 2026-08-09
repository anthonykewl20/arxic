import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  ArtifactRef,
  Diagnostic,
  TruthState,
  VerificationPolicy,
  Workflow,
} from '@arxic/contracts';
import { runFallback } from '@arxic/playwright-agent-adapter';
import {
  discardCapturedArtifact,
  isSensitiveArtifactFilename,
  readTraceCarrierFreePng,
  sanitizeCapturedPlaywrightTrace,
} from '@arxic/playwright-trace-sanitizer';
import {
  ARXIC_EXIT_APP_DEFECT_CONTRADICTED,
  ARXIC_EXIT_EVIDENCE_GATE_BLOCKED,
  ARXIC_EXIT_FLAKY_RUNS,
  exitDiagnostic,
} from './diagnostics';

export type StagedSuitePass = {
  passed: boolean;
  artifacts?: ArtifactRef[];
  diagnostics?: Diagnostic[];
  networkErrors?: string[];
  observedTransitions?: string[];
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
};

export type VerifyStagedSuiteResult = {
  outcome: TruthState;
  runs: Array<{ passed: boolean }>;
  artifacts: ArtifactRef[];
  diagnostics: Diagnostic[];
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
        : await executeFallbackRun(input, run, requiredTransitions);
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
    return { outcome: 'verified', runs, artifacts, diagnostics };
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
): Promise<StagedSuitePass> {
  const previousEmail = process.env.ARXIC_INPUT_PERSONA_EMAIL;
  const previousPassword = process.env.ARXIC_INPUT_PERSONA_PASSWORD;
  process.env.ARXIC_INPUT_PERSONA_EMAIL = input.persona.email;
  process.env.ARXIC_INPUT_PERSONA_PASSWORD = input.persona.password;
  let result: Awaited<ReturnType<typeof runFallback>>;
  try {
    result = await runFallback({ testDir: input.testDir });
  } finally {
    restoreEnvironment('ARXIC_INPUT_PERSONA_EMAIL', previousEmail);
    restoreEnvironment('ARXIC_INPUT_PERSONA_PASSWORD', previousPassword);
  }
  const runArtifacts = await retainRunArtifacts(
    input.testDir,
    input.artifactsDir,
    run,
    Object.values(input.persona),
  );
  const networkErrors =
    result.output.match(/(?:net::ERR_[A-Z_]+|requestfailed|network error)/giu) ?? [];
  const passed = result.failed === 0 && result.passed > 0;
  return {
    passed,
    artifacts: runArtifacts,
    diagnostics: result.listed === 0 ? result.diagnostics : [],
    networkErrors,
    observedTransitions: result.listed > 0 ? requiredTransitions : [],
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
): Promise<ArtifactRef[]> {
  const destination = join(artifactsDir, 'verification', `run-${run}`);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const candidates = [join(testDir, 'artifacts'), join(testDir, 'test-results')];
  const files: string[] = [];
  for (const candidate of candidates) files.push(...(await filesUnder(candidate)));
  const refs: ArtifactRef[] = [];
  const sequences = { screenshot: 0, trace: 0 };
  for (const source of files.filter((path) => /\.(?:png|zip)$/u.test(path)).sort()) {
    const kind = source.endsWith('.png') ? 'screenshot' : 'trace';
    if (isSensitiveArtifactFilename(basename(source), forbiddenSubstrings)) {
      await rejectCapturedSource(source, 'Artifact source filename rejected by retention policy');
    }
    const screenshot = kind === 'screenshot' ? await readTraceCarrierFreePng(source) : undefined;
    if (screenshot && !screenshot.ok) {
      await rejectCapturedSource(
        source,
        'Screenshot source is not a strict trace-carrier-free PNG',
      );
    }
    sequences[kind] += 1;
    const target = join(
      destination,
      `${kind}-${String(sequences[kind]).padStart(3, '0')}.${kind === 'screenshot' ? 'png' : 'zip'}`,
    );
    if (kind === 'screenshot') {
      await writeFile(target, screenshot!.ok ? screenshot!.bytes : Buffer.alloc(0));
      refs.push(await artifactRef(kind, target));
      continue;
    }
    const provenancePath = `${target}.sanitization.json`;
    const sanitized = await sanitizeCapturedPlaywrightTrace({
      sourcePath: source,
      outputPath: target,
      provenancePath,
      forbiddenSubstrings,
    });
    if (!sanitized.ok) {
      throw new Error(`Trace sanitization failed (${sanitized.code}: ${sanitized.message})`);
    }
    refs.push(
      await artifactRef('trace', target),
      await artifactRef('trace-sanitization-report', provenancePath),
    );
  }
  return refs;
}

async function rejectCapturedSource(source: string, message: string): Promise<never> {
  const discarded = await discardCapturedArtifact(source);
  if (!discarded.ok) {
    throw new Error(`${message}; source cleanup ${discarded.sourceDisposition}`);
  }
  throw new Error(message);
}

async function filesUnder(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const path = join(root, entry.name);
        return entry.isDirectory() ? filesUnder(path) : Promise.resolve([path]);
      }),
    );
    return nested.flat();
  } catch {
    return [];
  }
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
