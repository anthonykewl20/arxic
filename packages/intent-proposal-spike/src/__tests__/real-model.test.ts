import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ModelAdapter } from '@arxic/model-adapter';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Real-model path (feeds #255, owner-gated): when ARXIC_DG04_REAL_BASE_URL and
 * ARXIC_DG04_REAL_KEY are both present in the environment, this test executes a
 * REAL OpenAI-compatible call through the frozen ModelAdapter and records a
 * sanitized artifact when ARXIC_DG04_RECORD points at a directory. With the
 * variables absent (CI), the very same proposer path is proven to fail closed
 * on unresolvable credentials — a real sad path, never a skip.
 */

const REAL_BASE_URL = process.env.ARXIC_DG04_REAL_BASE_URL ?? '';
const REAL_KEY = process.env.ARXIC_DG04_REAL_KEY ?? '';
const REAL_MODEL = process.env.ARXIC_DG04_REAL_MODEL ?? '';
const RECORD_DIR = process.env.ARXIC_DG04_RECORD ?? '';

const rows = [
  {
    id: 'inv:route:GET:/items:00000001:12',
    surface: 'route' as const,
    method: 'GET',
    path: '/items',
    sourcePath: 'api/src/controllers/items.ts',
    domainHint: 'items',
    evidenceIds: ['src:api-src-controllers-items-ts:12-30'],
  },
  {
    id: 'inv:route:POST:/users:00000002:8',
    surface: 'route' as const,
    method: 'POST',
    path: '/users',
    sourcePath: 'api/src/controllers/users.ts',
    domainHint: 'users',
    evidenceIds: ['src:api-src-controllers-users-ts:8-25'],
  },
];

function evidenceIndex(): Record<string, import('@arxic/contracts').EvidenceRef> {
  return Object.fromEntries(
    rows.map((row, n) => [
      row.evidenceIds[0],
      {
        kind: 'source' as const,
        repo: 'file:///real-target',
        commit: 'f'.repeat(40),
        path: row.sourcePath,
        startLine: 8 + n * 4,
        endLine: 30 + n * 4,
        blobSha256: String(n + 1).repeat(64),
        extractor: 'tree-sitter-typescript@0.25.0',
        ruleId: `route:${row.method} ${row.path}`,
      },
    ]),
  );
}

describe('real-model endpoint (env-gated; fail-closed otherwise)', () => {
  it('executes a real structured-output call and records a sanitized artifact, or fails closed without credentials', async () => {
    const { IntentProposer, sanitizeArtifactJson } = await import('..');
    const inventory = {
      kind: 'arxic-domain-inventory-standin-v1' as const,
      standIn: true as const,
      rows,
      source: {
        tool: 'dg04-real-model-test',
        commit: 'f'.repeat(40),
        repository: 'file:///real-target',
      },
      diagnostics: [],
    };
    const adapter = new ModelAdapter({
      credentials: REAL_KEY,
      baseUrl: REAL_BASE_URL,
      timeoutMs: 60_000,
      canaries: REAL_KEY ? [REAL_KEY] : [],
    });
    const proposer = new IntentProposer({
      adapter,
      model: REAL_MODEL || 'unset',
      strategy: { kind: 'one-shot' },
      maxRetries: 1,
    });
    const outcome = await proposer.propose({
      inventory,
      evidenceIndex: evidenceIndex(),
      runId: 'dg04-real-model',
    });
    if (!REAL_BASE_URL || !REAL_KEY) {
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.diagnostics.some((d) => d.code === 'ARXIC-MODEL-PROVIDER-ERROR')).toBe(true);
      return;
    }
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.calls.length).toBeGreaterThanOrEqual(1);
    expect(outcome.result.calls[0]?.runRecord.tokens.prompt).toBeGreaterThan(0);
    expect(outcome.result.proposals.length).toBeGreaterThanOrEqual(1);
    if (!RECORD_DIR) return;
    const artifact = sanitizeArtifactJson(
      JSON.stringify(
        {
          kind: 'dg04-real-model-probe',
          model: REAL_MODEL,
          strategy: 'one-shot',
          outcome: JSON.parse(
            JSON.stringify(outcome.result, (key, value) =>
              key === 'boundEvidenceRefs' ? undefined : value,
            ),
          ),
        },
        null,
        2,
      ),
      [REAL_KEY],
    );
    expect(artifact.includes(REAL_KEY)).toBe(false);
    await writeFile(join(RECORD_DIR, 'real-model-probe.json'), `${artifact}\n`, {
      encoding: 'utf8',
      mode: 0o640,
    });
  });

  it('sanitizeArtifactJson redacts every forbidden substring recursively', async () => {
    const { sanitizeArtifactJson } = await import('..');
    const dirty = JSON.stringify({
      key: 'sk-SECRET-VALUE',
      nested: [{ again: 'sk-SECRET-VALUE' }],
    });
    const clean = sanitizeArtifactJson(dirty, ['sk-SECRET-VALUE']);
    expect(clean.includes('sk-SECRET-VALUE')).toBe(false);
    expect(clean.includes('[REDACTED]')).toBe(true);
  });

  it('refuses to run the scale matrix without an explicit target repository', async () => {
    const { runScaleMatrix } = await import('../scale-run');
    const outcome = await runScaleMatrix({
      targetRepository: '',
      baseUrl: REAL_BASE_URL,
      key: REAL_KEY,
      model: REAL_MODEL,
      recordDir: RECORD_DIR,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.diagnostics.some((d) => d.code === 'ARXIC-PROPOSAL-SCALE-TARGET-MISSING')).toBe(
      true,
    );
  });

  it('scale matrix artifacts never contain the credential when a run is recorded', async () => {
    const { readScaleArtifacts } = await import('../scale-run');
    if (!RECORD_DIR || !existsSync(join(RECORD_DIR, 'scale-matrix.json'))) return;
    const artifacts = await readScaleArtifacts(RECORD_DIR);
    for (const artifact of artifacts) {
      expect(artifact.includes(REAL_KEY)).toBe(false);
    }
  });
});

