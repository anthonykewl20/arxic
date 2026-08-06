import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Diagnostic,
  EvidenceRef,
  StagedBundle,
  VerificationResult,
  Workflow,
} from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';
import { afterEach, describe, expect, test } from 'vitest';
import {
  ARXIC_AUTH_COMPILE_BLOCKED,
  ARXIC_AUTH_DIAGNOSTIC_CODES,
  ARXIC_AUTH_FIXTURE_UNAVAILABLE,
  ARXIC_AUTH_NO_EVIDENCE,
  AuthDomainPackAssembler,
  authCandidates,
  authDiagnostic,
} from './index';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('AuthDomainPackAssembler sad paths', () => {
  test('blocks and does not compile a candidate without source and runtime evidence', async () => {
    const candidate = authCandidates()[0]!;
    candidate.workflow.evidenceRefs = [];
    candidate.workflow.transitions.forEach((transition) => {
      transition.evidenceRefs = [];
    });
    let compiled = false;
    const assembler = await testAssembler({
      compiler: () => ({
        compile: async () => {
          compiled = true;
          return bundle(candidate.workflow);
        },
      }),
    });

    const pack = await assembler.assemble([candidate], observations());

    expect(compiled).toBe(false);
    expect(pack.workflows[0]).toMatchObject({
      outcome: 'blocked',
      diagnostics: [{ code: ARXIC_AUTH_NO_EVIDENCE }],
    });
    expect(pack.workflows[0]).not.toHaveProperty('bundle');
  });

  test('classifies an unsupported compiler step as blocked and continues', async () => {
    const candidates = authCandidates().slice(0, 2);
    const assembler = await testAssembler(
      {
        compiler: () => ({
          compile: async (workflow) => {
            if (workflow.id === candidates[0]!.workflow.id) throw new Error('unsupported step');
            return bundle(workflow);
          },
        }),
        verifier: () => ({ verify: async () => verification('verified') }),
      },
      '2026-08-06T00:00:00.000Z',
    );

    const pack = await assembler.assemble(candidates, observations());

    expect(pack.workflows.map(({ outcome }) => outcome)).toEqual(['blocked', 'verified']);
    expect(pack.workflows[0]!.diagnostics[0]!.code).toBe(ARXIC_AUTH_COMPILE_BLOCKED);
    expect(pack.manifest).toMatchObject({ workflowCount: 2, blocked: 1, verified: 1 });
  });

  test('reports verifier outcomes and fixture blockers in the coverage matrix', async () => {
    const candidates = authCandidates();
    const outcomes = new Map<string, VerificationResult['outcome']>([
      ['authentication.login', 'verified'],
      ['authentication.logout', 'contradicted'],
      ['authentication.password-change', 'verified'],
    ]);
    const assembler = await testAssembler({
      compiler: () => ({ compile: async (workflow) => bundle(workflow) }),
      verifier: () => ({
        verify: async (staged) => verification(outcomes.get(staged.workflow.id) ?? 'blocked'),
      }),
    });

    const pack = await assembler.assemble(candidates, observations());

    expect(pack.coverageMatrix.denominator).toBe(6);
    expect(pack.coverageMatrix.rows.map(({ outcome }) => outcome)).toEqual([
      'verified',
      'contradicted',
      'blocked',
      'blocked',
      'verified',
      'blocked',
    ]);
    expect(
      pack.coverageMatrix.rows.find(({ workflowId }) => workflowId === 'authentication.totp'),
    ).toMatchObject({
      outcome: 'blocked',
      staticEvidence: 4,
      runtimeEvidence: 4,
      blockerReason: expect.stringContaining('totp fixture unavailable'),
    });
    expect(
      pack.workflows.find(({ id }) => id === 'authentication.reset-complete')?.diagnostics[0]?.code,
    ).toBe(ARXIC_AUTH_FIXTURE_UNAVAILABLE);
    expect(
      pack.workflows.filter(({ bundle: staged }) => staged).map(({ outcome }) => outcome),
    ).toEqual(['verified', 'verified']);

    const resetRequest = authCandidates().find(
      ({ workflow }) => workflow.id === 'authentication.reset-request',
    );
    expect(resetRequest).toMatchObject({ fixtureBlocker: { fixture: 'inbox' } });
    expect(resetRequest?.workflow.transitions.map(({ from, to }) => `${from}->${to}`)).toEqual([
      'login-page->home',
      'home->forgot-password-page',
      'forgot-password-page->reset-request-accepted',
    ]);

    const manifest = JSON.parse(
      await readFile(join(testDirectory(assembler), 'domain-manifest.json'), 'utf8'),
    ) as unknown;
    expect(manifest).toEqual(pack.manifest);
  });
});

