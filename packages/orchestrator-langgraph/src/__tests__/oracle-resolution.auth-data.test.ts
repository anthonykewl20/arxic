// Live two-app browser proof is slice F; this runs the full graph, including stage-5 Crawlee/Chromium against a stub origin, with real @arxic/intent and auth-domain-pack data.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { PACKAGE_NAME as AUTH_DOMAIN_PACK, authCandidates } from '@arxic/auth-domain-pack';
import type { EvidenceRef } from '@arxic/contracts';
import {
  INTENT_SCHEMA_VERSION,
  canonicalJson,
  canonicalizeIntentSpec,
  normalizeIntentSpec,
  type IntentSpecInput,
  type OracleSpec,
} from '@arxic/intent';
import { loginObservations, referenceAuthApp } from '@arxic/real-world-testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InMemoryStageCheckpointer,
  LangGraphOrchestrator,
  type Candidate,
  type CompilationResult,
  type OracleResolution,
  type OracleResolutionInput,
  type OracleRule,
} from '..';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
let commit = '';
// The oracle identity includes the auth-domain-pack release version. Re-pinned
// for the owner's 0.1.0 release target (refs #398); comparison remains exact.
const pinnedCanonicalSha256 = '76b5675e02ccc52626efc8d001343377028aa1ca18727a5bfe2c537b73e91de2';
const { version: authDomainPackVersion } = JSON.parse(
  readFileSync(resolve(root, 'packages/auth-domain-pack/package.json'), 'utf8'),
) as { version: string };
const directories: string[] = [];
let server: Server;
let origin = '';
let repository = '';
let artifactsDir = '';

