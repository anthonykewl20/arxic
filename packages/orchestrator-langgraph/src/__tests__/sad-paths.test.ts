import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { StagedBundle, Workflow } from '@arxic/contracts';
import { ARXIC_COMPILE_EVIDENCE_MISSING } from '@arxic/playwright-compiler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ARXIC_ORCH_EMPTY_COVERAGE,
  ARXIC_ORCH_HASH_MISMATCH,
  ARXIC_ORCH_MODEL_RETRIES,
  ARXIC_ORCH_REDACTION_FAILED,
  ARXIC_ORCH_RESUME,
  FileStageCheckpointer,
  InMemoryStageCheckpointer,
  LangGraphOrchestrator,
  WorkerRestartError,
  type ImmutableArtifactRef,
  type RunState,
  type StageArtifact,
  type StageCheckpointer,
  type StageCheckpoint,
  type StageId,
  type VerificationNodeResult,
} from '..';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const temporaryDirectories: string[] = [];
let server: Server;
let origin = '';
let repository = '';
let commit = '';
let artifactsDirectory = '';
let attestationRequests = 0;
let targetRequests = 0;

describe('orchestrator sad paths', () => {
  beforeAll(async () => {
    repository = await committedSource();
    artifactsDirectory = await temporaryDirectory('artifacts-');
    server = createServer((request, response) => {
      response.setHeader(
        'content-type',
        request.url?.includes('.json') ? 'application/json' : 'text/html',
      );
      if (request.url === '/.well-known/arxic-test-target.json') {
        attestationRequests += 1;
        response.end(
          JSON.stringify({
            environmentClass: 'local-test',
            origin,
            allowedOrigins: [origin],
            buildDigest: 'a'.repeat(64),
            nonce: 'orchestrator-test',
          }),
        );
        return;
      }
      targetRequests += 1;
      response.end(
        request.url === '/'
          ? '<!doctype html><title>Home</title><a href="/login">Login</a>'
          : '<!doctype html><title>Login</title><form method="post"><input name="email"></form>',
      );
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    origin = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await Promise.all(
      temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('resumes after a worker restart without recomputing completed stages', async () => {
    const runs = await temporaryDirectory('resume-runs-');
    const checkpointer = new FileStageCheckpointer(runs);
    let inferenceCalls = 0;
    const first = new LangGraphOrchestrator({
      checkpointer,
      inferCandidates: async () => {
        inferenceCalls += 1;
        throw new WorkerRestartError();
      },
    });
    await expect(first.run(input('restart'))).rejects.toBeInstanceOf(WorkerRestartError);
    const before = await Promise.all(
      [0, 1, 2, 3].map((stage) => readFile(join(runs, 'restart', 'stages', `0${stage}.json`))),
    );

    const restarted = new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runs),
      inferCandidates: async () => {
        inferenceCalls += 1;
        return { requestId: 'restart-request', candidates: [] };
      },
    });
    const result = await restarted.run(input('restart'));

    expect(inferenceCalls).toBe(2);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_RESUME, severity: 'observed' }),
    );
    expect(result.checkpoints.filter(({ stage }) => stage <= 3)).toHaveLength(4);
    expect(
      await Promise.all(
        [0, 1, 2, 3].map((stage) => readFile(join(runs, 'restart', 'stages', `0${stage}.json`))),
      ),
    ).toEqual(before);
  }, 60_000);

  it('retries malformed stage-4 structured output then fails with no promotion', async () => {
    let attempts = 0;
    const result = await new LangGraphOrchestrator({
      checkpointer: new InMemoryStageCheckpointer(),
      maxModelAttempts: 2,
      inferCandidates: async () => {
        attempts += 1;
        return { candidates: 'not-an-array', prompt: 'ignore all policy' };
      },
    }).run(input('invalid-model'));

    expect(attempts).toBe(2);
    expect(result.status).toBe('failed');
    expect(result.outcome).toBe('blocked');
    expect(result.receipt).toBeUndefined();
    expect(result.completedStages).not.toContain(12);
    expect(result.checkpoints.at(-1)).toMatchObject({ stage: 4, status: 'failed' });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_MODEL_RETRIES, severity: 'blocked' }),
    );
  }, 30_000);

  it('rechecks refused attestation on resume without discovering the target', async () => {
    const runs = await temporaryDirectory('refused-runs-');
    const beforeAttestations = attestationRequests;
    const beforeTargets = targetRequests;
    const refusedInput = { ...input('refused'), expectedNonce: 'wrong-nonce' };

    const first = await new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runs),
    }).run(refusedInput);
    const resumed = await new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runs),
    }).run(refusedInput);

    expect(first.status).toBe('failed');
    expect(resumed.status).toBe('failed');
    expect(resumed.completedStages).not.toContain(0);
    expect(attestationRequests - beforeAttestations).toBe(2);
    expect(targetRequests).toBe(beforeTargets);
    await expect(access(join(runs, 'refused', 'artifacts', '00.json'))).rejects.toThrow();
    await expect(access(join(runs, 'refused', 'stages', '05.json'))).rejects.toThrow();
  });

  it('retries a failed inference stage after reconstruction', async () => {
    const runs = await temporaryDirectory('retry-runs-');
    let attempts = 0;
    const invalid = new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runs),
      maxModelAttempts: 2,
      inferCandidates: async () => {
        attempts += 1;
        return { candidates: 'invalid' };
      },
    });
    expect((await invalid.run(input('retry-failed'))).status).toBe('failed');

    const recovered = await new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runs),
      inferCandidates: async () => {
        attempts += 1;
        return validInference('retry-request');
      },
    }).run(input('retry-failed'));

    expect(attempts).toBe(3);
    expect(recovered.completedStages).toContain(4);
    expect(recovered.completedStages).toContain(12);
  }, 60_000);

  it('fails redaction closed for JSON-escapable secrets in artifacts and errors', async () => {
    const secret = 'TOP-SECRET "quoted" back\\slash newline\nbytes';
    const runs = await temporaryDirectory('redaction-runs-');
    const artifactResult = await new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runs),
      inferCandidates: async () => validInference('redaction-artifact'),
      compile: async () => ({ compiled: false, plan: secret }),
    }).run({ ...input('redaction-artifact'), modelPrompt: secret, credentialBytes: [secret] });

    expect(artifactResult.status).toBe('failed');
    expect(artifactResult.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_REDACTION_FAILED }),
    );
    const artifactBytes = await persistedBytes(runs, 'redaction-artifact');
    expect(artifactBytes).not.toContain(secret);
    expect(artifactBytes).not.toContain(JSON.stringify(secret).slice(1, -1));

    const errorResult = await new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runs),
      inferCandidates: async () => {
        throw new Error(`Provider leaked ${secret}`);
      },
    }).run({ ...input('redaction-error'), credentialBytes: [secret] });
    expect(errorResult.status).toBe('failed');
    expect(errorResult.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_REDACTION_FAILED }),
    );
    const errorBytes = await persistedBytes(runs, 'redaction-error');
    expect(errorBytes).not.toContain(secret);
    expect(errorBytes).not.toContain(JSON.stringify(secret).slice(1, -1));
  }, 60_000);

  it('finishes partially with observed empty coverage when inference yields zero candidates', async () => {
    const checkpointer = new InMemoryStageCheckpointer();
    const result = await new LangGraphOrchestrator({
      checkpointer,
      inferCandidates: async () => ({ requestId: 'empty-request', candidates: [] }),
    }).run(input('empty'));

    expect(result.status).toBe('partial');
    expect(result.outcome).toBe('observed');
    expect(result.completedStages).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_EMPTY_COVERAGE, severity: 'observed' }),
    );
    expect(await stageArtifact(checkpointer, result, 'empty', 9)).toEqual({
      compiled: false,
      plan: 'No workflow candidate was available to compile',
      oracleOutcome: 'observed',
    });
    expect(result.receipt).toBeUndefined();
  }, 60_000);

  it('classifies a full-compiler evidence rejection as blocked without throwing', async () => {
    const checkpointer = new InMemoryStageCheckpointer();
    const result = await new LangGraphOrchestrator({
      checkpointer,
      inferCandidates: async () => validInference('missing-compile-evidence'),
      explore: async () => ({ approved: true, evidenceRefs: [], decisions: [] }),
    }).run(input('missing-compile-evidence'));
    const compilation = await stageArtifact<{
      compiled: boolean;
      plan: string;
      diagnostics?: readonly { code: string; severity: string }[];
    }>(checkpointer, result, 'missing-compile-evidence', 9);

    expect(compilation).toMatchObject({
      compiled: false,
      plan: `Compilation blocked (${ARXIC_COMPILE_EVIDENCE_MISSING})`,
      diagnostics: [{ code: ARXIC_COMPILE_EVIDENCE_MISSING, severity: 'blocked' }],
    });
    expect(result.status).toBe('partial');
    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_COMPILE_EVIDENCE_MISSING,
        severity: 'blocked',
      }),
    );
    expect(result.completedStages).toContain(12);
    expect(result.receipt).toBeUndefined();
  }, 60_000);

  it('preserves a terminal partial run across re-invocation', async () => {
    const checkpointer = new InMemoryStageCheckpointer();
    const orchestrator = new LangGraphOrchestrator({
      checkpointer,
      inferCandidates: async () => ({ requestId: 'terminal-partial', candidates: [] }),
    });
    expect((await orchestrator.run(input('terminal-partial'))).status).toBe('partial');

    const resumed = await orchestrator.run(input('terminal-partial'));

    expect(resumed.status).toBe('partial');
    expect((await checkpointer.load('terminal-partial'))?.status).toBe('partial');
  }, 60_000);

  it('blocks terminal reuse when persisted artifact bytes no longer match the recorded hash', async () => {
    const runs = await temporaryDirectory('terminal-hash-runs-');
    const initial = await new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runs),
      inferCandidates: async () => ({ requestId: 'terminal-hash', candidates: [] }),
    }).run(input('terminal-hash'));
    await writeFile(join(runs, 'terminal-hash', 'artifacts', '12.json'), '{"tampered":true}\n');

    const reused = await new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runs),
    }).run(input('terminal-hash'));

    expect(initial.completedStages).toHaveLength(13);
    expect(reused.status).toBe('failed');
    expect(reused.outcome).toBe('blocked');
    expect(reused.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_HASH_MISMATCH, severity: 'blocked' }),
    );
  }, 60_000);

  it('promotes a verifier-confirmed staged bundle', async () => {
    const stagedBundle = coherentObservedBundle();
    const original = structuredClone(stagedBundle);
    const checkpointer = new InMemoryStageCheckpointer();
    let promotionEligible = false;
    let promotedBundle: StagedBundle | undefined;
    const result = await new LangGraphOrchestrator({
      checkpointer,
      inferCandidates: async () => validInference('positive-request'),
      compile: async () => ({ compiled: true, plan: 'compiled', stagedBundle }),
      verify: async () => ({
        outcome: 'verified',
        stagedBundle,
        diagnostics: [],
        artifacts: [{ kind: 'screenshot', path: '/safe/signed-in.png', sha256: 'e'.repeat(64) }],
        runs: [{ passed: true }, { passed: true }],
        gates: [{ gate: 'verify', passed: true }],
      }),
      promote: async (bundle) => {
        promotionEligible = true;
        promotedBundle = bundle;
        return {
          manifest: bundle.manifest,
          promotedAt: '2026-08-05T12:00:00.000Z',
          location: 'test://promoted',
          checksumSha256: 'a'.repeat(64),
        };
      },
    }).run(input('positive-promotion'));

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ARXIC-SURFACE-002', severity: 'blocked' }),
      ]),
    );
    expect(result.status).toBe('completed');
    expect((await checkpointer.load('positive-promotion'))?.status).toBe('completed');
    expect(result.receipt).toBeDefined();
    expect(promotionEligible).toBe(true);
    expect(result.checkpoints.find(({ stage }) => stage === 10)?.gateResults).toEqual([
      { gate: 'verify', passed: true },
    ]);
    expect(promotedBundle?.workflow.status).toBe('verified');
    expect(promotedBundle?.manifest.workflow).toEqual({
      id: promotedBundle?.workflow.id,
      status: 'verified',
    });
    expect(promotedBundle?.manifest.fileHashes).toEqual(
      promotedBundle?.artifacts.map(({ path, sha256 }) => ({ path, sha256 })),
    );
    expect(stagedBundle).toEqual(original);
  }, 60_000);

  it('promotes when source and discovery blockers describe deliberately unattempted advisory work', async () => {
    const stagedBundle = coherentObservedBundle();
    let promoted = false;
    const result = await new LangGraphOrchestrator({
      checkpointer: new InMemoryStageCheckpointer(),
      inferCandidates: async () => validInference('advisory-promotion-request'),
      compile: async () => ({ compiled: true, plan: 'compiled', stagedBundle }),
      verify: async () => ({
        outcome: 'verified',
        stagedBundle,
        diagnostics: [],
        artifacts: [],
        runs: [{ passed: true }, { passed: true }],
        gates: [{ gate: 'verify', passed: true }],
      }),
      promote: async (bundle) => {
        promoted = true;
        return {
          manifest: bundle.manifest,
          promotedAt: '2026-08-05T12:00:00.000Z',
          location: 'test://advisory-promoted',
          checksumSha256: 'a'.repeat(64),
        };
      },
    }).run(input('advisory-promotion'));

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ARXIC-SOURCE-UNSUPPORTED-LANGUAGE',
          severity: 'blocked',
        }),
        expect.objectContaining({ code: 'ARXIC-SURFACE-002', severity: 'blocked' }),
      ]),
    );
    expect(result.outcome).toBe('verified');
    expect(result.status).toBe('completed');
    expect(result.receipt).toBeDefined();
    expect(promoted).toBe(true);
  }, 60_000);

  it('retains promotion eligibility when every sensitivity mutation is killed', async () => {
    const stagedBundle = coherentObservedBundle();
    let promoted = false;
    const result = await new LangGraphOrchestrator({
      checkpointer: new InMemoryStageCheckpointer(),
      inferCandidates: async () => validInference('sensitive-probe-request'),
      compile: async () => ({ compiled: true, plan: 'compiled', stagedBundle }),
      verify: async () => ({
        outcome: 'verified',
        stagedBundle,
        diagnostics: [],
        artifacts: [{ kind: 'screenshot', path: '/safe/signed-in.png', sha256: 'e'.repeat(64) }],
        runs: [{ passed: true }, { passed: true }],
        gates: [{ gate: 'verify', passed: true }],
      }),
      probeSensitivity: async () => ({
        killed: true,
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
        diagnostics: [],
      }),
      promote: async (bundle) => {
        promoted = true;
        return {
          manifest: bundle.manifest,
          promotedAt: '2026-08-05T12:00:00.000Z',
          location: 'test://sensitivity-promoted',
          checksumSha256: 'a'.repeat(64),
        };
      },
    }).run(input('sensitive-probe'));

    expect(result.checkpoints.find(({ stage }) => stage === 10)?.gateResults).toContainEqual({
      gate: 'sensitivity',
      passed: true,
    });
    expect(result.checkpoints.find(({ stage }) => stage === 10)?.artifacts).toHaveLength(1);
    expect(result.outcome).toBe('verified');
    expect(result.promotionEligible).toBe(true);
    expect(result.receipt).toBeDefined();
    expect(promoted).toBe(true);
  }, 60_000);

  it('keeps verified truth state but blocks promotion when the sensitivity probe is insensitive', async () => {
    const stagedBundle = coherentObservedBundle();
    const checkpointer = new InMemoryStageCheckpointer();
    let promoted = false;
    const probeDiagnostic = {
      code: 'ARXIC-PROBE-INSENSITIVE-ASSERTION',
      severity: 'blocked' as const,
      subject: stagedBundle.workflow.id,
      message: 'The mutated assertion still passed',
    };
    const result = await new LangGraphOrchestrator({
      checkpointer,
      inferCandidates: async () => validInference('insensitive-probe-request'),
      compile: async () => ({ compiled: true, plan: 'compiled', stagedBundle }),
      verify: async () => ({
        outcome: 'verified',
        stagedBundle,
        diagnostics: [],
        artifacts: [{ kind: 'screenshot', path: '/safe/signed-in.png', sha256: 'e'.repeat(64) }],
        runs: [{ passed: true }, { passed: true }],
        gates: [{ gate: 'verify', passed: true }],
      }),
      probeSensitivity: async (probeInput) => {
        expect(probeInput).toEqual({
          workflow: stagedBundle.workflow,
          origin,
          runtimeUrl: origin,
        });
        return {
          killed: false,
          probed: 2,
          controlPassed: true,
          assertions: [
            {
              transitionIndex: 0,
              assertionIndex: 0,
              operators: [
                { kind: 'value-substitution', killed: false, controlPassed: true },
                { kind: 'control-state-omission', killed: true, controlPassed: true },
              ],
              killed: false,
            },
          ],
          diagnostics: [probeDiagnostic],
        };
      },
      promote: async () => {
        promoted = true;
        throw new Error('An insensitive assertion must suppress promotion');
      },
    }).run(input('insensitive-probe'));

    const verifyCheckpoint = result.checkpoints.find(({ stage }) => stage === 10)!;
    const verification = (await checkpointer.readArtifact(
      result.runId,
      verifyCheckpoint.artifacts[0]!,
    )) as VerificationNodeResult;
    expect(verification.outcome).toBe('verified');
    expect(verification.diagnostics).toContainEqual(probeDiagnostic);
    expect(verification.gates).toContainEqual({ gate: 'sensitivity', passed: false });
    expect(verification.sensitivityProbe).toEqual({
      probed: 2,
      controlPassed: true,
      assertions: [
        {
          transitionIndex: 0,
          assertionIndex: 0,
          operators: [
            { kind: 'value-substitution', killed: false, controlPassed: true },
            { kind: 'control-state-omission', killed: true, controlPassed: true },
          ],
          killed: false,
        },
      ],
    });
    expect(result.outcome).toBe('verified');
    expect(result.promotionEligible).toBe(false);
    expect(result.receipt).toBeUndefined();
    expect(promoted).toBe(false);
  }, 60_000);

  it('keeps verifier truth and evidence when the sensitivity probe harness throws', async () => {
    const stagedBundle = coherentObservedBundle();
    const checkpointer = new InMemoryStageCheckpointer();
    const result = await new LangGraphOrchestrator({
      checkpointer,
      inferCandidates: async () => validInference('throwing-probe-request'),
      compile: async () => ({ compiled: true, plan: 'compiled', stagedBundle }),
      verify: async () => ({
        outcome: 'verified',
        stagedBundle,
        diagnostics: [],
        artifacts: [{ kind: 'screenshot', path: '/safe/signed-in.png', sha256: 'e'.repeat(64) }],
        runs: [{ passed: true }, { passed: true }],
        gates: [{ gate: 'verify', passed: true }],
      }),
      probeSensitivity: async () => {
        throw new Error('probe process timed out');
      },
    }).run(input('throwing-probe'));

    const verifyCheckpoint = result.checkpoints.find(({ stage }) => stage === 10)!;
    const verification = (await checkpointer.readArtifact(
      result.runId,
      verifyCheckpoint.artifacts[0]!,
    )) as VerificationNodeResult;
    expect(verification.outcome).toBe('verified');
    expect(verification.artifacts).toEqual([
      { kind: 'screenshot', path: '/safe/signed-in.png', sha256: 'e'.repeat(64) },
    ]);
    expect(verification.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'ARXIC-PROBE-HARNESS-UNUSABLE',
        severity: 'blocked',
        message: expect.stringContaining('probe process timed out'),
      }),
    );
    expect(verification.gates).toContainEqual({ gate: 'sensitivity', passed: false });
    expect(verification.sensitivityProbe).toEqual({
      probed: 0,
      controlPassed: false,
      assertions: [],
    });
    expect(result.outcome).toBe('verified');
    expect(result.promotionEligible).toBe(false);
  }, 60_000);

  it('blocks a forged verified result with incomplete deterministic evidence', async () => {
    const stagedBundle = coherentObservedBundle();
    let promoted = false;
    const result = await new LangGraphOrchestrator({
      checkpointer: new InMemoryStageCheckpointer(),
      inferCandidates: async () => validInference('forged-verified-request'),
      compile: async () => ({ compiled: true, plan: 'compiled', stagedBundle }),
      verify: async () => ({
        outcome: 'verified',
        stagedBundle,
        diagnostics: [],
        artifacts: [],
        runs: [{ passed: false }],
        gates: [{ gate: 'verify', passed: true }],
      }),
      promote: async () => {
        promoted = true;
        throw new Error('Forged verified output must not promote');
      },
    }).run(input('forged-verified'));

    expect(result.outcome).toBe('blocked');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'ARXIC-ORCH-STAGE-BLOCKED', severity: 'blocked' }),
    );
    expect(result.receipt).toBeUndefined();
    expect(promoted).toBe(false);
  }, 60_000);

  it.each([
    { name: 'missing', gates: [] },
    { name: 'failed', gates: [{ gate: 'verify', passed: false }] },
  ])(
    'blocks all-pass verifier output when its verify gate is $name',
    async ({ gates }) => {
      const stagedBundle = coherentObservedBundle();
      let promoted = false;
      const result = await new LangGraphOrchestrator({
        checkpointer: new InMemoryStageCheckpointer(),
        inferCandidates: async () => validInference('failed-verify-gate-request'),
        compile: async () => ({ compiled: true, plan: 'compiled', stagedBundle }),
        verify: async () => ({
          outcome: 'verified',
          stagedBundle,
          diagnostics: [],
          artifacts: [],
          runs: [{ passed: true }, { passed: true }],
          gates,
        }),
        promote: async () => {
          promoted = true;
          throw new Error('A failed verifier gate must block before promotion');
        },
      }).run(input(`invalid-verify-gate-${gates.length}`));

      expect(result.outcome).toBe('blocked');
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'ARXIC-ORCH-STAGE-BLOCKED', severity: 'blocked' }),
      );
      expect(promoted).toBe(false);
    },
    60_000,
  );

  it('completes a usable soft-blocked stage but suppresses promotion', async () => {
    const stagedBundle = coherentObservedBundle();
    let promoted = false;
    const result = await new LangGraphOrchestrator({
      checkpointer: new InMemoryStageCheckpointer(),
      inferCandidates: async () => validInference('soft-block-request'),
      explore: async () => ({ approved: false, evidenceRefs: [], decisions: ['soft block'] }),
      compile: async () => ({ compiled: true, plan: 'compiled', stagedBundle }),
      verify: async () => ({
        outcome: 'verified',
        stagedBundle,
        diagnostics: [],
        artifacts: [],
        runs: [{ passed: true }, { passed: true }],
        gates: [{ gate: 'verify', passed: true }],
      }),
      promote: async () => {
        promoted = true;
        throw new Error('Promotion must remain suppressed');
      },
    }).run(input('soft-block'));

    expect(result.completedStages).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(result.checkpoints.find(({ stage }) => stage === 8)?.status).toBe('completed');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'blocked', subject: 'stage-8' }),
    );
    expect(result.outcome).toBe('blocked');
    expect(result.status).toBe('partial');
    expect(result.promotionEligible).toBe(false);
    expect(result.receipt).toBeUndefined();
    expect(promoted).toBe(false);
  }, 60_000);

  it('allows a resumed verified run to promote with an observed resume diagnostic', async () => {
    const runs = await temporaryDirectory('resume-promote-runs-');
    const stagedBundle = coherentObservedBundle();
    await expect(
      new LangGraphOrchestrator({
        checkpointer: new FileStageCheckpointer(runs),
        inferCandidates: async () => {
          throw new WorkerRestartError();
        },
      }).run(input('resume-promote')),
    ).rejects.toBeInstanceOf(WorkerRestartError);

    const result = await new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runs),
      inferCandidates: async () => validInference('resume-promote-request'),
      compile: async () => ({ compiled: true, plan: 'compiled', stagedBundle }),
      verify: async () => ({
        outcome: 'verified',
        stagedBundle,
        diagnostics: [],
        artifacts: [],
        runs: [{ passed: true }, { passed: true }],
        gates: [{ gate: 'verify', passed: true }],
      }),
      promote: async () => ({
        manifest: {} as never,
        promotedAt: '2026-08-05T12:00:00.000Z',
        location: 'test://resumed-promotion',
        checksumSha256: 'b'.repeat(64),
      }),
    }).run(input('resume-promote'));

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_RESUME, severity: 'observed' }),
    );
    expect(result.diagnostics.filter(({ severity }) => severity === 'blocked')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ARXIC-SOURCE-UNSUPPORTED-LANGUAGE' }),
        expect.objectContaining({ code: 'ARXIC-SURFACE-002' }),
      ]),
    );
    expect(result.receipt).toBeDefined();
  }, 60_000);

  it('fails closed when a checkpointer returns a mismatched outbound artifact hash', async () => {
    const result = await new LangGraphOrchestrator({
      checkpointer: new HashMismatchCheckpointer(4),
      inferCandidates: async () => ({ requestId: 'hash-request', candidates: [] }),
    }).run(input('hash-mismatch'));

    expect(result.status).toBe('failed');
    expect(result.outcome).toBe('blocked');
    expect(result.completedStages).toEqual([0, 1, 2, 3]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_HASH_MISMATCH, severity: 'blocked' }),
    );
  }, 30_000);

  it('fails closed when a persisted inbound artifact is tampered before resume', async () => {
    const runs = await temporaryDirectory('inbound-hash-runs-');
    await expect(
      new LangGraphOrchestrator({
        checkpointer: new FileStageCheckpointer(runs),
        inferCandidates: async () => {
          throw new WorkerRestartError();
        },
      }).run(input('inbound-hash')),
    ).rejects.toBeInstanceOf(WorkerRestartError);
    await writeFile(join(runs, 'inbound-hash', 'artifacts', '03.json'), '{"tampered":true}\n');

    const result = await new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runs),
      inferCandidates: async () => validInference('never-used'),
    }).run(input('inbound-hash'));

    expect(result.status).toBe('failed');
    expect(result.completedStages).toEqual([0, 1, 2, 3]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_ORCH_HASH_MISMATCH, severity: 'blocked' }),
    );
  }, 60_000);

  it.each(['observed', 'contradicted'] as const)(
    'normalizes model-supplied %s workflow status to hypothesized',
    async (status) => {
      let downstreamStatus = '';
      await new LangGraphOrchestrator({
        checkpointer: new InMemoryStageCheckpointer(),
        inferCandidates: async () => validInference(`truth-${status}`, status),
        reconcile: async ({ candidates }) => {
          downstreamStatus = candidates[0]?.workflow?.status ?? '';
          return { denominator: candidates.length, rows: [] };
        },
      }).run(input(`truth-${status}`));

      expect(downstreamStatus).toBe('hypothesized');
    },
    60_000,
  );

  it('pauses at stage 8 for approval and resumes through the remaining stages', async () => {
    const checkpointer = new InMemoryStageCheckpointer();
    const orchestrator = new LangGraphOrchestrator({
      checkpointer,
      inferCandidates: async () => ({ requestId: 'approval-request', candidates: [] }),
    });
    const waiting = await orchestrator.run({
      ...input('approval'),
      requireExplorationApproval: true,
    });

    expect(waiting.status).toBe('awaiting-approval');
    expect(waiting.completedStages).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(waiting.checkpoints.at(-1)).toMatchObject({ stage: 8, status: 'awaiting-approval' });

    const completed = await orchestrator.run(
      { ...input('approval'), requireExplorationApproval: true },
      {
        approver: 'human@example.test',
        approvedAt: '2026-08-05T12:00:00.000Z',
        reason: 'Approved local fixture exploration',
      },
    );
    expect(completed.status).toBe('partial');
    expect(completed.completedStages).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(completed.checkpoints.filter(({ stage }) => stage === 8)).toEqual([
      expect.objectContaining({ status: 'awaiting-approval' }),
      expect.objectContaining({
        status: 'completed',
        approvals: [expect.stringContaining('human@example.test')],
      }),
    ]);
  }, 60_000);
});