test('all auth diagnostic codes loop-close through the frozen validator', () => {
  for (const code of ARXIC_AUTH_DIAGNOSTIC_CODES) {
    expect(
      validateDiagnostic(authDiagnostic(code, 'authentication.test', 'Test diagnostic')).ok,
    ).toBe(true);
  }
});

const assemblerDirectories = new WeakMap<AuthDomainPackAssembler, string>();

async function testAssembler(
  dependencies: ConstructorParameters<typeof AuthDomainPackAssembler>[1],
  now = '2026-08-06T12:00:00.000Z',
): Promise<AuthDomainPackAssembler> {
  const outputDirectory = await temporaryDirectory('pack');
  const assembler = new AuthDomainPackAssembler(
    {
      origin: 'http://127.0.0.1:3000',
      outputDirectory,
      artifactsDir: await temporaryDirectory('artifacts'),
      persona: { email: 'person@example.test', password: 'Password9!' },
      now: () => now,
    },
    dependencies,
  );
  assemblerDirectories.set(assembler, outputDirectory);
  return assembler;
}

function testDirectory(assembler: AuthDomainPackAssembler): string {
  const directory = assemblerDirectories.get(assembler);
  if (!directory) throw new Error('Assembler test directory missing');
  return directory;
}

async function temporaryDirectory(name: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `arxic-auth-${name}-`));
  temporaryDirectories.push(path);
  return path;
}

function observations(): EvidenceRef[] {
  return [
    {
      kind: 'source',
      repo: 'https://github.com/anthonykewl20/arxic',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'app/login/page.tsx',
      startLine: 1,
      endLine: 2,
      blobSha256: 'a'.repeat(64),
      extractor: 'auth-domain-test',
    },
    {
      kind: 'runtime',
      runId: 'run-auth-domain-test',
      appBuildDigest: 'b'.repeat(64),
      browser: 'chromium',
      browserVersion: '1.62.1',
      url: 'http://127.0.0.1:3000/login',
      timestamp: '2026-08-06T00:00:00.000Z',
    },
  ];
}

function bundle(workflow: Workflow): StagedBundle {
  return {
    workflow,
    plan: workflow.title,
    evidenceIndex: {},
    artifacts: [],
    manifest: {
      schemaVersion: 1,
      bundleVersion: 1,
      workflow: { id: workflow.id, status: workflow.status },
      repository: 'https://github.com/anthonykewl20/arxic',
      commit: workflow.scope.commit,
      appBuildDigest: 'b'.repeat(64),
      environment: {
        class: 'local-test',
        browser: 'chromium',
        persona: 'registered-user',
      },
      generator: { id: '@arxic/playwright-compiler', version: '0.0.0' },
      verification: {
        requiredRuns: 2,
        runs: [
          {
            startedAt: '2026-08-06T00:00:00.000Z',
            finishedAt: '2026-08-06T00:00:00.000Z',
            passed: false,
          },
        ],
      },
      fileHashes: [],
      gateResults: [
        { gate: 'compile', passed: true },
        { gate: 'policy', passed: true },
      ],
      coverage: { denominator: workflow.transitions.length },
      runId: 'run-auth-domain-test',
    },
  };
}

function verification(outcome: VerificationResult['outcome']): VerificationResult {
  const diagnostics: Diagnostic[] =
    outcome === 'verified'
      ? []
      : [
          {
            code: 'ARXIC-VERIFY-TEST',
            severity: outcome === 'hypothesized' || outcome === 'observed' ? outcome : outcome,
            subject: 'authentication.test',
            message: 'Scripted verifier outcome',
          },
        ];
  return { outcome, diagnostics, artifacts: [], runs: [{ passed: outcome === 'verified' }] };
}
