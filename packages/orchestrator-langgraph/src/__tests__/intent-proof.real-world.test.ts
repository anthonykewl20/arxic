import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { EvidenceRef, PromotionReceipt, Workflow } from '@arxic/contracts';
import {
  ARXIC_INTENT_ORACLE_CONFLICT,
  INTENT_SCHEMA_VERSION,
  canonicalJson,
  normalizeIntentSpec,
  type IntentSpecInput,
  type OracleSpec,
} from '@arxic/intent';
import { PlaywrightCompiler } from '@arxic/playwright-compiler';
import {
  FIXTURE_APPS,
  bootFixtureApp,
  loginObservations,
  loginWorkflow,
  seedFixture,
  stopApp,
  type FixtureApp,
  type RunningApp,
} from '@arxic/real-world-testkit';
import { PlaywrightVerifier, resetAndSeedFixtures } from '@arxic/verifier';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  InMemoryStageCheckpointer,
  LangGraphOrchestrator,
  createSensitivityProbeAdapter,
  type Candidate,
  type CompilationResult,
  type OracleResolution,
  type OracleResolutionInput,
  type OracleRule,
  type VerificationNodeResult,
} from '..';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const candidateId = 'authentication.login';
const directories: string[] = [];
let fixtureAppLease = Promise.resolve();

type ResolutionMode = 'acceptance' | 'characterization' | 'conflict';

async function leaseFixtureApp(app: FixtureApp, prefix: string) {
  const previous = fixtureAppLease;
  let release!: () => void;
  fixtureAppLease = new Promise<void>((resolveLease) => {
    release = resolveLease;
  });
  await previous;
  try {
    return { running: await bootFixtureApp(root, app, prefix), release };
  } catch (error) {
    release();
    throw error;
  }
}

