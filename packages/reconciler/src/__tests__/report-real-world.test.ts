import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AuthDomainPackAssembler, authCandidates } from '@arxic/auth-domain-pack';
import type { EvidenceRef } from '@arxic/contracts';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  compileCoverageReport,
  serializeCoverageReport,
  type CoverageRow,
  type ReconciliationResult,
} from '..';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const appDir = resolve(root, 'test-fixtures/reference-auth-app');
let app: ChildProcess | undefined;
let origin = '';
let runtimeDirectory = '';
let outputDirectory = '';
let artifactsDirectory = '';

describe('real coverage and blocker report proof', () => {
  beforeAll(async () => {
    await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
      cwd: root,
      timeout: 180_000,
    });
    runtimeDirectory = await mkdtemp(join(tmpdir(), 'arxic-report-runtime-'));
    outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-report-output-'));
    artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-report-artifacts-'));
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    app = spawn(
      process.execPath,
      [resolve(appDir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)],
      {
        cwd: appDir,
        env: {
          ...process.env,
          ARXIC_DB_PATH: join(runtimeDirectory, 'auth.db'),
          ARXIC_TARGET_ORIGIN: origin,
        },
        stdio: 'ignore',
        shell: false,
      },
    );
    await readiness(origin, app);
  }, 240_000);

  afterAll(async () => {
    await stop(app);
    await Promise.all(
      [runtimeDirectory, outputDirectory, artifactsDirectory]
        .filter(Boolean)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test('combines real Chromium verification outcomes with actionable blockers', async () => {
    const candidates = authCandidates();
    const persona = {
      email: 'coverage-report-proof@example.test',
      password: 'CoverageReportProof9!',
      newPassword: 'CoverageReportReplacement9!',
    };
    const seeded = await fetch(`${origin}/__arxic/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId: 'coverage-report-proof', ...persona }),
    });
    expect(seeded.status).toBe(201);
    const pack = await new AuthDomainPackAssembler({
      origin,
      outputDirectory,
      artifactsDir: artifactsDirectory,
      persona,
    }).assemble(candidates, observations());
    const reconciliation = reconciliationResult(candidates);
    const report = compileCoverageReport(
      reconciliation,
      pack.workflows.map(({ id, outcome, diagnostics }) => ({
        candidateId: id,
        outcome,
        diagnostics,
      })),
      { now: () => '2026-08-06T00:00:00.000Z' },
    );

    expect(report.verified).toBe(3);
    expect(report.blocked).toBe(3);
    expect(report.accountabilityVerifiedGap).toBeGreaterThan(0);
    expect(
      report.rows.filter(({ verificationOutcome }) => verificationOutcome === 'blocked'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: 'authentication.reset-request',
          supportedFixes: expect.arrayContaining(['Configure a Mailpit SMTP sink']),
        }),
        expect.objectContaining({
          candidateId: 'authentication.reset-complete',
          supportedFixes: expect.arrayContaining(['Configure a Mailpit SMTP sink']),
        }),
        expect.objectContaining({
          candidateId: 'authentication.totp',
          supportedFixes: expect.arrayContaining(['Provision an OtpAdapter fixture']),
        }),
      ]),
    );
    expect(JSON.parse(serializeCoverageReport(report))).toMatchObject({
      schemaVersion: 1,
      denominator: 6,
      verified: 3,
      blocked: 3,
    });
  }, 300_000);
});

function reconciliationResult(candidates: ReturnType<typeof authCandidates>): ReconciliationResult {
  const rows: CoverageRow[] = candidates.map(({ workflow }) => ({
    candidateId: workflow.id,
    staticEvidence: workflow.evidenceRefs.filter((ref) => ref.startsWith('src:')).length,
    runtimeEvidence: workflow.evidenceRefs.filter((ref) => ref.startsWith('run:')).length,
    outcome: 'observed',
    kind: 'candidate',
    staticStatus: 'asserted',
    runtimeReachability: 'observed',
    verificationStatus: 'observed',
    accountability: 0.8,
    diagnostics: [],
  }));
  return {
    denominator: candidates.length,
    rows,
    orderedCandidates: candidates.map(({ workflow }) => ({
      id: workflow.id,
      title: workflow.title,
      evidenceRefs: workflow.evidenceRefs,
      workflow,
    })),
    diagnostics: [],
    summary: {
      candidateAccountability: 0.8,
      verifiedTransitionCoverage: 0,
      sourceEvidenceOverlap: 1,
      runtimeEvidenceOverlap: 1,
      uncovered: candidates.length,
      blocked: 0,
      contradicted: 0,
    },
  };
}

function observations(): EvidenceRef[] {
  return [
    {
      kind: 'source',
      repo: 'https://github.com/anthonykewl20/arxic',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'test-fixtures/reference-auth-app/app/login/page.tsx',
      startLine: 1,
      endLine: 23,
      blobSha256: 'a'.repeat(64),
      extractor: 'real-world-coverage-report-test',
    },
    {
      kind: 'runtime',
      runId: 'run-real-world-coverage-report',
      appBuildDigest: 'b'.repeat(64),
      browser: 'chromium',
      browserVersion: '1.62.1',
      url: `${origin}/login`,
      timestamp: new Date().toISOString(),
    },
  ];
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate report port');
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}

async function readiness(url: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Reference app exited with ${child.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      continue;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('Reference app readiness timed out');
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
