import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { Workbench } from '../workbench';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it('blocks unapproved capture, then detects a real frontend regression without replacing the approved baseline', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'web-visual');
  cleanups.push(async () => {
    await stopApp(target.child);
    await rm(target.runtimeDirectory, { recursive: true, force: true });
  });
  let changed = false;
  const proxy = createServer(async (_req, res) => {
    const html = await (await fetch(target.origin)).text();
    res.setHeader('Content-Type', 'text/html');
    res.end(
      html.replace(
        '</head>',
        `<style>body { background: ${changed ? '#c00030' : '#ffffff'}; ${changed ? 'min-width: 1800px;' : ''} }</style></head>`,
      ),
    );
  });
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
  cleanups.push(async () => {
    proxy.closeAllConnections();
    await new Promise<void>((done) => proxy.close(() => done()));
  });
  const address = proxy.address() as { port: number };
  const state = await mkdtemp(join(tmpdir(), 'web-visual-state-'));
  cleanups.push(() => rm(state, { recursive: true, force: true }));
  const wb = await Workbench.open(state, [root]);
  cleanups.push(() => wb.close());
  const config = {
    name: 'Real frontend',
    folder: join(root, 'test-fixtures/vulnerable-auth-app'),
    origin: `http://127.0.0.1:${address.port}`,
    viewports: [{ width: 800, height: 600 }],
  };
  const project = await wb.saveProject(config);
  const denied = wb.enqueue(project.id, 'visual');
  await wb.idle();
  expect(wb.store.run(denied.id)?.result).toMatchObject({ outcome: 'blocked' });
  await wb.saveProject({ ...config, captureConsent: true }, project.id);
  const first = wb.enqueue(project.id, 'visual');
  await wb.idle();
  const capture = wb.store.run(first.id)!.result!.captures![0];
  expect(capture.status).toBe('needs-baseline');
  await wb.approveBaseline(first.id, capture.id);
  await expect(wb.deleteRun(first.id)).rejects.toThrow('approved baselines');
  const second = wb.enqueue(project.id, 'visual');
  await wb.idle();
  expect(wb.store.run(second.id)?.result?.captures?.[0]).toMatchObject({
    status: 'unchanged',
    changedPixels: 0,
    baselineRunId: first.id,
  });
  changed = true;
  const third = wb.enqueue(project.id, 'visual');
  await wb.idle();
  const result = wb.store.run(third.id)!.result!;
  expect(result.captures?.[0]).toMatchObject({ status: 'changed', baselineRunId: first.id });
  expect(result.captures![0].changedPixels).toBeGreaterThan(100_000);
  expect(result.findings).toContainEqual({ path: '/', kind: 'horizontal-overflow', count: 1 });
  expect(wb.store.baseline(project.id, capture.specHash)?.run_id).toBe(first.id);
  const timeline = await readFile(join(state, 'runs', third.id, 'timeline.json'), 'utf8');
  expect(timeline).not.toContain('cookie');
  await writeFile(join(state, 'runs', third.id, result.captures![0].file), 'tampered image');
  await expect(wb.approveBaseline(third.id, result.captures![0].id)).rejects.toThrow('integrity');
  expect(wb.store.baseline(project.id, capture.specHash)?.run_id).toBe(first.id);
  await wb.saveProject(
    { ...config, captureConsent: true, masks: ['[data-private-does-not-exist]'] },
    project.id,
  );
  const unmasked = wb.enqueue(project.id, 'visual');
  await wb.idle();
  expect(wb.store.run(unmasked.id)?.result).toMatchObject({ outcome: 'blocked' });
}, 120_000);
