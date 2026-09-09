import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { Workbench } from '../workbench';
import type { VisualScene } from '../visual-oracle';

const root = resolve(import.meta.dirname, '../../../..');
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * Deterministic per-finding determination on the real harness (refs #402): a
 * provider finding placed on a REAL masked input's retained rect is refuted
 * by the retained geometry; a finding over clean passing pixels is explicitly
 * unconfirmed. The determinations come from the capture's own hash-verified
 * assessment evidence, never from the model.
 */
it('determines real findings from the retained mask geometry and assessment', async () => {
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'web-finding-determination');
  cleanups.push(() => stopApp(target.child));
  let regions: Array<{ x: number; y: number; width: number; height: number }> = [];
  const provider = createServer(async (_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        id: 'determination-stub',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                schemaVersion: 'arxic-web-visual-review-v1',
                findings: regions.map((region, index) => ({
                  title: `Finding ${index + 1}`,
                  description: 'A finding placed by the test at a specific region.',
                  severity: 'warning',
                  region,
                  suggestedCheck: 'Deterministic re-check of this region.',
                })),
              }),
            },
          },
        ],
        usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 },
      }),
    );
  });
  await new Promise<void>((done) => provider.listen(0, '127.0.0.1', done));
  cleanups.push(() => new Promise<void>((done) => provider.close(() => done())));
  vi.stubEnv('ARXIC_MODEL_PROVIDER', 'http');
  vi.stubEnv(
    'ARXIC_MODEL_BASE_URL',
    `http://127.0.0.1:${(provider.address() as { port: number }).port}`,
  );
  vi.stubEnv('ARXIC_SECRET_DETERMINATION', 'determination-secret-canary');

  const state = await mkdtemp(join(tmpdir(), 'arxic-finding-determination-'));
  cleanups.push(() => rm(state, { recursive: true, force: true }));
  const wb = await Workbench.open(state, [root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Finding determination',
    folder: join(root, 'test-fixtures/vulnerable-auth-app'),
    origin: target.origin,
    viewports: [{ width: 800, height: 600 }],
    captureConsent: true,
  });
  const run = wb.enqueue(project.id, 'visual');
  await wb.idle();
  const capture = wb.store.run(run.id)!.result!.captures!.at(-1)!;

  // Read the retained assessment: the real masked rects come from the real
  // capture's own evidence (hash-covered by the capture record).
  const assessment = JSON.parse(
    await readFile(join(state, 'runs', run.id, capture.assessmentFile!), 'utf8'),
  ) as {
    scene: VisualScene & {
      maskedRects?: Array<{ x: number; y: number; width: number; height: number }>;
    };
  };
  const maskedRects = assessment.scene.maskedRects ?? [];
  expect(maskedRects.length).toBeGreaterThan(0);
  const input = maskedRects[0]!;

  const round = (value: number) => Math.max(0, Math.round(value));
  regions = [
    // A finding squarely on the first real masked input (integer pixels —
    // real DOM rects are fractional; the review schema wants integers).
    {
      x: round(input.x + 2),
      y: round(input.y + 2),
      width: Math.max(8, round(input.width - 4)),
      height: Math.max(8, round(input.height - 4)),
    },
    // A finding over clean pixels near the top-left, away from controls.
    { x: 4, y: 4, width: 60, height: 20 },
  ];
  const review = await wb.enqueueVisualReview(run.id, {
    captureId: capture.id,
    sha256: capture.sha256,
    inspectedAndAuthorized: true,
    model: 'gpt-4o-mini',
    modelSecretRef: 'ARXIC_SECRET_DETERMINATION',
    budgetUsd: 0.1,
    acceptanceCriterion: 'Labels and fields should align at the configured viewport.',
  });
  await wb.idle();
  const reviewResult = wb.store.run(review.id)!.result!;
  if (!reviewResult.review) console.log('REVIEW-DEBUG:', reviewResult.summary);
  const findings = reviewResult.review?.findings ?? [];
  expect(findings).toHaveLength(2);
  expect(findings[0]!.determination).toMatchObject({
    determination: 'refuted',
    reason: 'masked-region',
  });
  expect(findings[1]!.determination).toEqual({
    determination: 'unconfirmed',
    reason: 'no-deterministic-corroboration',
  });
  // Determinations never serialize secrets.
  const serialized = JSON.stringify(wb.store.run(review.id)!.result);
  expect(serialized).not.toContain('determination-secret-canary');
}, 240_000);