describe.sequential('ADR-004 two-app intent proof matrix', () => {
  describe.each(FIXTURE_APPS)('$name', (app) => {
    let running: RunningApp | undefined;
    let releaseFixture: (() => void) | undefined;
    let repository = '';
    let commit = '';
    let artifactsDir = '';
    let probeParent = '';
    let appBuildDigest = '';
    let expectedNonce = '';
    let orchestrationOrigin = '';
    let attestationServer: Server | undefined;

    beforeAll(async () => {
      const leased = await leaseFixtureApp(app, `arxic-intent-proof-${app.name}`);
      running = leased.running;
      releaseFixture = leased.release;
      ({ repository, commit } = await committedFixtureSource(app));
      artifactsDir = await temporaryDirectory(`artifacts-${app.name}-`);
      probeParent = await temporaryDirectory(`probe-${app.name}-`);
      await seedFixture(running.origin, `intent-proof-${app.name}`, app.persona);
      const attestation = (await (
        await fetch(`${running.origin}/.well-known/arxic-test-target.json`)
      ).json()) as { buildDigest: string; nonce: string };
      appBuildDigest = attestation.buildDigest;
      expectedNonce = attestation.nonce;
      ({ origin: orchestrationOrigin, server: attestationServer } = await startAttestationServer(
        appBuildDigest,
        expectedNonce,
      ));
    }, 240_000);

    afterAll(async () => {
      try {
        await closeServer(attestationServer);
        await stopApp(running?.child);
        await Promise.all(
          [running?.runtimeDirectory, repository, artifactsDir, probeParent]
            .filter((path): path is string => Boolean(path))
            .map((path) => rm(path, { recursive: true, force: true })),
        );
      } finally {
        releaseFixture?.();
      }
    });

    test('composes oracle resolution, live verification, and promotion policy', async () => {
      if (!running) throw new Error(`Fixture app ${app.name} did not start`);
      const candidate = loginCandidate(app, commit);
      const observations = realObservations(
        app,
        running.origin,
        repository,
        commit,
        appBuildDigest,
      );

      if (app.name === 'vulnerable-auth-app') {
        expect(app.authSurface.login.assertion).toBe('text:Logged in');
        const conflict = await runProof('conflict', domainRule(), candidate, observations);

        expect(conflict.result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: ARXIC_INTENT_ORACLE_CONFLICT,
            severity: 'contradicted',
          }),
        );
        expect(conflict.result.outcome, JSON.stringify(conflict.result.diagnostics)).toBe(
          'contradicted',
        );
        expect(conflict.result.promotionEligible).toBe(false);
        expect(conflict.result.receipt).toBeUndefined();

        const characterization = await runProof(
          'characterization',
          { kind: 'observed-only' },
          candidate,
          observations,
        );
        const stageNine = await readArtifact<CompilationResult>(
          characterization.checkpointer,
          characterization.result,
          characterization.runId,
          9,
        );

        expect(stageNine.intentSpec?.assertions).toEqual([
          expect.objectContaining({
            kind: 'characterization',
            expectedValue: 'text:Logged in',
          }),
        ]);
        expect(characterization.result.outcome).toBe('verified');
        expect(characterization.result.promotionEligible).toBe(false);
        expect(characterization.result.receipt).toBeUndefined();

        console.info(
          `Intent proof vulnerable-auth-app: ${JSON.stringify({ conflict: { oracle: 'url:/', runtime: app.authSurface.login.assertion, diagnostic: ARXIC_INTENT_ORACLE_CONFLICT, outcome: conflict.result.outcome, promotionEligible: conflict.result.promotionEligible, receipt: conflict.result.receipt ?? null }, characterization: { assertion: app.authSurface.login.assertion, kind: stageNine.intentSpec?.assertions[0]?.kind, outcome: characterization.result.outcome, promotionEligible: characterization.result.promotionEligible, receipt: characterization.result.receipt ?? null }, chromium: true })}`,
        );
        return;
      }

      expect(app.authSurface.login.assertion).toBe('url:/');
      const acceptance = await runProof('acceptance', domainRule(), candidate, observations);
      const stageTen = await readArtifact<VerificationNodeResult>(
        acceptance.checkpointer,
        acceptance.result,
        acceptance.runId,
        10,
      );

      expect(stageTen.sensitivityProbe).toEqual({
        probed: 2,
        controlPassed: true,
        assertions: [
          {
            transitionIndex: 0,
            assertionIndex: 0,
            operators: [
              { kind: 'value-substitution', killed: true, controlPassed: true },
              { kind: 'control-state-omission', killed: true, controlPassed: true },
            ],
            killed: true,
          },
        ],
      });
      expect(stageTen.gates).toContainEqual({ gate: 'sensitivity', passed: true });
      expect(acceptance.result.outcome, JSON.stringify(acceptance.result.diagnostics)).toBe(
        'verified',
      );
      expect(acceptance.result.promotionEligible).toBe(true);
      expect(acceptance.result.receipt).toBeDefined();

      console.info(
        `Intent proof reference-auth-app: ${JSON.stringify({ acceptance: { assertion: app.authSurface.login.assertion, outcome: acceptance.result.outcome, probe: { controlPassed: stageTen.sensitivityProbe?.controlPassed, killed: stageTen.gates.some(({ gate, passed }) => gate === 'sensitivity' && passed) }, promotionEligible: acceptance.result.promotionEligible, receipt: acceptance.result.receipt ? 'promoted' : null }, chromium: true })}`,
      );
    }, 600_000);

    async function runProof(
      mode: ResolutionMode,
      oracle: OracleSpec,
      candidate: Candidate,
      observations: EvidenceRef[],
    ) {
      if (!running) throw new Error(`Fixture app ${app.name} did not start`);
      const runId = `intent-proof-${app.name}-${mode}`;
      const checkpointer = new InMemoryStageCheckpointer();
      const verificationArtifacts = await temporaryDirectory(`verification-${app.name}-${mode}-`);
      const oracleRules: readonly OracleRule[] = [{ candidateId, oracle }];
      const probeSensitivity = createSensitivityProbeAdapter({
        parentDirectory: probeParent,
        env: {
          ARXIC_INPUT_PERSONA_EMAIL: app.persona.email,
          ARXIC_INPUT_PERSONA_PASSWORD: app.persona.password,
        },
        resetAndSeed: async () => resetAndSeedFixtures(running!.origin, app.persona),
      });
      const orchestrator = new LangGraphOrchestrator({
        checkpointer,
        inferCandidates: async () => ({ requestId: runId, candidates: [candidate] }),
        reconcile: async () => ({ denominator: 1, rows: [] }),
        prepareFixtures: async () => ({
          provisioned: true,
          requirements: [],
          leases: [],
          diagnostics: [],
        }),
        explore: async () => ({ approved: true, evidenceRefs: observations, decisions: [] }),
        resolveOracle: (input) => realResolution(input, mode, app.authSurface.login.assertion),
        compile: async ({ candidates, observations: compileObservations, outputDirectory }) => {
          const workflow = candidates[0]?.workflow;
          if (!workflow) throw new Error('Expected login workflow at compile');
          const stagedBundle = await new PlaywrightCompiler({
            outputDirectory,
            origin: running!.origin,
          }).compile(workflow, [...compileObservations]);
          return { compiled: true, plan: stagedBundle.plan, workflow, stagedBundle };
        },
        verify: async (compilation) => {
          const stagedBundle =
            compilation.stagedBundle ??
            (await new PlaywrightCompiler({
              outputDirectory: join(artifactsDir, runId),
              origin: running!.origin,
            }).compile(candidate.workflow!, observations));
          const verification = await new PlaywrightVerifier({
            outputDirectory: join(artifactsDir, runId),
            origin: running!.origin,
            artifactsDir: verificationArtifacts,
            persona: app.persona,
            screenshotPrivacyPolicy: screenshotPolicy(app.name),
          }).verify(stagedBundle, stagedBundle.workflow.verification);
          return {
            ...verification,
            stagedBundle,
            gates: [{ gate: 'verify', passed: verification.outcome === 'verified' }],
          };
        },
        probeSensitivity: (input) =>
          probeSensitivity({ ...input, origin: running!.origin, runtimeUrl: input.runtimeUrl }),
        promote: async (bundle) => promotionReceipt(bundle.manifest, runId),
      });
      const result = await orchestrator.run({
        runId,
        origin: orchestrationOrigin,
        revision: { repository: pathToFileURL(repository).href, commit, dirty: false },
        rulepacksDir: resolve(root, 'rulepacks'),
        artifactsDir,
        framework: app.name === 'reference-auth-app' ? 'nextjs' : 'express',
        features: ['login'],
        maxUrls: 1,
        maxDepth: 0,
        appBuildDigest,
        expectedNonce,
        oracleRules,
      });
      return { result, checkpointer, runId };
    }
  });
});