class HashMismatchCheckpointer implements StageCheckpointer {
  readonly #delegate = new InMemoryStageCheckpointer();
  readonly #stage: StageId;

  constructor(stage: StageId) {
    this.#stage = stage;
  }

  load(runId: string): Promise<RunState | undefined> {
    return this.#delegate.load(runId);
  }

  async saveArtifact(
    runId: string,
    stage: StageId,
    value: StageArtifact,
  ): Promise<ImmutableArtifactRef> {
    const ref = await this.#delegate.saveArtifact(runId, stage, value);
    return stage === this.#stage ? { ...ref, sha256: '0'.repeat(64) } : ref;
  }

  readArtifact(runId: string, ref: ImmutableArtifactRef): Promise<StageArtifact> {
    return this.#delegate.readArtifact(runId, ref);
  }

  verifyArtifact(runId: string, ref: ImmutableArtifactRef): Promise<boolean> {
    return this.#delegate.verifyArtifact(runId, ref);
  }

  saveCheckpoint(runId: string, checkpoint: StageCheckpoint, state: RunState): Promise<void> {
    return this.#delegate.saveCheckpoint(runId, checkpoint, state);
  }
}

function input(runId: string) {
  return {
    runId,
    origin,
    revision: { repository: pathToFileURL(repository).href, commit, dirty: false },
    rulepacksDir: resolve(root, 'rulepacks'),
    artifactsDir: artifactsDirectory,
    framework: 'nextjs',
    features: ['login'],
    maxUrls: 4,
    maxDepth: 1,
    appBuildDigest: 'a'.repeat(64),
    expectedNonce: 'orchestrator-test',
    modelPrompt: 'private prompt bytes that must never persist',
    credentialBytes: ['credential-value'],
  } as const;
}

