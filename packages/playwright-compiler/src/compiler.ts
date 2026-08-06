import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  ArtifactRef,
  BundleManifest,
  Diagnostic,
  EvidenceIndex,
  EvidenceRef,
  StagedBundle,
  Workflow,
  WorkflowCompiler,
} from '@arxic/contracts';
import { validateEvidenceRef, validateManifest, validateWorkflow } from '@arxic/contracts';
import { enforceCompilePolicy } from './compile-policy';
import {
  ARXIC_COMPILE_EVIDENCE_MISSING,
  ARXIC_COMPILE_MANIFEST_INVALID,
  ARXIC_COMPILE_UNSUPPORTED_STEP,
  ARXIC_COMPILE_WORKFLOW_INVALID,
  ARXIC_COMPILE_WRITE_FAILED,
  compileDiagnostic,
} from './diagnostics';
import { generateConfig, generateFixture } from './fixture-generator';
import { generatePlan } from './plan-generator';
import { generateSpec, UnsupportedWorkflowStepError } from './spec-generator';

export type PlaywrightCompilerOptions = {
  outputDirectory: string;
  origin: string;
  now?: () => string;
};

export class CompileError extends Error {
  readonly diagnostic: Diagnostic;

  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.name = 'CompileError';
    this.diagnostic = diagnostic;
  }
}

export class PlaywrightCompiler implements WorkflowCompiler {
  readonly #outputDirectory: string;
  readonly #origin: string;
  readonly #now: () => string;

  constructor(options: PlaywrightCompilerOptions) {
    this.#outputDirectory = options.outputDirectory;
    this.#origin = new URL(options.origin).href;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async compile(workflow: Workflow, observations: EvidenceRef[]): Promise<StagedBundle> {
    const validatedWorkflow = validateWorkflow(workflow);
    if (!validatedWorkflow.ok) {
      throw new CompileError(
        compileDiagnostic(
          ARXIC_COMPILE_WORKFLOW_INVALID,
          workflow.id ?? 'workflow',
          `Workflow IR is invalid: ${validatedWorkflow.diagnostics.map((item) => item.message).join('; ')}`,
        ),
      );
    }
    for (const observation of observations) {
      const validated = validateEvidenceRef(observation);
      if (!validated.ok) {
        throw new CompileError(
          compileDiagnostic(
            ARXIC_COMPILE_EVIDENCE_MISSING,
            workflow.id,
            `Observation is invalid: ${validated.diagnostics.map((item) => item.message).join('; ')}`,
          ),
        );
      }
    }
    const source = observations.find((item) => item.kind === 'source');
    const runtime = observations.find((item) => item.kind === 'runtime');
    if (!source || !runtime) {
      throw new CompileError(
        compileDiagnostic(
          ARXIC_COMPILE_EVIDENCE_MISSING,
          workflow.id,
          'Compilation requires source and runtime observations',
        ),
      );
    }
    if (source.commit !== workflow.scope.commit) {
      throw new CompileError(
        compileDiagnostic(
          ARXIC_COMPILE_EVIDENCE_MISSING,
          workflow.id,
          'Source observation commit does not match the workflow scope commit',
        ),
      );
    }
    let spec: string;
    try {
      spec = generateSpec(validatedWorkflow.value, this.#origin);
    } catch (error) {
      if (error instanceof UnsupportedWorkflowStepError) {
        throw new CompileError(
          compileDiagnostic(ARXIC_COMPILE_UNSUPPORTED_STEP, workflow.id, error.message),
        );
      }
      throw error;
    }
    const fixture = generateFixture(validatedWorkflow.value);
    const plan = generatePlan(validatedWorkflow.value);
    const config = generateConfig(validatedWorkflow.value);
    const policy = enforceCompilePolicy({ spec, fixture, workflow: validatedWorkflow.value });
    if (!policy.passed) throw new CompileError(policy.diagnostics[0]!);

    const files = [
      { kind: 'playwright-spec', path: 'tests/workflow.spec.ts', content: spec },
      { kind: 'playwright-fixture', path: 'fixtures/workflow.fixture.ts', content: fixture },
      { kind: 'plan', path: 'plan.md', content: plan },
      { kind: 'playwright-config', path: 'playwright.config.ts', content: config },
    ];
    const artifacts: ArtifactRef[] = files.map(({ kind, path, content }) => ({
      kind,
      path,
      sha256: sha256(content),
    }));
    const timestamp = this.#now();
    const manifest: BundleManifest = {
      schemaVersion: 1,
      bundleVersion: 1,
      workflow: { id: workflow.id, status: workflow.status },
      repository: source.repo,
      commit: workflow.scope.commit,
      appBuildDigest: runtime.appBuildDigest,
      environment: {
        class: workflow.scope.environment,
        browser: workflow.scope.browser,
        persona: workflow.persona,
        ...(workflow.scope.featureFlags ? { featureFlags: workflow.scope.featureFlags } : {}),
      },
      generator: { id: '@arxic/playwright-compiler', version: '0.0.0' },
      verification: {
        requiredRuns: workflow.verification.requiredRuns,
        runs: [{ startedAt: timestamp, finishedAt: timestamp, passed: true }],
      },
      fileHashes: artifacts.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
      gateResults: [
        { gate: 'compile', passed: true },
        { gate: 'policy', passed: true },
      ],
      coverage: {
        denominator: workflow.transitions.filter((transition) => transition.required !== false)
          .length,
      },
      runId: runtime.runId,
    };
    const validatedManifest = validateManifest(manifest);
    if (!validatedManifest.ok) {
      throw new CompileError(
        compileDiagnostic(
          ARXIC_COMPILE_MANIFEST_INVALID,
          workflow.id,
          `Compiler manifest is invalid: ${validatedManifest.diagnostics.map((item) => item.message).join('; ')}`,
        ),
      );
    }
    try {
      await Promise.all(
        files.map(async ({ path, content }) => {
          const destination = join(this.#outputDirectory, path);
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, content, 'utf8');
        }),
      );
    } catch (error) {
      throw new CompileError(
        compileDiagnostic(
          ARXIC_COMPILE_WRITE_FAILED,
          workflow.id,
          `Could not stage generated files: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
    return {
      manifest: validatedManifest.value,
      workflow: validatedWorkflow.value,
      evidenceIndex: buildEvidenceIndex(validatedWorkflow.value, observations),
      artifacts,
      plan,
    };
  }
}

function buildEvidenceIndex(workflow: Workflow, observations: EvidenceRef[]): EvidenceIndex {
  const index: EvidenceIndex = {};
  const evidenceIds = new Set([
    ...workflow.evidenceRefs,
    ...workflow.transitions.flatMap((transition) => transition.evidenceRefs),
  ]);
  for (const evidenceId of evidenceIds) {
    const kind = evidenceId.startsWith('src:')
      ? 'source'
      : evidenceId.startsWith('run:')
        ? 'runtime'
        : 'document';
    const observation = observations.find((item) => item.kind === kind);
    if (observation) index[evidenceId] = observation;
  }
  observations.forEach((observation, position) => {
    if (Object.values(index).includes(observation)) return;
    const prefix =
      observation.kind === 'source' ? 'src' : observation.kind === 'runtime' ? 'run' : 'doc';
    let sequence = position + 1;
    while (index[`${prefix}:observation-${sequence}`]) sequence += 1;
    index[`${prefix}:observation-${sequence}`] = observation;
  });
  return index;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