describe('real stage-9 oracle resolution data', () => {
  beforeAll(async () => {
    repository = await committedSource();
    artifactsDir = await temporaryDirectory('artifacts-');
    server = createServer((request, response) => {
      response.setHeader(
        'content-type',
        request.url?.includes('.json') ? 'application/json' : 'text/html',
      );
      if (request.url === '/.well-known/arxic-test-target.json') {
        response.end(
          JSON.stringify({
            environmentClass: 'local-test',
            origin,
            allowedOrigins: [origin],
            buildDigest: 'b'.repeat(64),
            nonce: 'oracle-real-world',
          }),
        );
        return;
      }
      response.end('<!doctype html><title>Reference login data</title>');
    });
    await new Promise<void>((listen) => server.listen(0, '127.0.0.1', listen));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    origin = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((close) => server.close(() => close()));
    await Promise.all(
      directories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('persists the auth pack login rule as a stable acceptance assertion', async () => {
    const oracle = domainRule();
    const artifact = await runAndRead('real-domain-rule', oracle);

    expect(artifact.oracleOutcome).toBe('observed');
    expect(artifact.intentSpec?.assertions[0]).toMatchObject({
      kind: 'acceptance',
      expectedValue: 'url:/',
    });
    expect(canonicalizeIntentSpec(artifact.intentSpec!).canonicalSha256).toBe(
      pinnedCanonicalSha256,
    );
  }, 60_000);

  it('keeps the real login observation as characterization with observed-only provenance', async () => {
    const artifact = await runAndRead('real-observed-only', { kind: 'observed-only' });

    expect(artifact.intentSpec?.assertions[0]).toMatchObject({
      kind: 'characterization',
      expectedValue: 'url:/',
    });
  }, 60_000);
});

async function runAndRead(runId: string, oracle: OracleSpec): Promise<CompilationResult> {
  const checkpointer = new InMemoryStageCheckpointer();
  const candidate = loginCandidate();
  const evidence = realObservations(runId);
  const oracleRules: readonly OracleRule[] = [{ candidateId: candidate.id, oracle }];
  const result = await new LangGraphOrchestrator({
    checkpointer,
    inferCandidates: async () => ({ requestId: runId, candidates: [candidate] }),
    reconcile: async () => ({ denominator: 1, rows: [] }),
    prepareFixtures: async () => ({
      provisioned: true,
      requirements: [],
      leases: [],
      diagnostics: [],
    }),
    explore: async () => ({ approved: true, evidenceRefs: evidence, decisions: [] }),
    resolveOracle: realResolver,
    compile: async () => ({ compiled: true, plan: 'compiled raw auth workflow' }),
  }).run({
    runId,
    origin,
    revision: { repository: pathToFileURL(repository).href, commit, dirty: false },
    rulepacksDir: resolve(root, 'rulepacks'),
    artifactsDir,
    framework: 'nextjs',
    features: ['login'],
    maxUrls: 1,
    maxDepth: 0,
    appBuildDigest: 'b'.repeat(64),
    expectedNonce: 'oracle-real-world',
    oracleRules,
  });
  const ref = result.artifacts[9];
  if (!ref) throw new Error('Expected stage-9 artifact');
  return (await checkpointer.readArtifact(runId, ref)) as CompilationResult;
}

async function realResolver(input: OracleResolutionInput): Promise<OracleResolution> {
  const candidate = input.candidates[0];
  const workflow = candidate?.workflow;
  const transition = workflow?.transitions[0];
  const assertion = transition?.assertions[0];
  if (!candidate || !workflow || !transition || !assertion) {
    throw new Error('Expected real login candidate');
  }
  if (!input.observations.some(({ kind }) => kind === 'source')) {
    throw new Error('Expected real source observation');
  }
  if (!input.observations.some(({ kind }) => kind === 'runtime')) {
    throw new Error('Expected real runtime observation');
  }
  const evidenceRefs = {
    source: candidate.evidenceRefs.filter((ref) => ref.startsWith('src:')),
    runtime: candidate.evidenceRefs.filter((ref) => ref.startsWith('run:')),
  };
  const specInput: IntentSpecInput = {
    schemaVersion: INTENT_SCHEMA_VERSION,
    id: 'reference-auth-login',
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
    assertions: [
      {
        id: 'login-success',
        intent: assertion.intent,
        expectedValue: referenceAuthApp.authSurface.login.assertion,
        oracles: input.oracleRules.map(({ oracle }) => oracle),
        evidenceRefs,
      },
    ],
    evidenceRefs,
  };
  const normalized = normalizeIntentSpec(specInput);
  if (!normalized.ok) {
    return { resolved: [], diagnostics: normalized.diagnostics, outcome: 'blocked' };
  }
  canonicalizeIntentSpec(normalized.spec);
  return {
    intentSpec: normalized.spec,
    resolved: normalized.spec.assertions,
    diagnostics: [],
    outcome: 'observed',
  };
}

function loginCandidate(): Candidate {
  const found = authCandidates(referenceAuthApp.authSurface, commit).find(
    ({ workflow }) => workflow.id === 'authentication.login',
  );
  if (!found) throw new Error('Expected auth-domain-pack login candidate');
  return {
    id: found.workflow.id,
    title: found.workflow.title,
    evidenceRefs: found.workflow.evidenceRefs,
    workflow: found.workflow,
  };
}

function realObservations(runId: string): EvidenceRef[] {
  return loginObservations(referenceAuthApp, origin, runId).map((ref) =>
    ref.kind === 'runtime'
      ? { ...ref, accessibilitySnapshotSha256: 'c'.repeat(64), url: `${origin}/` }
      : ref,
  );
}

function domainRule(): OracleSpec {
  const identity = {
    domainPackId: AUTH_DOMAIN_PACK,
    ruleId: 'authentication.login',
    ruleVersion: authDomainPackVersion,
  };
  return {
    kind: 'domain-rule',
    ...identity,
    digest: createHash('sha256').update(canonicalJson(identity)).digest('hex'),
  };
}

async function committedSource(): Promise<string> {
  const directory = await temporaryDirectory('source-');
  await writeFile(join(directory, 'page.tsx'), 'export default function Page() { return null; }\n');
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Arxic Test',
    GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
    GIT_COMMITTER_NAME: 'Arxic Test',
    GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
    GIT_AUTHOR_DATE: '2026-08-10T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-08-10T00:00:00Z',
  };
  await execute('git', ['init', '--initial-branch=main'], { cwd: directory, env });
  await execute('git', ['add', '.'], { cwd: directory, env });
  await execute('git', ['commit', '-m', 'fixture'], { cwd: directory, env });
  commit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim();
  return directory;
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `arxic-oracle-real-${prefix}`));
  directories.push(directory);
  return directory;
}