describe('artifact retention hygiene', () => {
  it('writes artifacts with owner-only permissions into the requested directory', async () => {
    const { sanitizeArtifactJson } = await import('..');
    const dir = await mkdtemp(join(tmpdir(), 'arxic-dg04-artifact-'));
    try {
      await writeFile(join(dir, 'probe.json'), sanitizeArtifactJson('{}', ['x']), {
        encoding: 'utf8',
        mode: 0o640,
      });
      const contents = await readFile(join(dir, 'probe.json'), 'utf8');
      expect(contents).toBe('{}');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * DG-11 (#255) validation-program determinism. Everything here runs WITHOUT
 * credentials, WITHOUT real model calls, and WITHOUT booting any target —
 * the deterministic refusal/redaction/validator boundaries the contract
 * gates as G-1, G-4, G-5 (SP-1..SP-5). The real-model boundary (G-3) is
 * owner-gated and exercised through scripts/dg11-run-validation.ts later.
 *
 * The script modules gain typecheck coverage transitively through this
 * import (the root tsconfig includes only "packages/[name]/src" trees;
 * scripts/ has no tsconfig of its own — MUST-ANSWER (c) in the DG-11 slice
 * note).
 */
describe('DG-11 spend ledger', () => {
  it('keeps cumulative arithmetic coherent across atomic appends', async () => {
    const { appendSpendLedgerEntry, emptySpendLedger, readSpendLedger, writeSpendLedgerAtomic } =
      await import('../../scripts/dg11-run-validation');
    const dir = await mkdtemp(join(tmpdir(), 'arxic-dg11-ledger-'));
    const path = join(dir, 'spend-ledger.json');
    try {
      await writeSpendLedgerAtomic(
        path,
        emptySpendLedger('directus', 1.0, {
          repository: 'https://github.com/directus/directus',
          commit: 'cb846b6a1ddc4811359bc52b74bb31a42eab33db',
        }),
      );
      let ledger = await readSpendLedger(path);
      expect(ledger.cumulativeUsd).toBe(0);
      expect(ledger.ceilingUsd).toBe(1.0);
      ledger = appendSpendLedgerEntry(ledger, {
        runId: 'dg11-directus-1',
        recordedAt: '2026-08-19T00:00:00.000Z',
        measuredCostUsd: 0.0202368,
        calls: 80,
        valid: true,
      });
      expect(ledger.cumulativeUsd).toBeCloseTo(0.0202368, 9);
      await writeSpendLedgerAtomic(path, ledger);
      const reread = await readSpendLedger(path);
      expect(reread.cumulativeUsd).toBeCloseTo(
        reread.entries.reduce((sum, entry) => sum + entry.measuredCostUsd, 0),
        9,
      );
      expect(reread.entries).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes canonical JSON deterministically (byte-stable rewrite)', async () => {
    const { emptySpendLedger, writeSpendLedgerAtomic } =
      await import('../../scripts/dg11-run-validation');
    const dir = await mkdtemp(join(tmpdir(), 'arxic-dg11-ledger-'));
    const path = join(dir, 'spend-ledger.json');
    try {
      const ledger = emptySpendLedger('koel', 1.0, {
        repository: 'https://github.com/koel/koel',
        commit: 'dfec91ff290509c622ff7cf392fb5e506841ee2b',
      });
      await writeSpendLedgerAtomic(path, ledger);
      const first = await readFile(path, 'utf8');
      await writeSpendLedgerAtomic(path, ledger);
      expect(await readFile(path, 'utf8')).toBe(first);
      expect(first.endsWith('\n')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('DG-11 preflight refusals (SP-1, SP-2 / G-4 — zero model calls)', () => {
  const started: HttpServer[] = [];
  afterEach(async () => {
    await Promise.all(
      started
        .splice(0)
        .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  });

  /** Local stub upstream with a hit counter — proves ZERO upstream calls. */
  async function startHitCountingStub(): Promise<{ baseUrl: string; hits: () => number }> {
    let upstreamHits = 0;
    const server = createHttpServer((request, response) => {
      upstreamHits += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'stub-resp-1',
          model: 'openai/gpt-4o-mini',
          choices: [{ message: { role: 'assistant', content: '{}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
    });
    started.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('stub upstream port unknown');
    return { baseUrl: `http://127.0.0.1:${address.port}`, hits: () => upstreamHits };
  }

  it('SP-2: refuses with a recorded refusal when the ceiling leaves less headroom than the estimate — and the stub upstream records zero hits', async () => {
    const { emptySpendLedger, runPreflightChecks, writeSpendLedgerAtomic } =
      await import('../../scripts/dg11-run-validation');
    const stub = await startHitCountingStub();
    const dir = await mkdtemp(join(tmpdir(), 'arxic-dg11-preflight-'));
    const ledgerPath = join(dir, 'spend-ledger.json');
    // directus: 272 rows x (156 prompt + 85 completion) tokens at 0.15/0.60 = $0.0202368
    // estimate; ceiling 0.0001 leaves insufficient headroom on an empty ledger.
    await writeSpendLedgerAtomic(ledgerPath, emptySpendLedger('directus', 0.0001, {}));
    try {
      const outcome = await runPreflightChecks({
        target: 'directus',
        estimatedRows: 272,
        ledgerPath,
        prices: { promptPerMillion: 0.15, completionPerMillion: 0.6 },
        env: { ARXIC_MODEL_BASE_URL: stub.baseUrl, ARXIC_MODEL_API_KEY: 'stub-not-used' },
      });
      expect(outcome.disposition).toBe('refused-budget');
      expect(outcome.estimateUsd).toBeCloseTo(0.0202368, 9);
      expect(outcome.remainingUsd).toBeCloseTo(0.0001, 9);
      expect(outcome.refusal?.reason).toBe('budget-ceiling');
      expect(outcome.refusal?.upstreamCallsPlaced).toBe(0);
      expect(stub.hits()).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('SP-2: refuses when cumulative spend already consumes the ceiling (mid-program state)', async () => {
    const { appendSpendLedgerEntry, emptySpendLedger, runPreflightChecks, writeSpendLedgerAtomic } =
      await import('../../scripts/dg11-run-validation');
    const dir = await mkdtemp(join(tmpdir(), 'arxic-dg11-preflight-'));
    const ledgerPath = join(dir, 'spend-ledger.json');
    const spent = appendSpendLedgerEntry(emptySpendLedger('directus', 0.02, {}), {
      runId: 'prior-run',
      recordedAt: '2026-08-19T00:00:00.000Z',
      measuredCostUsd: 0.02,
      calls: 80,
      valid: true,
    });
    await writeSpendLedgerAtomic(ledgerPath, spent);
    try {
      const outcome = await runPreflightChecks({
        target: 'directus',
        estimatedRows: 272,
        ledgerPath,
        prices: { promptPerMillion: 0.15, completionPerMillion: 0.6 },
        env: { ARXIC_MODEL_BASE_URL: 'http://127.0.0.1:9', ARXIC_MODEL_API_KEY: 'stub' },
      });
      expect(outcome.disposition).toBe('refused-budget');
      expect(outcome.remainingUsd).toBeCloseTo(0, 9);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('SP-1: refuses fail-closed when credentials are absent at run start (budget healthy)', async () => {
    const { emptySpendLedger, runPreflightChecks, writeSpendLedgerAtomic } =
      await import('../../scripts/dg11-run-validation');
    const stub = await startHitCountingStub();
    const dir = await mkdtemp(join(tmpdir(), 'arxic-dg11-preflight-'));
    const ledgerPath = join(dir, 'spend-ledger.json');
    await writeSpendLedgerAtomic(ledgerPath, emptySpendLedger('directus', 1.0, {}));
    try {
      const outcome = await runPreflightChecks({
        target: 'directus',
        estimatedRows: 272,
        ledgerPath,
        prices: { promptPerMillion: 0.15, completionPerMillion: 0.6 },
        env: { ARXIC_MODEL_BASE_URL: '', ARXIC_MODEL_API_KEY: '' },
      });
      expect(outcome.disposition).toBe('refused-credentials');
      expect(outcome.refusal?.upstreamCallsPlaced).toBe(0);
      expect(stub.hits()).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts a healthy preflight and reports the estimate honestly', async () => {
    const { emptySpendLedger, runPreflightChecks, writeSpendLedgerAtomic } =
      await import('../../scripts/dg11-run-validation');
    const dir = await mkdtemp(join(tmpdir(), 'arxic-dg11-preflight-'));
    const ledgerPath = join(dir, 'spend-ledger.json');
    await writeSpendLedgerAtomic(ledgerPath, emptySpendLedger('directus', 1.0, {}));
    try {
      const outcome = await runPreflightChecks({
        target: 'directus',
        estimatedRows: 272,
        ledgerPath,
        prices: { promptPerMillion: 0.15, completionPerMillion: 0.6 },
        env: { ARXIC_MODEL_BASE_URL: 'http://127.0.0.1:9', ARXIC_MODEL_API_KEY: 'present' },
      });
      expect(outcome.disposition).toBe('ok');
      expect(outcome.estimateUsd).toBeCloseTo(0.0202368, 9);
      expect(outcome.remainingUsd).toBeCloseTo(1.0, 9);
      expect(outcome.refusal).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('DG-11 recording model proxy (telemetry + hard ceiling)', () => {
  const started: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(started.splice(0).map((stop) => stop()));
  });

  async function startStubUpstream(): Promise<{
    baseUrl: string;
    hits: () => number;
    seenAuth: () => string | undefined;
    stop: () => Promise<void>;
  }> {
    let upstreamHits = 0;
    let auth: string | undefined;
    const server = createHttpServer((request, response) => {
      upstreamHits += 1;
      auth = request.headers.authorization;
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      request.on('end', () => {
        const parsed = JSON.parse(body) as { model?: string };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            id: `stub-gen-${upstreamHits}`,
            model: parsed.model ?? 'openai/gpt-4o-mini',
            choices: [{ message: { role: 'assistant', content: '{}' } }],
            usage: { prompt_tokens: 100_000, completion_tokens: 1_000, total_tokens: 101_000 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('stub port unknown');
    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      hits: () => upstreamHits,
      seenAuth: () => auth,
      stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it('records per-call telemetry (requestId, model, tokens, latency, cost) and injects the real key only upstream', async () => {
    const { RecordingModelProxy } = await import('../../scripts/dg11-run-validation');
    const stub = await startStubUpstream();
    started.push(stub.stop);
    const proxy = await RecordingModelProxy.start({
      upstreamBaseUrl: stub.baseUrl,
      upstreamApiKey: 'sk-REAL-KEY-not-committed-000',
      inboundBearer: 'dg11-canary-dummy-key',
      ceilingUsd: 1.0,
      spendBeforeUsd: 0,
      prices: { promptPerMillion: 0.15, completionPerMillion: 0.6 },
    });
    started.push(() => proxy.stop());
    try {
      const response = await fetch(`${proxy.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer dg11-canary-dummy-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: 'x' }],
        }),
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { id: string };
      expect(payload.id).toBe('stub-gen-1');
      expect(stub.seenAuth()).toBe('Bearer sk-REAL-KEY-not-committed-000');
      expect(proxy.telemetry).toHaveLength(1);
      const call = proxy.telemetry[0]!;
      expect(call.requestId).toBe('stub-gen-1');
      expect(call.model).toBe('openai/gpt-4o-mini');
      expect(call.promptTokens).toBe(100_000);
      expect(call.completionTokens).toBe(1_000);
      // (100000/1e6)*0.15 + (1000/1e6)*0.6 = 0.0156
      expect(call.costUsd).toBeCloseTo(0.0156, 9);
      expect(call.latencyMs).toBeGreaterThanOrEqual(0);
      expect(proxy.measuredSpendUsd()).toBeCloseTo(0.0156, 9);
      expect(proxy.upstreamHits()).toBe(1);
    } finally {
      await proxy.stop();
      await stub.stop();
    }
  });

  it('SP-2: hard-refuses to forward once measured spend reaches the ceiling, recording the refusal', async () => {
    const { RecordingModelProxy } = await import('../../scripts/dg11-run-validation');
    const stub = await startStubUpstream();
    started.push(stub.stop);
    const proxy = await RecordingModelProxy.start({
      upstreamBaseUrl: stub.baseUrl,
      upstreamApiKey: 'sk-REAL-KEY-not-committed-000',
      inboundBearer: 'dg11-canary',
      ceilingUsd: 0.02,
      spendBeforeUsd: 0,
      prices: { promptPerMillion: 0.15, completionPerMillion: 0.6 },
    });
    started.push(() => proxy.stop());
    const call = () =>
      fetch(`${proxy.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { authorization: 'Bearer dg11-canary', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'openai/gpt-4o-mini', messages: [] }),
      });
    try {
      // First call costs 0.0156 (< 0.02 ceiling) — forwarded.
      expect((await call()).status).toBe(200);
      expect(proxy.measuredSpendUsd()).toBeCloseTo(0.0156, 9);
      // Cumulative 0.0156 < 0.02 — still allowed; after it, spend = 0.0312 >= 0.02.
      expect((await call()).status).toBe(200);
      expect(proxy.measuredSpendUsd()).toBeCloseTo(0.0312, 9);
      // Third call must be refused BEFORE forwarding: hit count stays 2.
      const refused = await call();
      expect(refused.status).toBe(402);
      expect((await refused.json()).error?.code).toBe('ARXIC-DG11-SPEND-CEILING');
      expect(proxy.upstreamHits()).toBe(2);
      expect(stub.hits()).toBe(2);
      expect(proxy.refusals).toHaveLength(1);
      expect(proxy.refusals[0]?.reason).toBe('proxy-ceiling');
      expect(proxy.refusals[0]?.upstreamCallsPlaced).toBe(2);
    } finally {
      await proxy.stop();
      await stub.stop();
    }
  });

  it('answers non-completion paths with 404 (it fronts only the model endpoint)', async () => {
    const { RecordingModelProxy } = await import('../../scripts/dg11-run-validation');
    const stub = await startStubUpstream();
    started.push(stub.stop);
    const proxy = await RecordingModelProxy.start({
      upstreamBaseUrl: stub.baseUrl,
      upstreamApiKey: 'sk-REAL',
      inboundBearer: 'dg11-canary',
      ceilingUsd: 1,
      spendBeforeUsd: 0,
      prices: { promptPerMillion: 0.15, completionPerMillion: 0.6 },
    });
    started.push(() => proxy.stop());
    try {
      const response = await fetch(`${proxy.baseUrl}/something-else`);
      expect(response.status).toBe(404);
      expect(proxy.upstreamHits()).toBe(0);
    } finally {
      await proxy.stop();
      await stub.stop();
    }
  });
});

describe('DG-11 attestation front (well-known shape through the PRODUCTION policy)', () => {
  it('serves an attestation the production verifyAttestation path allows for local-test', async () => {
    const { AttestationFront } = await import('../../scripts/dg11-run-validation');
    const { buildAttestationPolicy, verifyAttestation } =
      await import('../../../environment/src/index');
    // A stand-in app origin the front forwards to.
    let forwarded = 0;
    const app = createHttpServer((_request, response) => {
      forwarded += 1;
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('app-ok');
    });
    await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
    const appAddress = app.address();
    if (!appAddress || typeof appAddress === 'string') throw new Error('app port unknown');
    const front = await AttestationFront.start({
      appOrigin: `http://127.0.0.1:${appAddress.port}`,
      buildDigest: 'a'.repeat(64),
    });
    try {
      const response = await fetch(`${front.origin}/.well-known/arxic-test-target.json`);
      expect(response.status).toBe(200);
      const attestation = (await response.json()) as Record<string, unknown>;
      expect(attestation.environmentClass).toBe('local-test');
      expect(attestation.origin).toBe(front.origin);
      expect(String(attestation.buildDigest)).toMatch(/^[0-9a-f]{64}$/u);
      expect(typeof attestation.nonce).toBe('string');
      // The production policy the orchestrator builds for a configured origin
      // (buildAttestationPolicy auto-admits the exact origin for local-test)
      // must ALLOW this served attestation — same code path as stage attest.
      const verdict = verifyAttestation(
        attestation as never,
        { origin: front.origin },
        buildAttestationPolicy({ origin: front.origin }),
      );
      expect(verdict.disposition).toBe('allowed');
      // Everything else forwards to the app.
      const appResponse = await fetch(`${front.origin}/health`);
      expect(await appResponse.text()).toBe('app-ok');
      expect(forwarded).toBe(1);
    } finally {
      await front.stop();
      await new Promise<void>((resolve) => app.close(() => resolve()));
    }
  });
});

describe('DG-11 redaction fail-closed (SP-3 / G-5)', () => {
  it('blocks a planted canary: nothing unsanitized is written, quarantine event returned', async () => {
    const { sanitizeCandidateRecord } = await import('../../scripts/dg11-run-validation');
    const planted = 'Bearer sk-planted-canary-SECRET-1234567890abcdef';
    const candidate = JSON.stringify({
      kind: 'dg11-validation-run-v1',
      note: `upstream said ${planted} once`,
    });
    const outcome = sanitizeCandidateRecord(candidate, [
      'sk-planted-canary-SECRET-1234567890abcdef',
    ]);
    // The exact-substring sanitizer removes the credential, but the remaining
    // "Bearer [REDACTED]" shape still trips scanTextForSecrets' bearer-token
    // rule? No — [REDACTED] is not a token character run. Plant a SECOND,
    // unlisted secret to prove the scanner itself fails the record closed.
    expect(outcome.clean.includes(planted)).toBe(false);
    expect(outcome.findings).toHaveLength(0);
    const evasive = JSON.stringify({
      kind: 'dg11-validation-run-v1',
      note: 'authorization: bearer ZmFrZS1zZWNyZXQtdG9rZW4tdGhhdC1sb25n',
    });
    const blocked = sanitizeCandidateRecord(evasive, ['not-the-secret']);
    expect(blocked.findings.length).toBeGreaterThan(0);
    expect(blocked.clean).toBe(evasive); // unchanged: never ship-then-redact
  });
});

/** Fixture-directory helper shared by validator-facing tests. */
async function fixtureDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'arxic-dg11-validator-'));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), content, 'utf8');
  }
  return dir;
}

/** Canonical valid run record (single call, coherent arithmetic) for matrix tests. */
function validRunRecord(): Record<string, unknown> {
  return {
    kind: 'dg11-validation-run-v1',
    schemaVersion: 1,
    target: {
      name: 'directus',
      repository: 'https://github.com/directus/directus',
      commit: 'c'.repeat(40),
    },
    run: {
      runId: 'dg11-directus-0001',
      startedAt: '2026-08-19T00:00:00.000Z',
      completedAt: '2026-08-19T00:05:00.000Z',
      executor: 'local',
    },
    model: 'openai/gpt-4o-mini',
    pricing: {
      pricePerMillionPrompt: 0.15,
      pricePerMillionCompletion: 0.6,
      reverifyNote: 'list price at run time; re-verified by owner at read time',
    },
    telemetry: [
      {
        requestId: 'gen-1',
        model: 'openai/gpt-4o-mini',
        promptTokens: 100_000,
        completionTokens: 1_000,
        latencyMs: 800,
        costUsd: 0.0156,
      },
    ],
    measured: {
      calls: 1,
      promptTokens: 100_000,
      completionTokens: 1_000,
      latencyMsTotal: 800,
      estimatedCostUsd: 0.0202368,
      measuredCostUsd: 0.0156,
    },
    ledger: {
      before: { cumulativeUsd: 0, ceilingUsd: 1, remainingUsd: 1 },
      after: { cumulativeUsd: 0.0156, ceilingUsd: 1, remainingUsd: 0.9844 },
    },
    coverage: { rows: 272, coveredRows: 226, proposals: 202 },
    outcome: { exitCode: 0, status: 'completed', outcome: 'hypothesized', finalStage: 'verify' },
    events: [],
    groundednessSpotCheck: {
      status: 'pending',
      note: 'owner completes per DG-11 README §sampling',
    },
  };
}

/** Spend ledger whose single entry matches {@link validRunRecord}. */
function validLedgerDocument(): Record<string, unknown> {
  return {
    schemaVersion: 'dg11-spend-ledger-v1',
    target: 'directus',
    repository: 'https://github.com/directus/directus',
    commit: 'c'.repeat(40),
    ceilingUsd: 1,
    cumulativeUsd: 0.0156,
    entries: [
      {
        runId: 'dg11-directus-0001',
        recordedAt: '2026-08-19T00:05:00.000Z',
        measuredCostUsd: 0.0156,
        calls: 1,
        valid: true,
      },
    ],
  };
}

describe('DG-11 record validator (G-1 accept/reject matrix)', () => {
  it('accepts a valid record and reports pending spot-checks as incomplete-by-design', async () => {
    const { validateRecordsDirectory } = await import('../../scripts/validate-records');
    const dir = await fixtureDir({
      'directus/spend-ledger.json': `${JSON.stringify(validLedgerDocument())}\n`,
      'directus/runs/dg11-directus-0001.json': `${JSON.stringify(validRunRecord())}\n`,
    });
    try {
      const result = await validateRecordsDirectory(dir);
      expect(result.ok).toBe(true);
      expect(result.records).toBe(1);
      expect(result.complete).toBe(0);
      expect(result.incomplete).toBe(1);
      expect(result.problems).toHaveLength(0);
      expect(result.findings).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('counts a completed spot-check record as complete', async () => {
    const { validateRecordsDirectory } = await import('../../scripts/validate-records');
    const record = validRunRecord();
    record.groundednessSpotCheck = {
      status: 'completed',
      sampledAt: '2026-08-19T01:00:00.000Z',
      numerator: 3,
      denominator: 3,
      verdicts: [
        { proposalId: 'prop:abc123', verdict: 'grounded', note: 'EvidenceRefs resolve' },
        { proposalId: 'prop:def456', verdict: 'grounded', note: 'ok' },
        { proposalId: 'prop:789aaa', verdict: 'grounded', note: 'ok' },
      ],
    };
    const dir = await fixtureDir({
      'directus/spend-ledger.json': `${JSON.stringify(validLedgerDocument())}\n`,
      'directus/runs/run1.json': `${JSON.stringify(record)}\n`,
    });
    try {
      const result = await validateRecordsDirectory(dir);
      expect(result.ok).toBe(true);
      expect(result.complete).toBe(1);
      expect(result.incomplete).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects ledger arithmetic incoherence', async () => {
    const { validateRecordsDirectory } = await import('../../scripts/validate-records');
    const record = validRunRecord();
    (record.ledger as Record<string, unknown>).after = {
      cumulativeUsd: 0.5,
      ceilingUsd: 1,
      remainingUsd: 0.5,
    };
    const dir = await fixtureDir({ 'directus/runs/run1.json': `${JSON.stringify(record)}\n` });
    try {
      const result = await validateRecordsDirectory(dir);
      expect(result.ok).toBe(false);
      expect(result.problems.some((problem) => problem.includes('ledger'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects an unknown top-level key (closed schema)', async () => {
    const { validateRecordShape } = await import('../../scripts/validate-records');
    const record = validRunRecord();
    (record as Record<string, unknown>).surprise = true;
    const shape = validateRecordShape(record);
    expect(shape.ok).toBe(false);
    if (!shape.ok) expect(shape.problems.join('\n')).toContain('surprise');
  });

  it('G-5 negative control: a planted secret in a record FAILS the directory validation', async () => {
    const { validateRecordsDirectory } = await import('../../scripts/validate-records');
    const record = validRunRecord();
    (record.run as Record<string, unknown>).runId = 'run-with-planted-secret';
    (record as Record<string, unknown>).note = 'leaked credential bearer abcdefghijklmnopqrstuv';
    const dir = await fixtureDir({ 'directus/runs/bad.json': `${JSON.stringify(record)}\n` });
    try {
      const result = await validateRecordsDirectory(dir);
      expect(result.ok).toBe(false);
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings[0]?.file).toContain('bad.json');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts a budget-refusal record (G-4 artifact kind) and rejects its malformed twin', async () => {
    const { validateRecordShape } = await import('../../scripts/validate-records');
    const refusal = {
      kind: 'dg11-validation-refusal-v1',
      schemaVersion: 1,
      target: { name: 'directus' },
      runId: 'dg11-directus-refused',
      at: '2026-08-19T00:00:00.000Z',
      reason: 'budget-ceiling',
      detail: 'remaining headroom below estimate',
      estimateUsd: 0.0202368,
      cumulativeUsd: 0,
      ceilingUsd: 0.0001,
      remainingUsd: 0.0001,
      upstreamCallsPlaced: 0,
    };
    expect(validateRecordShape(refusal).ok).toBe(true);
    const malformed = { ...refusal, upstreamCallsPlaced: 'zero' };
    const shape = validateRecordShape(malformed);
    expect(shape.ok).toBe(false);
  });

  it('validates spend-ledger.json coherence against run records of the same target', async () => {
    const { validateRecordsDirectory } = await import('../../scripts/validate-records');
    const ledger = {
      schemaVersion: 'dg11-spend-ledger-v1',
      target: 'directus',
      repository: 'https://github.com/directus/directus',
      commit: 'c'.repeat(40),
      ceilingUsd: 1,
      cumulativeUsd: 0.0156,
      entries: [
        {
          runId: 'dg11-directus-0001',
          recordedAt: '2026-08-19T00:05:00.000Z',
          measuredCostUsd: 0.0156,
          calls: 1,
          valid: true,
        },
      ],
    };
    const dir = await fixtureDir({
      'directus/spend-ledger.json': `${JSON.stringify(ledger)}\n`,
      'directus/runs/dg11-directus-0001.json': `${JSON.stringify(validRunRecord())}\n`,
    });
    try {
      const coherent = await validateRecordsDirectory(dir);
      expect(coherent.ok).toBe(true);
      const drifted = structuredClone(ledger);
      drifted.cumulativeUsd = 0.9; // entries sum to 0.0156 — incoherent
      const dir2 = await fixtureDir({
        'directus/spend-ledger.json': `${JSON.stringify(drifted)}\n`,
      });
      try {
        const result = await validateRecordsDirectory(dir2);
        expect(result.ok).toBe(false);
        expect(result.problems.some((problem) => problem.includes('spend-ledger'))).toBe(true);
      } finally {
        await rm(dir2, { recursive: true, force: true });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports 0 records validated honestly on an empty directory (vacuous pass)', async () => {
    const { validateRecordsDirectory } = await import('../../scripts/validate-records');
    const dir = await mkdtemp(join(tmpdir(), 'arxic-dg11-empty-'));
    try {
      const result = await validateRecordsDirectory(dir);
      expect(result.ok).toBe(true);
      expect(result.records).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('live-key scan mode flags a directory containing the env value without printing it', async () => {
    const { scanDirectoryForValue } = await import('../../scripts/validate-records');
    const dir = await fixtureDir({
      'directus/runs/leak.json': `${JSON.stringify({
        kind: 'dg11-validation-run-v1',
        telemetry: [{ note: 'x-sk-live-leak-abcdef0123456789-y' }],
      })}\n`,
    });
    try {
      const hits = await scanDirectoryForValue(dir, 'sk-live-leak-abcdef0123456789');
      expect(hits).toEqual(['directus/runs/leak.json']);
      const clean = await scanDirectoryForValue(dir, 'sk-not-present-anywhere');
      expect(clean).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('walks nested directories and scans every file for secret patterns', async () => {
    const { scanDirectoryForSecrets } = await import('../../scripts/validate-records');
    const dir = await fixtureDir({
      'directus/runs/ok.json': '{}\n',
      'directus/refusals/bad.md': 'password = "Hunter2!" leaked\n',
    });
    try {
      const findings = await scanDirectoryForSecrets(dir);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0]?.file).toContain('bad.md');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('DG-11 evidence directory baseline', () => {
  it('docs/evidence/DG-11 contains no credential material (directory stays scan-clean as it fills)', async () => {
    const { validateRecordsDirectory } = await import('../../scripts/validate-records');
    const { existsSync: exists } = await import('node:fs');
    const evidenceDir = join(import.meta.dirname, '../../../../docs/evidence/DG-11');
    if (!exists(evidenceDir)) return; // before the README lands — vacuous
    const result = await validateRecordsDirectory(evidenceDir);
    expect(result.ok, JSON.stringify(result.problems)).toBe(true);
    const names = await readdir(evidenceDir);
    expect(names).toContain('README.md');
  });
});

// ---------------------------------------------------------------------------
// DG-11 remediation round (dual review of PR #284): P1 findings 1-4 first
// (red before implementation), then P2 findings 5-10 and P3 findings 11-15.
// ---------------------------------------------------------------------------

/** Flexible local model-endpoint stub: configurable delay / raw response body. */
async function startModelStub(options?: { delayMs?: number; responseBody?: string }): Promise<{
  baseUrl: string;
  hits: () => number;
  seenAuth: () => string | undefined;
  stop: () => Promise<void>;
}> {
  let upstreamHits = 0;
  let auth: string | undefined;
  const server = createHttpServer((request, response) => {
    upstreamHits += 1;
    auth = request.headers.authorization;
    request.resume(); // drain the request body
    request.on('end', () => {
      const respond = () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          options?.responseBody ??
            JSON.stringify({
              id: `stub-gen-${upstreamHits}`,
              model: 'openai/gpt-4o-mini',
              choices: [{ message: { role: 'assistant', content: '{}' } }],
              usage: { prompt_tokens: 100_000, completion_tokens: 1_000, total_tokens: 101_000 },
            }),
        );
      };
      if (options?.delayMs && options.delayMs > 0) setTimeout(respond, options.delayMs);
      else respond();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('stub port unknown');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    hits: () => upstreamHits,
    seenAuth: () => auth,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describe('DG-11 remediation P1-1: zero-price bypass (dual-review finding 1)', () => {
  it('preflight refuses fail-closed when either price is zero — structured refusal, zero upstream calls', async () => {
    const { emptySpendLedger, runPreflightChecks, writeSpendLedgerAtomic } =
      await import('../../scripts/dg11-run-validation');
    const stub = await startModelStub();
    const dir = await mkdtemp(join(tmpdir(), 'arxic-dg11-remediation-'));
    const ledgerPath = join(dir, 'spend-ledger.json');
    await writeSpendLedgerAtomic(ledgerPath, emptySpendLedger('directus', 1.0, {}));
    try {
      const outcome = await runPreflightChecks({
        target: 'directus',
        estimatedRows: 272,
        ledgerPath,
        prices: { promptPerMillion: 0, completionPerMillion: 0.6 },
        env: { ARXIC_MODEL_BASE_URL: stub.baseUrl, ARXIC_MODEL_API_KEY: 'stub' },
      });
      expect(outcome.disposition).toBe('refused-pricing');
      expect(outcome.refusal?.reason).toBe('zero-price');
      expect(outcome.refusal?.upstreamCallsPlaced).toBe(0);
      expect(outcome.refusal?.detail).toContain('strictly');
      // The whole bypass in one line: a zero price must never produce a $0
      // estimate that sails through preflight.
      expect(outcome.disposition === 'ok').toBe(false);
      expect(stub.hits()).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await stub.stop();
    }
  });

  it('also refuses when only the completion price is zero (either zero is a bypass)', async () => {
    const { emptySpendLedger, runPreflightChecks, writeSpendLedgerAtomic } =
      await import('../../scripts/dg11-run-validation');
    const stub = await startModelStub();
    const dir = await mkdtemp(join(tmpdir(), 'arxic-dg11-remediation-'));
    const ledgerPath = join(dir, 'spend-ledger.json');
    await writeSpendLedgerAtomic(ledgerPath, emptySpendLedger('directus', 1.0, {}));
    try {
      const outcome = await runPreflightChecks({
        target: 'directus',
        estimatedRows: 272,
        ledgerPath,
        prices: { promptPerMillion: 0.15, completionPerMillion: 0 },
        env: { ARXIC_MODEL_BASE_URL: stub.baseUrl, ARXIC_MODEL_API_KEY: 'stub' },
      });
      expect(outcome.disposition).toBe('refused-pricing');
      expect(stub.hits()).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await stub.stop();
    }
  });

  it('validator rejects a run record with calls > 0 and both prices 0 (coherent zeros are still invalid)', async () => {
    const { validateRecordArithmetic, validateRecordShape } =
      await import('../../scripts/validate-records');
    const record = validRunRecord();
    record.pricing = {
      pricePerMillionPrompt: 0,
      pricePerMillionCompletion: 0,
      reverifyNote: 'zero prices',
    };
    record.telemetry = [
      {
        requestId: 'gen-1',
        model: 'openai/gpt-4o-mini',
        promptTokens: 100_000,
        completionTokens: 1_000,
        latencyMs: 5,
        costUsd: 0,
      },
    ];
    record.measured = {
      calls: 1,
      promptTokens: 100_000,
      completionTokens: 1_000,
      latencyMsTotal: 5,
      estimatedCostUsd: 0,
      measuredCostUsd: 0,
    };
    record.ledger = {
      before: { cumulativeUsd: 0, ceilingUsd: 1, remainingUsd: 1 },
      after: { cumulativeUsd: 0, ceilingUsd: 1, remainingUsd: 1 },
    };
    // Shape and per-call arithmetic are perfectly coherent at zero — only the
    // zero-price rule can catch this record.
    expect(validateRecordShape(record).ok).toBe(true);
    const verdict = validateRecordArithmetic(record);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.problems.join('\n')).toContain('zero prices');
  });
});

describe('DG-11 remediation P1-2: corrupt-ledger fail-open (dual-review finding 2)', () => {
  it('readSpendLedger rejects corrupt JSON and incoherent ledgers instead of fail-opening to empty', async () => {
    const { readSpendLedger } = await import('../../scripts/dg11-run-validation');
    const dir = await mkdtemp(join(tmpdir(), 'arxic-dg11-remediation-'));
    try {
      await writeFile(join(dir, 'spend-ledger.json'), '{not json at all', 'utf8');
      await expect(readSpendLedger(join(dir, 'spend-ledger.json'))).rejects.toThrow(
        /spend ledger/i,
      );
      const incoherent = {
        schemaVersion: 'dg11-spend-ledger-v1',
        target: 'directus',
        ceilingUsd: 1,
        cumulativeUsd: 0.9,
        entries: [
          {
            runId: 'r1',
            recordedAt: '2026-08-20T00:00:00.000Z',
            measuredCostUsd: 0.01,
            calls: 1,
            valid: true,
          },
        ],
      };
      await writeFile(join(dir, 'incoherent.json'), JSON.stringify(incoherent), 'utf8');
      await expect(readSpendLedger(join(dir, 'incoherent.json'))).rejects.toThrow(/spend ledger/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preflight REFUSES on an unreadable ledger — refusal names path and failure; the corrupt file is preserved byte-for-byte', async () => {
    const { runPreflightChecks } = await import('../../scripts/dg11-run-validation');
    const stub = await startModelStub();
    const dir = await mkdtemp(join(tmpdir(), 'arxic-dg11-remediation-'));
    const ledgerPath = join(dir, 'spend-ledger.json');
    const corrupt =
      '{"schemaVersion": "dg11-spend-ledger-v1", "cumulativeUsd": 0.5, "entries": [trunc';
    await writeFile(ledgerPath, corrupt, 'utf8');
    try {
      const outcome = await runPreflightChecks({
        target: 'directus',
        estimatedRows: 272,
        ledgerPath,
        prices: { promptPerMillion: 0.15, completionPerMillion: 0.6 },
        env: { ARXIC_MODEL_BASE_URL: stub.baseUrl, ARXIC_MODEL_API_KEY: 'stub' },
      });
      expect(outcome.disposition).toBe('refused-ledger');
      expect(outcome.refusal?.reason).toBe('ledger-unreadable');
      expect(outcome.refusal?.detail).toContain(ledgerPath);
      expect(outcome.refusal?.upstreamCallsPlaced).toBe(0);
      expect(stub.hits()).toBe(0);
      // Fail-closed, not fail-open: the corrupt ledger is never rewritten.
      expect(await readFile(ledgerPath, 'utf8')).toBe(corrupt);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await stub.stop();
    }
  });

  it('loadSpendLedger: ENOENT is a legitimate fresh ledger; anything else is unreadable', async () => {
    const { emptySpendLedger, loadSpendLedger, writeSpendLedgerAtomic } =
      await import('../../scripts/dg11-run-validation');
    const dir = await mkdtemp(join(tmpdir(), 'arxic-dg11-remediation-'));
    const seed = {
      target: 'koel',
      ceilingUsd: 1,
      repository: 'https://github.com/koel/koel',
      commit: 'd'.repeat(40),
    };
    try {
      const missing = await loadSpendLedger({ path: join(dir, 'absent.json'), ...seed });
      expect(missing.status).toBe('loaded');
      if (missing.status === 'loaded') {
        expect(missing.existed).toBe(false);
        expect(missing.ledger.entries).toHaveLength(0);
      }
      await writeSpendLedgerAtomic(join(dir, 'good.json'), emptySpendLedger('koel', 1, {}));
      const good = await loadSpendLedger({ path: join(dir, 'good.json'), ...seed });
      expect(good.status).toBe('loaded');
      if (good.status === 'loaded') expect(good.existed).toBe(true);
      await writeFile(join(dir, 'bad.json'), '<<<not-json>>>', 'utf8');
      const bad = await loadSpendLedger({ path: join(dir, 'bad.json'), ...seed });
      expect(bad.status).toBe('unreadable');
      if (bad.status === 'unreadable') expect(bad.failure.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('validator: a run record whose runId has no entry in its target ledger is invalid (unaccounted run)', async () => {
    const { validateRecordsDirectory } = await import('../../scripts/validate-records');
    const ledger = validLedgerDocument();
    ledger.entries = [];
    ledger.cumulativeUsd = 0;
    const dir = await fixtureDir({
      'directus/spend-ledger.json': `${JSON.stringify(ledger)}\n`,
      'directus/runs/dg11-directus-0001.json': `${JSON.stringify(validRunRecord())}\n`,
    });
    try {
      const result = await validateRecordsDirectory(dir);
      expect(result.ok).toBe(false);
      expect(
        result.problems.some(
          (problem) => problem.includes('dg11-directus-0001') && problem.includes('ledger'),
        ),
      ).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('DG-11 remediation P1-3: unrecorded-forward accounting gap (dual-review finding 3)', () => {
  it('stop() drains in-flight forwards: a delayed upstream response still lands in telemetry after the client aborted', async () => {
    const { RecordingModelProxy } = await import('../../scripts/dg11-run-validation');
    const stub = await startModelStub({ delayMs: 400 });
    const proxy = await RecordingModelProxy.start({
      upstreamBaseUrl: stub.baseUrl,
      upstreamApiKey: 'sk-REAL-KEY-not-committed-000',
      inboundBearer: 'dg11-canary-drain-test',
      ceilingUsd: 1.0,
      spendBeforeUsd: 0,
      prices: { promptPerMillion: 0.15, completionPerMillion: 0.6 },
    });
    try {
      const controller = new AbortController();
      const inFlight = fetch(`${proxy.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer dg11-canary-drain-test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: 'openai/gpt-4o-mini', messages: [] }),
        signal: controller.signal,
      });
      void inFlight.catch(() => {}); // the abort is expected
      await new Promise((resolve) => setTimeout(resolve, 60));
      controller.abort();
      // stop() must NOT resolve while the upstream forward is still in flight.
      await proxy.stop();
      expect(proxy.upstreamHits()).toBe(1);
      expect(proxy.telemetry).toHaveLength(1);
      expect(proxy.telemetry[0]?.requestId).toBe('stub-gen-1');
      expect(proxy.telemetry[0]?.costUsd).toBeCloseTo(0.0156, 9);
    } finally {
      await proxy.stop();
      await stub.stop();
    }
  });

  it('forced-unparseable 200: forwarded=1 telemetry=0 → accounting-gap event + ledger entry freezes headroom to 0', async () => {
    const {
      RecordingModelProxy,
      appendSpendLedgerEntry,
      buildRunEvents,
      emptySpendLedger,
      finalizeLedgerArithmetic,
      remainingHeadroomUsd,
    } = await import('../../scripts/dg11-run-validation');
    const { validateRecordArithmetic } = await import('../../scripts/validate-records');
    const stub = await startModelStub({
      responseBody: 'HTTP/1.1 200 OK but definitely not json{{{',
    });
    const proxy = await RecordingModelProxy.start({
      upstreamBaseUrl: stub.baseUrl,
      upstreamApiKey: 'sk-REAL-KEY-not-committed-000',
      inboundBearer: 'dg11-canary',
      ceilingUsd: 1.0,
      spendBeforeUsd: 0,
      prices: { promptPerMillion: 0.15, completionPerMillion: 0.6 },
    });
    try {
      const response = await fetch(`${proxy.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { authorization: 'Bearer dg11-canary', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'openai/gpt-4o-mini', messages: [] }),
      });
      expect(response.status).toBe(200);
      await proxy.stop();
      // The gap is real and detectable: forwarded 1, telemetry 0.
      expect(proxy.upstreamHits()).toBe(1);
      expect(proxy.telemetry).toHaveLength(0);
      const gapCalls = proxy.upstreamHits() - proxy.telemetry.length;
      const events = buildRunEvents({
        refusals: [],
        accountingGapCalls: gapCalls,
        overshootUsd: 0,
        at: '2026-08-20T00:00:00.000Z',
      });
      expect(events.some((event) => event.type === 'accounting-gap')).toBe(true);
      // Fail-closed ledger: the gap entry freezes remaining headroom to $0
      // even though recorded cumulative ($0) is far below the ceiling.
      let ledger = emptySpendLedger('directus', 1.0, {});
      ledger = appendSpendLedgerEntry(ledger, {
        runId: 'gap-run',
        recordedAt: '2026-08-20T00:00:00.000Z',
        measuredCostUsd: 0,
        calls: 0,
        valid: false,
        accountingGap: true,
      });
      expect(remainingHeadroomUsd(ledger)).toBe(0);
      // Delta re-review P3 (accounting-gap self-consistency): the record the
      // runner emits for this forced-gap run carries the accounting-gap
      // event, so gap-aware finalizeLedgerArithmetic must freeze
      // after.remainingUsd to 0 (TRUE cumulative preserved) for the record to
      // pass the validator's gap freeze rule — the runner can never emit a
      // record its own validator rejects.
      const finalize = finalizeLedgerArithmetic({ cumulativeUsd: 0, ceilingUsd: 1.0 }, 0, gapCalls);
      expect(finalize.after.cumulativeUsd).toBe(0);
      expect(finalize.after.remainingUsd).toBe(0);
      const gapRecord = validRunRecord();
      gapRecord.model = 'unobserved';
      gapRecord.telemetry = [];
      gapRecord.measured = {
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        latencyMsTotal: 0,
        estimatedCostUsd: 0.0202368,
        measuredCostUsd: 0,
      };
      gapRecord.ledger = { before: finalize.before, after: finalize.after };
      gapRecord.events = events;
      const verdict = validateRecordArithmetic(gapRecord);
      expect(verdict.ok, JSON.stringify(verdict.ok ? null : verdict.problems)).toBe(true);
      // Negative control: the pre-fix non-gap-aware arithmetic (remaining =
      // ceiling − cumulative > 0 alongside a gap event) is exactly what the
      // validator rejects — the freeze rule stays load-bearing.
      const nonGapAware = finalizeLedgerArithmetic({ cumulativeUsd: 0, ceilingUsd: 1.0 }, 0);
      expect(nonGapAware.after.remainingUsd).toBe(1);
      const rejectedRecord = {
        ...gapRecord,
        ledger: { before: nonGapAware.before, after: nonGapAware.after },
      };
      const rejection = validateRecordArithmetic(rejectedRecord);
      expect(rejection.ok).toBe(false);
      expect(rejection.ok ? [] : rejection.problems).toContain(
        'ledger.after.remainingUsd must be frozen to 0 while an accounting-gap event is present',
      );
    } finally {
      await proxy.stop();
      await stub.stop();
    }
  });
});

describe('DG-11 remediation P1-4: overshoot self-invalidation (dual-review finding 4)', () => {
  it('a forwarded call over the ceiling yields an honest record: remaining clamped to 0, overshoot event, arithmetic VALID (reviewer repro: 0.0312 vs 0.02)', async () => {
    const { buildRunEvents, finalizeLedgerArithmetic } =
      await import('../../scripts/dg11-run-validation');
    const { validateRecordArithmetic } = await import('../../scripts/validate-records');
    const finalize = finalizeLedgerArithmetic({ cumulativeUsd: 0, ceilingUsd: 0.02 }, 0.0312);
    expect(finalize.after.cumulativeUsd).toBeCloseTo(0.0312, 9);
    expect(finalize.after.remainingUsd).toBe(0);
    expect(finalize.overshootUsd).toBeCloseTo(0.0112, 9);
    const events = buildRunEvents({
      refusals: [],
      accountingGapCalls: 0,
      overshootUsd: finalize.overshootUsd,
      at: '2026-08-20T00:00:00.000Z',
    });
    const overshoot = events.find((event) => event.type === 'ceiling-overshoot');
    expect(overshoot).toBeDefined();
    expect(overshoot?.overrunUsd).toBeCloseTo(0.0112, 9);
    const record = validRunRecord();
    record.telemetry = [
      {
        requestId: 'gen-1',
        model: 'openai/gpt-4o-mini',
        promptTokens: 100_000,
        completionTokens: 1_000,
        latencyMs: 800,
        costUsd: 0.0156,
      },
      {
        requestId: 'gen-2',
        model: 'openai/gpt-4o-mini',
        promptTokens: 100_000,
        completionTokens: 1_000,
        latencyMs: 800,
        costUsd: 0.0156,
      },
    ];
    record.measured = {
      calls: 2,
      promptTokens: 200_000,
      completionTokens: 2_000,
      latencyMsTotal: 1_600,
      estimatedCostUsd: 0.0202368,
      measuredCostUsd: 0.0312,
    };
    record.ledger = { before: finalize.before, after: finalize.after };
    record.events = events;
    const verdict = validateRecordArithmetic(record);
    expect(verdict.ok, JSON.stringify(verdict.ok ? null : verdict.problems)).toBe(true);
  });

  it('validator rejects cumulative > ceiling WITHOUT a ceiling-overshoot event', async () => {
    const { validateRecordArithmetic } = await import('../../scripts/validate-records');
    const record = validRunRecord();
    record.telemetry = [
      {
        requestId: 'gen-1',
        model: 'openai/gpt-4o-mini',
        promptTokens: 100_000,
        completionTokens: 1_000,
        latencyMs: 800,
        costUsd: 0.0156,
      },
      {
        requestId: 'gen-2',
        model: 'openai/gpt-4o-mini',
        promptTokens: 100_000,
        completionTokens: 1_000,
        latencyMs: 800,
        costUsd: 0.0156,
      },
    ];
    record.measured = {
      calls: 2,
      promptTokens: 200_000,
      completionTokens: 2_000,
      latencyMsTotal: 1_600,
      estimatedCostUsd: 0.0202368,
      measuredCostUsd: 0.0312,
    };
    record.ledger = {
      before: { cumulativeUsd: 0, ceilingUsd: 0.02, remainingUsd: 0.02 },
      after: { cumulativeUsd: 0.0312, ceilingUsd: 0.02, remainingUsd: 0 },
    };
    record.events = [];
    const verdict = validateRecordArithmetic(record);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.problems.join('\n')).toContain('ceiling-overshoot');
  });

  it('validator rejects negative remainingUsd outright (shape)', async () => {
    const { validateRecordShape } = await import('../../scripts/validate-records');
    const record = validRunRecord();
    record.ledger = {
      before: { cumulativeUsd: 0, ceilingUsd: 0.02, remainingUsd: 0.02 },
      after: { cumulativeUsd: 0.0312, ceilingUsd: 0.02, remainingUsd: -0.0112 },
    };
    const shape = validateRecordShape(record);
    expect(shape.ok).toBe(false);
  });
});

/** Raw HTTP probe (attestation-front malformed request-target tests). */
function rawHttpProbe(
  port: number,
  requestTarget: string,
): Promise<{ statusLine: string; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(
        `GET ${requestTarget} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
      );
    });
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
    });
    socket.on('end', () =>
      resolve({ statusLine: data.split('\r\n')[0] ?? '', body: data.split('\r\n\r\n')[1] ?? '' }),
    );
    socket.on('error', reject);
    socket.setTimeout(5_000, () => {
      socket.destroy();
      reject(new Error('raw probe timed out'));
    });
  });
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

async function initTempGitRepo(): Promise<{ dir: string; head: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'arxic-dg11-clone-'));
  await writeFile(join(dir, 'README'), 'pin\n', 'utf8');
  await git(dir, ['init']);
  await git(dir, ['config', 'user.email', 'dg11@example.invalid']);
  await git(dir, ['config', 'user.name', 'DG-11 test']);
  await git(dir, ['add', 'README']);
  await git(dir, ['commit', '-m', 'pin']);
  return { dir, head: await git(dir, ['rev-parse', 'HEAD']) };
}

describe('DG-11 remediation P2-5: attestation-front origin pinning (dual-review finding 5)', () => {
  it('rejects absolute-form, protocol-relative, and backslash request targets with 404 and zero forwards; benign paths still forward', async () => {
    const { AttestationFront } = await import('../../scripts/dg11-run-validation');
    let forwarded = 0;
    const app = createHttpServer((_request, response) => {
      forwarded += 1;
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('app-ok');
    });
    await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
    const appAddress = app.address();
    if (!appAddress || typeof appAddress === 'string') throw new Error('app port unknown');
    const front = await AttestationFront.start({
      appOrigin: `http://127.0.0.1:${appAddress.port}`,
      buildDigest: 'a'.repeat(64),
    });
    const frontPort = Number(new URL(front.origin).port);
    try {
      // WHATWG URL resolves ALL THREE to http://evil.example — without the
      // origin assertion this front would proxy arbitrary hosts header-first.
      for (const target of ['http://evil.example/x', '//evil.example/x', '/\\evil.example/x']) {
        const probe = await rawHttpProbe(frontPort, target);
        expect(probe.statusLine, `${target} → ${probe.statusLine}`).toContain(' 404');
      }
      expect(forwarded).toBe(0);
      const benign = await fetch(`${front.origin}/health`);
      expect(benign.status).toBe(200);
      expect(await benign.text()).toBe('app-ok');
      expect(forwarded).toBe(1);
    } finally {
      await front.stop();
      await new Promise<void>((resolve) => app.close(() => resolve()));
    }
  });
});

describe('DG-11 remediation P2-6: recording-proxy inbound authentication (dual-review finding 6)', () => {
  it('401 with the static body and zero forwards on missing or wrong bearer; the canary bearer forwards', async () => {
    const { DG11_PROXY_UNAUTHORIZED_BODY, RecordingModelProxy } =
      await import('../../scripts/dg11-run-validation');
    const stub = await startModelStub();
    const proxy = await RecordingModelProxy.start({
      upstreamBaseUrl: stub.baseUrl,
      upstreamApiKey: 'sk-REAL-KEY-not-committed-000',
      inboundBearer: 'dg11-canary-secret',
      ceilingUsd: 1.0,
      spendBeforeUsd: 0,
      prices: { promptPerMillion: 0.15, completionPerMillion: 0.6 },
    });
    const call = (authorization?: string) =>
      fetch(`${proxy.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          ...(authorization ? { authorization } : {}),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: 'openai/gpt-4o-mini', messages: [] }),
      });
    try {
      const missing = await call();
      expect(missing.status).toBe(401);
      expect(await missing.text()).toBe(DG11_PROXY_UNAUTHORIZED_BODY);
      const wrong = await call('Bearer dg11-canary-WRONG');
      expect(wrong.status).toBe(401);
      expect(await wrong.text()).toBe(DG11_PROXY_UNAUTHORIZED_BODY);
      expect(proxy.upstreamHits()).toBe(0);
      expect(stub.hits()).toBe(0); // zero forwards — no local caller can spend the real key
      const right = await call('Bearer dg11-canary-secret');
      expect(right.status).toBe(200);
      expect(stub.hits()).toBe(1);
      expect(stub.seenAuth()).toBe('Bearer sk-REAL-KEY-not-committed-000');
    } finally {
      await proxy.stop();
      await stub.stop();
    }
  });
});

describe('DG-11 remediation P2-7: ceiling env vs ledger agreement (dual-review finding 7)', () => {
  it('refuses when ARXIC_DG11_CEILING_USD differs from the existing ledger ceiling — raise AND lower; matching/unset pass', async () => {
    const { emptySpendLedger, runPreflightChecks, writeSpendLedgerAtomic } =
      await import('../../scripts/dg11-run-validation');
    const dir = await mkdtemp(join(tmpdir(), 'arxic-dg11-remediation-'));
    const ledgerPath = join(dir, 'spend-ledger.json');
    await writeSpendLedgerAtomic(ledgerPath, emptySpendLedger('directus', 1.0, {}));
    const baseEnv = { ARXIC_MODEL_BASE_URL: 'http://127.0.0.1:9', ARXIC_MODEL_API_KEY: 'stub' };
    const prices = { promptPerMillion: 0.15, completionPerMillion: 0.6 };
    try {
      for (const envCeiling of [2.0, 0.5]) {
        const outcome = await runPreflightChecks({
          target: 'directus',
          estimatedRows: 272,
          ledgerPath,
          prices,
          ceilingUsd: envCeiling,
          env: baseEnv,
        });
        expect(outcome.disposition).toBe('refused-ceiling');
        expect(outcome.refusal?.reason).toBe('ceiling-mismatch');
        expect(outcome.refusal?.detail).toContain(`ARXIC_DG11_CEILING_USD=${envCeiling}`);
        expect(outcome.refusal?.detail).toContain('ceiling=1');
        expect(outcome.refusal?.detail).toContain('adopt');
        expect(outcome.refusal?.upstreamCallsPlaced).toBe(0);
      }
      const matching = await runPreflightChecks({
        target: 'directus',
        estimatedRows: 272,
        ledgerPath,
        prices,
        ceilingUsd: 1.0,
        env: baseEnv,
      });
      expect(matching.disposition).toBe('ok');
      // Unset env: the ledger ceiling stays authoritative (no mismatch trip).
      const unset = await runPreflightChecks({
        target: 'directus',
        estimatedRows: 272,
        ledgerPath,
        prices,
        env: baseEnv,
      });
      expect(unset.disposition).toBe('ok');
      expect(unset.ceilingUsd).toBe(1.0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('DG-11 remediation P2-8: commit pin asserted, not assumed (dual-review finding 8)', () => {
  it('assertCloneAtPin accepts a clone at the pin and refuses a drifted HEAD naming both commits', async () => {
    const { assertCloneAtPin } = await import('../../scripts/dg11-run-validation');
    const { dir, head } = await initTempGitRepo();
    try {
      const atPin = await assertCloneAtPin(dir, head);
      expect(atPin.ok).toBe(true);
      const otherPin = '0123456789abcdef0123456789abcdef01234567';
      const drifted = await assertCloneAtPin(dir, otherPin);
      expect(drifted.ok).toBe(false);
      if (!drifted.ok) {
        expect(drifted.head).toBe(head);
        expect(drifted.expectedPin).toBe(otherPin);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('DG-11 remediation P2-9: --live-key-env silent skip (dual-review finding 9)', () => {
  it('a missing live-key variable is a failure unless explicitly allowed; present values scan and detect', async () => {
    const { liveKeyMissingExitCode, runLiveKeyScan } =
      await import('../../scripts/validate-records');
    const dir = await fixtureDir({
      'directus/runs/leak.json': 'x-sk-live-leak-abcdef0123456789-y\n',
    });
    try {
      const unset = await runLiveKeyScan(dir, {
        variable: 'ARXIC_MODEL_API_KEY',
        value: undefined,
        allowMissing: false,
      });
      expect(unset.status).toBe('missing');
      const empty = await runLiveKeyScan(dir, {
        variable: 'ARXIC_MODEL_API_KEY',
        value: '',
        allowMissing: false,
      });
      expect(empty.status).toBe('missing');
      const unnamed = await runLiveKeyScan(dir, {
        variable: '',
        value: 'whatever',
        allowMissing: false,
      });
      expect(unnamed.status).toBe('missing');
      expect(liveKeyMissingExitCode(false)).toBe(1);
      expect(liveKeyMissingExitCode(true)).toBe(0);
      const flagged = await runLiveKeyScan(dir, {
        variable: 'ARXIC_MODEL_API_KEY',
        value: 'sk-live-leak-abcdef0123456789',
        allowMissing: false,
      });
      expect(flagged.status).toBe('scanned');
      if (flagged.status === 'scanned') expect(flagged.hits).toEqual(['directus/runs/leak.json']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('DG-11 remediation P2-10: stale framing headers (dual-review finding 10)', () => {
  it('strips content-encoding/content-length from a gzip-labeled upstream response (fetch decompressed it in flight)', async () => {
    const { AttestationFront } = await import('../../scripts/dg11-run-validation');
    const plaintext = 'framed-body-plain-text-payload';
    const gzipped = gzipSync(Buffer.from(plaintext, 'utf8'));
    const app = createHttpServer((_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/plain',
        'content-encoding': 'gzip',
        'content-length': String(gzipped.length),
      });
      response.end(gzipped);
    });
    await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
    const appAddress = app.address();
    if (!appAddress || typeof appAddress === 'string') throw new Error('app port unknown');
    const front = await AttestationFront.start({
      appOrigin: `http://127.0.0.1:${appAddress.port}`,
      buildDigest: 'a'.repeat(64),
    });
    try {
      const response = await fetch(`${front.origin}/asset.txt`);
      expect(response.status).toBe(200);
      // The front's fetch already gunzipped; forwarding the stale labels would
      // make the client gunzip plain text (or truncate at the old length).
      expect(response.headers.get('content-encoding')).toBeNull();
      expect(response.headers.get('content-length')).toBeNull();
      expect(await response.text()).toBe(plaintext);
    } finally {
      await front.stop();
      await new Promise<void>((resolve) => app.close(() => resolve()));
    }
  });
});

describe('DG-11 remediation P3: run-id guard, model sentinel, ISO-8601 (findings 11-13)', () => {
  it('isValidRunId enforces the charset/length guard before any path use (finding 11)', async () => {
    const { isValidRunId } = await import('../../scripts/dg11-run-validation');
    expect(isValidRunId('dg11-directus-20260820T000000Z')).toBe(true);
    expect(isValidRunId('a')).toBe(true);
    expect(isValidRunId('ok.with-dots_and.dashes')).toBe(true);
    expect(isValidRunId('x'.repeat(128))).toBe(true);
    expect(isValidRunId('')).toBe(false);
    expect(isValidRunId('../../etc/passwd')).toBe(false);
    expect(isValidRunId('-leading-dash')).toBe(false);
    expect(isValidRunId('.leading-dot')).toBe(false);
    expect(isValidRunId('x'.repeat(129))).toBe(false);
    expect(isValidRunId('space inside')).toBe(false);
    expect(isValidRunId('tab\tinside')).toBe(false);
  });

  it('model sentinel "unobserved" is valid with zero telemetry and INVALID with calls (finding 12)', async () => {
    const { validateRecordShape } = await import('../../scripts/validate-records');
    const zeroCall = validRunRecord();
    zeroCall.model = 'unobserved';
    zeroCall.telemetry = [];
    zeroCall.measured = {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      latencyMsTotal: 0,
      estimatedCostUsd: 0.0202368,
      measuredCostUsd: 0,
    };
    expect(validateRecordShape(zeroCall).ok).toBe(true);
    const oneCall = validRunRecord();
    oneCall.model = 'unobserved';
    const shape = validateRecordShape(oneCall);
    expect(shape.ok).toBe(false);
    if (!shape.ok) expect(shape.problems.join('\n')).toContain('unobserved');
  });

  it('rejects non-ISO-8601 timestamps in run records, refusal records, and ledger entries (finding 13)', async () => {
    const { validateLedgerDocument, validateRecordShape } =
      await import('../../scripts/validate-records');
    const record = validRunRecord();
    (record.run as Record<string, unknown>).startedAt = '20-08-2026 00:00:00';
    expect(validateRecordShape(record).ok).toBe(false);
    const record2 = validRunRecord();
    (record2.run as Record<string, unknown>).completedAt = '2026-08-19T00:05:00'; // no Z
    expect(validateRecordShape(record2).ok).toBe(false);
    const refusal = {
      kind: 'dg11-validation-refusal-v1',
      schemaVersion: 1,
      target: { name: 'directus' },
      runId: 'dg11-refusal',
      at: 'yesterday',
      reason: 'budget-ceiling',
      detail: 'remaining headroom below estimate',
      upstreamCallsPlaced: 0,
    };
    expect(validateRecordShape(refusal).ok).toBe(false);
    const ledger = {
      schemaVersion: 'dg11-spend-ledger-v1',
      target: 'directus',
      ceilingUsd: 1,
      cumulativeUsd: 0.01,
      entries: [
        {
          runId: 'r1',
          recordedAt: '2026-08-20 (approx)',
          measuredCostUsd: 0.01,
          calls: 1,
          valid: true,
        },
      ],
    };
    expect(validateLedgerDocument(ledger).ok).toBe(false);
  });
});
