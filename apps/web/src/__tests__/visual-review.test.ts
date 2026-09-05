import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { Workbench } from '../workbench';

it('requires inspected pixels, preserves source evidence and blocks ungrounded AI regions', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'web-image-review');
  const state = await mkdtemp(join(tmpdir(), 'arxic-review-test-'));
  const requests: unknown[] = [];
  let invalid: false | 'schema' | 'outside' = false;
  const provider = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        id: 'image-review-boundary',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                schemaVersion: 'arxic-web-visual-review-v1',
                findings: [
                  {
                    title: 'Inspect form alignment',
                    description: 'Form controls appear unevenly aligned in this viewport.',
                    severity: 'warning',
                    region: {
                      x: invalid === 'outside' ? 750 : 8,
                      y: 100,
                      width: invalid === 'schema' ? 9999 : invalid === 'outside' ? 100 : 700,
                      height: 250,
                    },
                    suggestedCheck:
                      'Compare the alignment of labels and controls at this viewport.',
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
  vi.stubEnv('ARXIC_MODEL_PROVIDER', 'http');
  vi.stubEnv(
    'ARXIC_MODEL_BASE_URL',
    `http://127.0.0.1:${(provider.address() as { port: number }).port}`,
  );
  vi.stubEnv('ARXIC_MODEL_API_KEY', 'review-provider-canary');
  const wb = await Workbench.open(state, [root]);
  try {
    const project = await wb.saveProject({
      name: 'Review reference',
      folder: join(root, 'test-fixtures/vulnerable-auth-app'),
      origin: target.origin,
      viewports: [{ width: 800, height: 600 }],
      captureConsent: true,
    });
    const run = wb.enqueue(project.id, 'visual');
    await wb.idle();
    const capture = wb.store.run(run.id)!.result!.captures![0];
    const input = {
      captureId: capture.id,
      sha256: capture.sha256,
      inspectedAndAuthorized: true,
      model: 'gpt-4o-mini',
      budgetUsd: 0.1,
      acceptanceCriterion: 'Labels and fields should align at the configured viewport.',
    };
    await expect(
      wb.enqueueVisualReview(run.id, { ...input, inspectedAndAuthorized: false }),
    ).rejects.toThrow('inspect');
    await expect(
      wb.enqueueVisualReview(run.id, { ...input, sha256: '0'.repeat(64) }),
    ).rejects.toThrow('changed');
    expect(requests).toHaveLength(0);
    const missingSecret = await wb.enqueueVisualReview(run.id, {
      ...input,
      modelSecretRef: 'ARXIC_SECRET_MISSING_REVIEW_TEST',
    });
    await wb.idle();
    expect(wb.store.run(missingSecret.id)?.result).toMatchObject({ outcome: 'blocked' });
    expect(requests).toHaveLength(0);
    vi.stubEnv('ARXIC_SECRET_REVIEW_TEST', 'selected-review-secret-canary');
    const review = await wb.enqueueVisualReview(run.id, {
      ...input,
      modelSecretRef: 'ARXIC_SECRET_REVIEW_TEST',
    });
    await wb.idle();
    const result = wb.store.run(review.id)!.result!;
    expect(result.outcome).toBe('hypothesized');
    expect(result.review).toMatchObject({
      sourceRunId: run.id,
      capture: { sha256: capture.sha256 },
      acceptanceCriterion: input.acceptanceCriterion,
      findings: [{ truthState: 'hypothesized', region: { x: 8, y: 100, width: 700, height: 250 } }],
    });
    const png = await readFile(join(state, 'runs', run.id, capture.file));
    expect(JSON.stringify(requests[0]).includes(png.toString('base64'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('review-provider-canary');
    expect(JSON.stringify(result)).not.toContain('selected-review-secret-canary');
    await expect(wb.deleteRun(run.id)).rejects.toThrow('review');
    invalid = 'schema';
    const outside = await wb.enqueueVisualReview(run.id, input);
    await wb.idle();
    expect(wb.store.run(outside.id)?.result).toMatchObject({ outcome: 'blocked' });
    invalid = 'outside';
    const overflow = await wb.enqueueVisualReview(run.id, input);
    await wb.idle();
    expect(wb.store.run(overflow.id)?.result).toMatchObject({
      outcome: 'blocked',
      summary: expect.stringContaining('outside the screenshot'),
    });
    const budget = await wb.enqueueVisualReview(run.id, { ...input, budgetUsd: 0.000001 });
    await wb.idle();
    expect(wb.store.run(budget.id)?.result).toMatchObject({
      outcome: 'blocked',
      summary: expect.stringContaining('budget'),
    });
    await writeFile(join(state, 'runs', run.id, capture.file), 'tampered');
    await expect(wb.enqueueVisualReview(run.id, input)).rejects.toThrow('integrity');
    expect(requests).toHaveLength(3);
  } finally {
    await wb.close();
    vi.unstubAllEnvs();
    provider.closeAllConnections();
    await new Promise<void>((done) => provider.close(() => done()));
    await stopApp(target.child);
    await rm(target.runtimeDirectory, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  }
}, 60_000);

it.runIf(process.platform === 'linux')(
  'cancels a real host image provider and removes its private attachment',
  async () => {
    const root = resolve(import.meta.dirname, '../../../..');
    const target = await bootFixtureApp(root, vulnerableAuthApp, 'web-image-cancel');
    const state = await mkdtemp(join(tmpdir(), 'arxic-review-cancel-'));
    const marker = join(state, 'provider.json');
    vi.stubEnv('ARXIC_MODEL_PROVIDER', 'host-cli');
    vi.stubEnv('ARXIC_MODEL_HOST_CLI', process.execPath);
    vi.stubEnv(
      'ARXIC_MODEL_HOST_CLI_ARGS',
      JSON.stringify([
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,file:process.argv[1]}));process.stdin.resume();setInterval(()=>{},1000)`,
      ]),
    );
    vi.stubEnv('ARXIC_MODEL_HOST_CLI_IMAGE_ARGS', '["{image}"]');
    const wb = await Workbench.open(state, [root]);
    let provider: { pid: number; file: string } | undefined;
    try {
      const project = await wb.saveProject({
        name: 'Cancelled image review',
        folder: join(root, 'test-fixtures/vulnerable-auth-app'),
        origin: target.origin,
        viewports: [{ width: 800, height: 600 }],
        captureConsent: true,
      });
      const run = wb.enqueue(project.id, 'visual');
      await wb.idle();
      const capture = wb.store.run(run.id)!.result!.captures![0];
      const review = await wb.enqueueVisualReview(run.id, {
        captureId: capture.id,
        sha256: capture.sha256,
        inspectedAndAuthorized: true,
        model: 'host-image-probe',
        budgetUsd: 0.1,
        acceptanceCriterion: '',
      });
      await expect
        .poll(
          async () => {
            try {
              provider = JSON.parse(await readFile(marker, 'utf8'));
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 15_000 },
        )
        .toBe(true);
      await wb.cancel(review.id);
      await wb.idle();
      await expect
        .poll(
          async () => {
            try {
              return !(await readFile(`/proc/${provider!.pid}/stat`, 'utf8')).includes(') Z ');
            } catch {
              return false;
            }
          },
          { timeout: 3000 },
        )
        .toBe(false);
      await expect(readFile(provider!.file)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(wb.store.run(review.id)?.state).toBe('cancelled');
    } finally {
      if (provider) {
        try {
          process.kill(provider.pid, 'SIGKILL');
        } catch {
          /* Test provider already exited. */
        }
        await rm(provider.file, { force: true });
      }
      await wb.close();
      vi.unstubAllEnvs();
      await stopApp(target.child);
      await rm(target.runtimeDirectory, { recursive: true, force: true });
      await rm(state, { recursive: true, force: true });
    }
  },
  60_000,
);