async function realResolution(
  input: OracleResolutionInput,
  mode: ResolutionMode,
  runtimeAssertion: string,
): Promise<OracleResolution> {
  const candidate = input.candidates[0];
  const workflow = candidate?.workflow;
  const transition = workflow?.transitions[0];
  const assertion = transition?.assertions[0];
  if (!candidate || !workflow || !transition || !assertion) {
    throw new Error('Expected live login candidate');
  }
  const evidenceRefs = {
    source: candidate.evidenceRefs.filter((ref) => ref.startsWith('src:')),
    runtime: candidate.evidenceRefs.filter((ref) => ref.startsWith('run:')),
  };
  const oracles = input.oracleRules.map(({ oracle }) => oracle);
  const baseAssertion = {
    id: 'login-success',
    intent: assertion.intent,
    oracles,
    evidenceRefs,
  };
  const specInput: IntentSpecInput = {
    schemaVersion: INTENT_SCHEMA_VERSION,
    id: `${input.runId}-intent`,
    domain: workflow.domain,
    persona: workflow.persona,
    intent: workflow.title,
    lineage: input.lineage,
    proposals: [
      {
        id: `${candidate.id}:0`,
        intent: transition.action.intent,
        action: transition.action.intent,
        fromState: transition.from,
        toState: transition.to,
        evidenceRefs,
      },
    ],
    assertions:
      mode === 'conflict'
        ? [
            { ...baseAssertion, expectedValue: 'url:/' },
            { ...baseAssertion, expectedValue: runtimeAssertion },
          ]
        : [{ ...baseAssertion, expectedValue: runtimeAssertion }],
    evidenceRefs,
  };
  const normalized = normalizeIntentSpec(specInput);
  if (!normalized.ok) {
    return {
      resolved: [],
      diagnostics: normalized.diagnostics,
      outcome: normalized.diagnostics.some(({ severity }) => severity === 'blocked')
        ? 'blocked'
        : 'contradicted',
    };
  }
  return {
    intentSpec: normalized.spec,
    resolved: normalized.spec.assertions,
    diagnostics: [],
    outcome: 'observed',
  };
}

