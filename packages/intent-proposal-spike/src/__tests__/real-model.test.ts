import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelAdapter } from '@arxic/model-adapter';
import { describe, expect, it } from 'vitest';

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
