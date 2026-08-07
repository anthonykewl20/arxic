import type { Diagnostic, EvidenceRef } from '@arxic/contracts';
import { validateWorkflow } from '@arxic/contracts';
import type { ModelAdapter } from '@arxic/model-adapter';
import { describe, expect, it, vi } from 'vitest';
import {
  buildInferenceMessages,
  evidenceId,
  mapStage4Candidates,
  runStage4Inference,
  selectNeighbourhood,
  STAGE4_NEIGHBOURHOOD_LIMIT,
  STAGE4_SCHEMA_VERSION,
  stage4Infer,
} from '..';

const commit = 'a'.repeat(40);
const evidencePattern = /^(src|run|doc):[A-Za-z0-9._#-]+(?::[A-Za-z0-9._#-]+)?$/u;

function source(
  path = 'app/login/page.tsx',
  startLine = 10,
  endLine = 20,
): Extract<EvidenceRef, { kind: 'source' }> {
  return {
    kind: 'source',
    repo: 'file:///repo',
    commit,
    path,
    startLine,
    endLine,
    blobSha256: 'b'.repeat(64),
    extractor: 'tree-sitter',
  };
}

function runtime(): EvidenceRef {
  return {
    kind: 'runtime',
    runId: 'run-1',
    appBuildDigest: 'c'.repeat(64),
    browser: 'chromium',
    browserVersion: '1',
    url: 'http://127.0.0.1/login?next=/account',
    timestamp: '2026-08-07T00:00:00.000Z',
  };
}

function document(): EvidenceRef {
  return { kind: 'document', artifactRef: 'docs/auth/login.md', sha256: 'd'.repeat(64) };
}

function adapterWith(result: unknown): ModelAdapter {
  return {
    requestStructuredOutput: vi.fn(async () => result),
  } as unknown as ModelAdapter;
}

function successfulAdapter(requestId = 'chatcmpl-stage4-001'): ModelAdapter {
  return adapterWith({
    ok: true,
    output: {
      schemaVersion: STAGE4_SCHEMA_VERSION,
      candidates: [{ id: 'authentication.login', intent: 'submit the login form' }],
    },
    runRecord: { requestId },
  });
}

describe('stage-4 inference service sad paths', () => {
  it('selects only a deterministic, deduplicated, bounded source neighbourhood', () => {
    const refs = Array.from({ length: 30 }, (_, index) =>
      source(`routes/${String(29 - index).padStart(2, '0')}.tsx`, index + 1, index + 2),
    );
    const selected = selectNeighbourhood([runtime(), refs[0], document(), ...refs, refs[0]]);

    expect(selected).toHaveLength(STAGE4_NEIGHBOURHOOD_LIMIT);
    expect(selected.every((ref) => ref.kind === 'source')).toBe(true);
    expect(new Set(selected.map((ref) => JSON.stringify(ref))).size).toBe(selected.length);
    expect(selected.map((ref) => (ref.kind === 'source' ? ref.path : ''))).toEqual(
      [...selected].map((ref) => (ref.kind === 'source' ? ref.path : '')).sort(),
    );
    expect(selectNeighbourhood([])).toEqual([]);
  });

  it('creates stable, pattern-valid evidence ids without path separators', () => {
    const first = evidenceId(source());
    expect(first).toBe('src:app-login-page.tsx:10-20');
    expect(first).toMatch(evidencePattern);
    expect(first).not.toContain('/');
    expect(evidenceId(source())).toBe(first);
    expect(evidenceId(runtime())).toMatch(evidencePattern);
    expect(evidenceId(document())).toMatch(evidencePattern);
  });

  it('treats minimal evidence metadata as delimited data and excludes secret-bearing fields', () => {
    const ref = { ...source(), ruleId: 'nextjs-login' };
    const messages = buildInferenceMessages([ref], 2);
    const bytes = JSON.stringify(messages);

    expect(messages[0]).toMatchObject({ role: 'system' });
    expect(messages[0]?.content.toLowerCase()).toContain('data');
    expect(messages[1]?.content).toContain('EVIDENCE_DATA');
    expect(messages[1]?.content).toContain('END_EVIDENCE_DATA');
    expect(messages[1]?.content).toContain('app/login/page.tsx');
    expect(bytes).not.toContain(ref.blobSha256);
    expect(bytes).not.toContain(ref.repo);
    expect(bytes).not.toContain(ref.commit);
    expect(bytes).not.toContain('PRIVATE-PROMPT-CANARY');
    expect(messages.at(-1)).toMatchObject({ role: 'system' });
    expect(messages.at(-1)?.content).toContain('Prior structured output was invalid');
  });

  it('maps malformed validated output fail-closed to no candidates', () => {
    expect(mapStage4Candidates({ candidates: 'invalid' }, [source()])).toEqual({
      requestId: 'stage4-inference',
      candidates: [],
    });
    expect(
      mapStage4Candidates({ schemaVersion: STAGE4_SCHEMA_VERSION, candidates: [] }, [source()]),
    ).toEqual({ requestId: 'stage4-inference', candidates: [] });
  });

  it('deduplicates evidence ids when distinct rules match the same code span', () => {
    const refs = [
      { ...source(), ruleId: 'nextjs-login-route' },
      { ...source(), ruleId: 'nextjs-login-guard' },
    ];
    const { candidates } = mapStage4Candidates(
      {
        schemaVersion: STAGE4_SCHEMA_VERSION,
        candidates: [{ id: 'authentication.login', intent: 'i' }],
      },
      refs,
    );
    const ids = candidates[0]?.evidenceRefs ?? [];
    expect(new Set(ids).size).toBe(ids.length);
    expect(candidates[0]?.workflow?.evidenceRefs).toEqual(ids);
  });

  it('short-circuits empty source evidence without contacting the model (observed)', async () => {
    const requestStructuredOutput = vi.fn(() => {
      throw new Error('model must not be called');
    });
    const outcome = await runStage4Inference({
      adapter: { requestStructuredOutput } as unknown as ModelAdapter,
      model: 'test-model-v1',
      evidenceRefs: [runtime(), document()],
      runId: 'empty-run',
    });

    expect(outcome).toEqual({
      ok: true,
      result: { requestId: 'stage4-empty-empty-run', candidates: [] },
    });
    expect(requestStructuredOutput).not.toHaveBeenCalled();
  });

  it('preserves injection-block diagnostics for action-layer blocked classification', async () => {
    const diagnostic: Diagnostic = {
      code: 'ARXIC-MODEL-STRUCTURED-OUTPUT-INVALID',
      severity: 'blocked',
      subject: 'structured-output',
      message: 'Instruction-like provider output was blocked',
    };
    const outcome = await runStage4Inference({
      adapter: adapterWith({ ok: false, diagnostics: [diagnostic], runRecord: {} }),
      model: 'test-model-v1',
      evidenceRefs: [source()],
      runId: 'blocked-run',
    });

    expect(outcome).toEqual({ ok: false, diagnostics: [diagnostic] });
  });

  it('preserves schema-version drift diagnostics', async () => {
    const diagnostic: Diagnostic = {
      code: 'ARXIC-MODEL-SCHEMA-VERSION-DRIFT',
      severity: 'blocked',
      subject: 'structured-output.schemaVersion',
      message: 'Schema version drift',
    };
    const outcome = await runStage4Inference({
      adapter: adapterWith({ ok: false, diagnostics: [diagnostic], runRecord: {} }),
      model: 'test-model-v1',
      evidenceRefs: [source()],
      runId: 'drift-run',
    });

    expect(outcome).toMatchObject({ ok: false, diagnostics: [diagnostic] });
  });

  it('preserves exhausted-validation diagnostics', async () => {
    const diagnostic: Diagnostic = {
      code: 'ARXIC-MODEL-RETRIES-EXHAUSTED',
      severity: 'blocked',
      subject: 'structured-output',
      message: 'Structured output remained invalid',
    };
    const outcome = await runStage4Inference({
      adapter: adapterWith({ ok: false, diagnostics: [diagnostic], runRecord: {} }),
      model: 'test-model-v1',
      evidenceRefs: [source()],
      runId: 'exhausted-run',
    });

    expect(outcome).toEqual({ ok: false, diagnostics: [diagnostic] });
  });

  it('converts adapter failure and thrown provider errors to undefined for bounded retries', async () => {
    const blocked = stage4Infer(
      adapterWith({ ok: false, diagnostics: [], runRecord: {} }),
      'test-model-v1',
    );
    const throwing = stage4Infer(
      {
        requestStructuredOutput: async () => {
          throw new Error('provider disconnected');
        },
      } as unknown as ModelAdapter,
      'test-model-v1',
    );

    await expect(blocked({ runId: 'blocked', evidenceRefs: [source()] })).resolves.toBeUndefined();
    await expect(
      throwing({ runId: 'throwing', evidenceRefs: [source()] }),
    ).resolves.toBeUndefined();
  });
});

describe('stage-4 inference service happy path', () => {
  it('maps lightweight output to schema-valid, evidence-backed hypotheses', () => {
    const neighbourhood = [source()];
    const result = mapStage4Candidates(
      {
        schemaVersion: STAGE4_SCHEMA_VERSION,
        candidates: [
          {
            id: 'authentication.login',
            intent: 'submit the login form',
            status: 'verified',
          },
        ],
      },
      neighbourhood,
    );
    const candidate = result.candidates[0];

    expect(result.candidates).toHaveLength(1);
    expect(candidate).toMatchObject({
      id: 'authentication.login',
      title: 'submit the login form',
      evidenceRefs: [evidenceId(neighbourhood[0])],
    });
    expect(candidate?.workflow?.status).toBe('hypothesized');
    expect(candidate?.workflow && validateWorkflow(candidate.workflow).ok).toBe(true);
    expect(candidate?.workflow?.transitions[0]?.assertions.length).toBeGreaterThanOrEqual(1);
    expect(candidate?.workflow?.evidenceRefs.every((ref) => evidencePattern.test(ref))).toBe(true);
  });

  it('returns the real provider request id and exactly one adapter-boundary result', async () => {
    const adapter = successfulAdapter('chatcmpl-real-request');
    const outcome = await runStage4Inference({
      adapter,
      model: 'test-model-v1',
      evidenceRefs: [source()],
      runId: 'happy-run',
    });

    expect(outcome).toMatchObject({
      ok: true,
      result: { requestId: 'chatcmpl-real-request', candidates: [{ id: 'authentication.login' }] },
    });
    expect(adapter.requestStructuredOutput).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0, schemaVersion: STAGE4_SCHEMA_VERSION }),
    );
  });

  it('exposes successful and empty outcomes through the orchestrator seam', async () => {
    await expect(
      stage4Infer(
        successfulAdapter(),
        'test-model-v1',
      )({ runId: 'happy', evidenceRefs: [source()] }),
    ).resolves.toMatchObject({ candidates: [{ id: 'authentication.login' }] });
    await expect(
      stage4Infer(successfulAdapter(), 'test-model-v1')({ runId: 'empty', evidenceRefs: [] }),
    ).resolves.toEqual({ requestId: 'stage4-empty-empty', candidates: [] });
  });
});