function validInference(
  requestId: string,
  status: 'hypothesized' | 'observed' | 'contradicted' = 'hypothesized',
) {
  const evidenceId = 'src:test-candidate';
  return {
    requestId,
    candidates: [
      {
        id: 'authentication.test-candidate',
        title: 'Test candidate',
        evidenceRefs: [evidenceId],
        workflow: {
          $schema: 'https://arxic.dev/schemas/workflow/v1.json',
          id: 'authentication.test-candidate',
          version: 1,
          title: 'Test candidate',
          domain: 'authentication',
          persona: 'registered-user',
          status,
          confidence: 0.5,
          scope: { commit, environment: 'local-test', browser: 'chromium' },
          preconditions: [],
          states: [{ id: 'signed-out' }, { id: 'signed-in' }],
          transitions: [
            {
              from: 'signed-out',
              to: 'signed-in',
              action: { intent: 'submit login form' },
              assertions: [{ intent: 'authenticated state is visible' }],
              evidenceRefs: [evidenceId],
            },
          ],
          negativeCases: [],
          verification: {
            requiredRuns: 2,
            screenshotCheckpoints: ['signed-in'],
            forbidNetworkErrors: true,
            trace: 'retain',
          },
          evidenceRefs: [evidenceId],
        },
      },
    ],
  } as const;
}

