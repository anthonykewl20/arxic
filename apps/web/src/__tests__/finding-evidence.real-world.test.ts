import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { Workbench } from '../workbench';

const root = resolve(import.meta.dirname, '../../../..');
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const FINDING = {
  title: 'Inspect form alignment',
  description: 'Form controls appear unevenly aligned in this viewport.',
  severity: 'warning',
  region: { x: 8, y: 100, width: 700, height: 250 },
  suggestedCheck: 'Compare the alignment of labels and controls at this viewport.',
};

/**
 * Per-finding evidence, reproduction and independent acceptance (refs #402):
 * every asserted defect is stamped server-side with the exact screenshot
 * identity, a reproduction recipe from the real capture, and its acceptance
 * status — the administrator criterion when supplied, an explicit gap when
 * not. The model can never author its own grounding: injecting evidence into
 * its output is refused by the closed schema.
 */
it('stamps every finding with screenshot evidence, reproduction and acceptance status', async () => {
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'web-finding-evidence');
  cleanups.push(() => stopApp(target.child));
  let injectEvidence = false;
  const provider = createServer(async (_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        id: 'finding-evidence-stub',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                schemaVersion: 'arxic-web-visual-review-v1',
                findings: [
                  {
                    ...FINDING,
                    // A model attempt to author its own grounding (anti-SLOP pin).
                    ...(injectEvidence
                      ? {
                          evidence: { screenshot: { runId: 'forged', sha256: '0'.repeat(64) } },
                        }
                      : {}),
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
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
  vi.stubEnv('ARXIC_SECRET_REVIEW_TEST', 'finding-evidence-secret-canary');

  const state = await mkdtemp(join(tmpdir(), 'arxic-finding-evidence-'));
  cleanups.push(() => rm(state, { recursive: true, force: true }));
  const wb = await Workbench.open(state, [root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Finding evidence',
    folder: join(root, 'test-fixtures/vulnerable-auth-app'),
    origin: target.origin,
    viewports: [{ width: 800, height: 600 }],
    captureConsent: true,
  });
  const run = wb.enqueue(project.id, 'visual');
  await wb.idle();
  const capture = wb.store.run(run.id)!.result!.captures!.at(-1)!;

  const withCriterion = await wb.enqueueVisualReview(run.id, {
    captureId: capture.id,
    sha256: capture.sha256,
    inspectedAndAuthorized: true,
    model: 'gpt-4o-mini',
    modelSecretRef: 'ARXIC_SECRET_REVIEW_TEST',
    budgetUsd: 0.1,
    acceptanceCriterion: 'Labels and fields should align at the configured viewport.',
  });
  await wb.idle();
  const stamped = wb.store.run(withCriterion.id)!.result!.review!.findings[0]!;
  // Screenshot identity: the exact authorized capture this finding asserts.
  expect(stamped.evidence.screenshot).toEqual({
    runId: run.id,
    captureId: capture.id,
    file: capture.file,
    sha256: capture.sha256,
    environment: capture.environment,
    viewport: capture.viewport,
  });
  // Reproduction recipe from the real capture.
  expect(stamped.evidence.reproduction).toEqual({
    path: capture.path,
    viewport: capture.viewport,
    environment: capture.environment,
    deviceScaleFactor: capture.environment?.deviceScaleFactor ?? 1,
    browserVersion: capture.browserVersion,
  });
  // Acceptance: the administrator criterion covers it; the model check stays
  // labeled as suggested, never independent.
  expect(stamped.acceptance).toEqual({
    source: 'administrator',
    independent: 'Labels and fields should align at the configured viewport.',
    suggestedCheck: FINDING.suggestedCheck,
  });

  const withoutCriterion = await wb.enqueueVisualReview(run.id, {
    captureId: capture.id,
    sha256: capture.sha256,
    inspectedAndAuthorized: true,
    model: 'gpt-4o-mini',
    modelSecretRef: 'ARXIC_SECRET_REVIEW_TEST',
    budgetUsd: 0.1,
    acceptanceCriterion: '',
  });
  await wb.idle();
  const gapped = wb.store.run(withoutCriterion.id)!.result!.review!.findings[0]!;
  expect(gapped.acceptance).toEqual({
    source: 'none',
    independent: null,
    suggestedCheck: FINDING.suggestedCheck,
  });
  expect(gapped.evidence.screenshot.sha256).toBe(capture.sha256);

  // Anti-SLOP: the model authoring its own evidence is refused, not absorbed.
  injectEvidence = true;
  const forged = await wb.enqueueVisualReview(run.id, {
    captureId: capture.id,
    sha256: capture.sha256,
    inspectedAndAuthorized: true,
    model: 'gpt-4o-mini',
    modelSecretRef: 'ARXIC_SECRET_REVIEW_TEST',
    budgetUsd: 0.1,
    acceptanceCriterion: '',
  });
  await wb.idle();
  const forgedResult = wb.store.run(forged.id)!.result!;
  expect(forgedResult.outcome).toBe('blocked');
  expect(JSON.stringify(forgedResult)).not.toContain('forged');

  // Secrets never serialize into review records.
  const serialized = JSON.stringify(wb.store.run(withCriterion.id)!.result);
  expect(serialized).not.toContain('finding-evidence-secret-canary');
}, 240_000);