function loginCandidate(app: FixtureApp, commit: string): Candidate {
  const workflow = loginWorkflow(app, {
    id: candidateId,
    title: `Intent proof login ${app.name}`,
    dualEvidence: true,
  });
  const committedWorkflow: Workflow = {
    ...workflow,
    scope: { ...workflow.scope, commit },
  };
  return {
    id: candidateId,
    title: committedWorkflow.title,
    evidenceRefs: committedWorkflow.evidenceRefs,
    workflow: committedWorkflow,
  };
}

function realObservations(
  app: FixtureApp,
  origin: string,
  repository: string,
  commit: string,
  appBuildDigest: string,
): EvidenceRef[] {
  return loginObservations(app, origin, `intent-proof-${app.name}`).map((observation) =>
    observation.kind === 'source'
      ? { ...observation, repo: pathToFileURL(repository).href, commit }
      : { ...observation, appBuildDigest },
  );
}

function domainRule(): OracleSpec {
  const identity = {
    domainPackId: '@arxic/auth-domain-pack',
    ruleId: candidateId,
    ruleVersion: '0.0.0',
  };
  return {
    kind: 'domain-rule',
    ...identity,
    digest: createHash('sha256').update(canonicalJson(identity)).digest('hex'),
  };
}

function screenshotPolicy(appName: string) {
  return {
    schemaVersion: 1,
    id: `intent-proof-${appName}-main-mask`,
    authority: {
      kind: 'repository-policy',
      reference: 'docs/evidence/M1-SCREENSHOT-PRIVACY/README.md',
      recordedAt: '2026-08-11T00:00:00.000Z',
    },
    capture: {
      mode: 'masked-page',
      fullPage: true,
      masks: [{ kind: 'role', role: 'main', exact: true }],
    },
  } as const;
}

function promotionReceipt(manifest: PromotionReceipt['manifest'], runId: string): PromotionReceipt {
  return {
    manifest,
    promotedAt: '2026-08-11T00:00:00.000Z',
    location: `test://intent-proof/${runId}`,
    checksumSha256: createHash('sha256').update(runId).digest('hex'),
  };
}

async function readArtifact<T>(
  checkpointer: InMemoryStageCheckpointer,
  state: Awaited<ReturnType<LangGraphOrchestrator['run']>>,
  runId: string,
  stage: 9 | 10,
): Promise<T> {
  const ref = state.artifacts[stage];
  if (!ref) throw new Error(`Expected stage-${stage} artifact`);
  return (await checkpointer.readArtifact(runId, ref)) as T;
}

async function committedFixtureSource(app: FixtureApp) {
  const source = resolve(root, 'test-fixtures', app.name);
  const repository = await temporaryDirectory(`source-${app.name}-`);
  const relativeSourcePath = app.login.sourcePath.replace(`test-fixtures/${app.name}/`, '');
  await mkdir(join(repository, relativeSourcePath, '..'), { recursive: true });
  await cp(join(source, relativeSourcePath), join(repository, relativeSourcePath));
  const environment = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Arxic Test',
    GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
    GIT_COMMITTER_NAME: 'Arxic Test',
    GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
    GIT_AUTHOR_DATE: '2026-08-11T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-08-11T00:00:00Z',
  };
  await execute('git', ['init', '--initial-branch=main'], { cwd: repository, env: environment });
  await execute('git', ['add', '.'], { cwd: repository, env: environment });
  await execute('git', ['commit', '-m', `${app.name} intent proof`], {
    cwd: repository,
    env: environment,
  });
  const commit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim();
  expect(await readFile(join(repository, relativeSourcePath))).toBeDefined();
  return { repository, commit };
}

async function startAttestationServer(buildDigest: string, nonce: string) {
  let origin = '';
  const server = createServer((request, response) => {
    if (request.url === '/.well-known/arxic-test-target.json') {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          environmentClass: 'local-test',
          origin,
          allowedOrigins: [origin],
          buildDigest,
          nonce,
        }),
      );
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><title>Arxic intent proof target</title>');
  });
  await new Promise<void>((listen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', listen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Attestation server did not bind');
  origin = `http://127.0.0.1:${address.port}`;
  return { origin, server };
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((close, reject) => {
    server.close((error) => (error ? reject(error) : close()));
  });
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `arxic-intent-proof-${prefix}`));
  directories.push(directory);
  return directory;
}