function coherentObservedBundle(): StagedBundle {
  const workflow = structuredClone(
    validInference('bundle').candidates[0]!.workflow,
  ) as unknown as Workflow;
  const runtimeId = 'run:deterministic-verifier';
  workflow.evidenceRefs = [...workflow.evidenceRefs, runtimeId];
  workflow.transitions = workflow.transitions.map((transition) => ({
    ...transition,
    evidenceRefs: [...transition.evidenceRefs, runtimeId],
  }));
  const artifact = {
    kind: 'playwright-spec',
    path: 'tests/workflow.spec.ts',
    sha256: 'd'.repeat(64),
  };
  return {
    workflow,
    evidenceIndex: {
      'src:test-candidate': {
        kind: 'source',
        repo: pathToFileURL(repository).href,
        commit,
        path: 'page.tsx',
        startLine: 1,
        endLine: 1,
        blobSha256: 'b'.repeat(64),
        extractor: 'orchestrator-test',
      },
      [runtimeId]: {
        kind: 'runtime',
        runId: 'deterministic-verifier',
        appBuildDigest: 'a'.repeat(64),
        browser: 'chromium',
        browserVersion: '140.0.0',
        url: origin,
        timestamp: '2026-08-05T12:00:00.000Z',
      },
    },
    artifacts: [artifact],
    plan: 'Replay the observed workflow.',
    manifest: {
      schemaVersion: 1,
      bundleVersion: 1,
      workflow: { id: workflow.id, status: workflow.status },
      repository: pathToFileURL(repository).href,
      commit,
      appBuildDigest: 'a'.repeat(64),
      environment: { class: 'local-test', browser: 'chromium' },
      generator: { id: '@arxic/playwright-compiler', version: '0.0.0' },
      verification: {
        requiredRuns: 2,
        runs: [
          {
            startedAt: '2026-08-05T12:00:00.000Z',
            finishedAt: '2026-08-05T12:00:00.000Z',
            passed: false,
          },
        ],
      },
      fileHashes: [{ path: artifact.path, sha256: artifact.sha256 }],
      gateResults: [{ gate: 'compile', passed: true }],
      coverage: { denominator: 1, uncovered: 1 },
      runId: 'deterministic-verifier',
    },
  };
}

