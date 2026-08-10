import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EvidenceRef } from '@arxic/contracts';
import { PlaywrightCompiler } from '@arxic/playwright-compiler';
import { PlaywrightVerifier } from '@arxic/verifier';
import {
  ARXIC_AUTH_CAPABILITY_UNSUPPORTED,
  ARXIC_AUTH_COMPILE_BLOCKED,
  ARXIC_AUTH_FIXTURE_UNAVAILABLE,
  ARXIC_AUTH_NO_EVIDENCE,
  authDiagnostic,
} from './diagnostics';
import { candidateEvidence, createCoverageMatrix, createDomainManifest } from './manifest';
import type {
  AuthCandidate,
  AuthDomainPackDependencies,
  AuthDomainPackOptions,
  DomainPack,
  WorkflowResult,
} from './types';

export class AuthDomainPackAssembler {
  readonly #options: AuthDomainPackOptions;
  readonly #dependencies: AuthDomainPackDependencies;

  constructor(options: AuthDomainPackOptions, dependencies: AuthDomainPackDependencies = {}) {
    this.#options = options;
    this.#dependencies = dependencies;
  }

  async assemble(candidates: AuthCandidate[], observations: EvidenceRef[]): Promise<DomainPack> {
    await mkdir(this.#options.outputDirectory, { recursive: true });
    const workflows: WorkflowResult[] = [];
    for (const candidate of candidates) {
      workflows.push(await this.#assembleWorkflow(candidate, observations));
    }
    const pack: DomainPack = {
      manifest: createDomainManifest(
        workflows,
        (this.#options.now ?? (() => new Date().toISOString()))(),
      ),
      coverageMatrix: createCoverageMatrix(candidates, workflows),
      workflows,
    };
    await Promise.all([
      writeJson(join(this.#options.outputDirectory, 'domain-manifest.json'), pack.manifest),
      writeJson(join(this.#options.outputDirectory, 'coverage-matrix.json'), pack.coverageMatrix),
    ]);
    return pack;
  }

  async #assembleWorkflow(
    candidate: AuthCandidate,
    observations: EvidenceRef[],
  ): Promise<WorkflowResult> {
    const { workflow } = candidate;
    const base = { id: workflow.id, title: workflow.title };
    const evidenceRefs = candidateEvidence(candidate);
    const outputDirectory = join(this.#options.outputDirectory, workflow.id);
    await mkdir(outputDirectory, { recursive: true });
    if (candidate.capabilityBlocker) {
      return {
        ...base,
        outcome: 'blocked',
        diagnostics: [
          authDiagnostic(
            ARXIC_AUTH_CAPABILITY_UNSUPPORTED,
            workflow.id,
            `Capability unsupported by target app: ${candidate.capabilityBlocker.reason}`,
            evidenceRefs,
          ),
        ],
      };
    }
    if (
      !evidenceRefs.some((id) => id.startsWith('src:')) ||
      !evidenceRefs.some((id) => id.startsWith('run:'))
    ) {
      return {
        ...base,
        outcome: 'blocked',
        diagnostics: [
          authDiagnostic(
            ARXIC_AUTH_NO_EVIDENCE,
            workflow.id,
            'Candidate requires both source and runtime evidence before compilation.',
            evidenceRefs,
          ),
        ],
      };
    }
    if (candidate.fixtureBlocker) {
      return {
        ...base,
        outcome: 'blocked',
        diagnostics: [
          authDiagnostic(
            ARXIC_AUTH_FIXTURE_UNAVAILABLE,
            workflow.id,
            `${candidate.fixtureBlocker.fixture} fixture unavailable: ${candidate.fixtureBlocker.reason}`,
            evidenceRefs,
          ),
        ],
      };
    }
    const compiler =
      this.#dependencies.compiler?.(outputDirectory) ??
      new PlaywrightCompiler({
        outputDirectory,
        origin: this.#options.origin,
        ...(this.#options.now ? { now: this.#options.now } : {}),
      });
    let bundle;
    try {
      bundle = await compiler.compile(workflow, observations);
    } catch (error) {
      return {
        ...base,
        outcome: 'blocked',
        diagnostics: [
          authDiagnostic(
            ARXIC_AUTH_COMPILE_BLOCKED,
            workflow.id,
            `Workflow could not be compiled: ${error instanceof Error ? error.message : String(error)}`,
            evidenceRefs,
          ),
        ],
      };
    }
    const verifier =
      this.#dependencies.verifier?.(outputDirectory) ??
      new PlaywrightVerifier({
        outputDirectory,
        origin: this.#options.origin,
        artifactsDir: join(this.#options.artifactsDir, workflow.id),
        persona: this.#options.persona,
        ...(this.#options.screenshotPrivacyPolicy
          ? { screenshotPrivacyPolicy: this.#options.screenshotPrivacyPolicy }
          : {}),
        ...(this.#options.resetAndSeed ? { resetAndSeed: this.#options.resetAndSeed } : {}),
      });
    const verification = await verifier.verify(bundle, workflow.verification);
    return {
      ...base,
      outcome: verification.outcome,
      diagnostics: verification.diagnostics,
      ...(verification.outcome === 'verified' ? { bundle } : {}),
      verification,
    };
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