async function persistedBytes(runs: string, runId: string): Promise<string> {
  const directories = ['artifacts', 'stages'];
  const files = (
    await Promise.all(
      directories.map(async (directory) => {
        try {
          return await readdir(join(runs, runId, directory));
        } catch {
          return [];
        }
      }),
    )
  ).flatMap((names, index) => names.map((name) => join(runs, runId, directories[index], name)));
  return (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
}

async function stageArtifact<T = StageArtifact>(
  checkpointer: InMemoryStageCheckpointer,
  state: RunState,
  runId: string,
  stage: StageId,
): Promise<T> {
  const ref = state.artifacts[stage];
  if (!ref) throw new Error(`Expected stage-${stage} artifact`);
  return (await checkpointer.readArtifact(runId, ref)) as T;
}

async function committedSource(): Promise<string> {
  const directory = await temporaryDirectory('source-');
  await writeFile(
    join(directory, 'page.tsx'),
    'export default function Page() { return <form action="/login"><input name="email" /></form>; }\n',
  );
  await writeFile(join(directory, 'styles.css'), 'body {}\n');
  const environment = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Arxic Test',
    GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
    GIT_COMMITTER_NAME: 'Arxic Test',
    GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
  };
  await execute('git', ['init', '--initial-branch=main'], { cwd: directory, env: environment });
  await execute('git', ['add', '.'], { cwd: directory, env: environment });
  await execute('git', ['commit', '-m', 'fixture'], { cwd: directory, env: environment });
  commit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim();
  return directory;
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `arxic-orchestrator-${prefix}`));
  temporaryDirectories.push(directory);
  return directory;
}
