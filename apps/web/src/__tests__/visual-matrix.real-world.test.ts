import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { firefox } from 'playwright';
import { captureVisual } from '../visual';
import { validateProject } from '../projects';
import { Workbench } from '../workbench';

it('keeps real browser/theme baselines independent and detects a dark-only regression', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'visual-matrix');
  const state = await mkdtemp(join(tmpdir(), 'visual-matrix-'));
  const agents = new Set<string>();
  let changed = false;
  const proxy = createServer(async (req, res) => {
    agents.add(req.headers['user-agent'] ?? '');
    const html = await (await fetch(target.origin)).text();
    res.setHeader('Content-Type', 'text/html');
    res.end(
      html.replace(
        '</head>',
        `<style>body{background:#fff;color:#111} @media(prefers-color-scheme:dark){body{background:${changed ? '#603020' : '#171717'};color:#fff}}</style></head>`,
      ),
    );
  });
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
  const wb = await Workbench.open(state, [root]);
  try {
    const project = await wb.saveProject({
      name: 'Real environment matrix',
      folder: join(root, 'test-fixtures/vulnerable-auth-app'),
      origin: `http://127.0.0.1:${(proxy.address() as { port: number }).port}`,
      captureConsent: true,
      viewports: [
        { width: 800, height: 600 },
        { width: 390, height: 844 },
      ],
      browsers: ['chromium', 'firefox', 'webkit'],
      colorSchemes: ['light', 'dark'],
    });
    const first = wb.enqueue(project.id, 'visual');
    await wb.idle();
    const result = wb.store.run(first.id)!.result!;
    expect(result.outcome, JSON.stringify(result)).toBe('observed');
    expect(result.captures).toHaveLength(12);
    expect(new Set(result.captures!.map((c) => c.specHash)).size).toBe(12);
    expect(result.visualEnvironments).toHaveLength(6);
    for (const c of result.captures!) await wb.approveBaseline(first.id, c.id);
    const second = wb.enqueue(project.id, 'visual');
    await wb.idle();
    expect(wb.store.run(second.id)!.result!.captures).toHaveLength(12);
    for (const c of wb.store.run(second.id)!.result!.captures!) {
      expect(c).toMatchObject({ status: 'unchanged', changedPixels: 0, baselineRunId: first.id });
      expect(c.baselineFile).toBe(
        result.captures!.find((old) => old.specHash === c.specHash)!.file,
      );
    }
    changed = true;
    const third = wb.enqueue(project.id, 'visual');
    await wb.idle();
    const final = wb.store.run(third.id)!.result!;
    expect(final.outcome).toBe('observed');
    expect(final.captures).toHaveLength(12);
    for (const c of final.captures!)
      expect(c.status).toBe(c.environment!.colorScheme === 'dark' ? 'changed' : 'unchanged');
    if (process.env.ARXIC_MATRIX_ENGINE_EVIDENCE_DIR) {
      const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const dirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
      for (const [label, runId] of [
        ['baseline', first.id],
        ['repeat', second.id],
        ['dark-regression', third.id],
      ]) {
        const destination = join(process.env.ARXIC_MATRIX_ENGINE_EVIDENCE_DIR, label);
        await mkdir(destination, { recursive: true });
        const evidence = wb.store.run(runId)!.result!;
        for (const file of [
          'timeline.json',
          'timeline.sanitization.json',
          ...evidence.captures!.flatMap((c) => [
            c.file,
            `${c.file}.privacy.json`,
            c.assessmentFile!,
          ]),
        ])
          await writeFile(join(destination, file), (await wb.artifact(runId, file)).bytes);
        await writeFile(
          join(destination, 'result.json'),
          JSON.stringify({ sourceCommit, dirty, result: evidence }),
        );
      }
    }
    expect([...agents].some((a) => a.includes('Firefox/'))).toBe(true);
    expect([...agents].some((a) => a.includes('HeadlessChrome/'))).toBe(true);
    expect([...agents].some((a) => a.includes('Safari/') && !a.includes('Chrome/'))).toBe(true);
  } finally {
    await wb.close();
    proxy.closeAllConnections();
    await new Promise<void>((done) => proxy.close(() => done()));
    await stopApp(target.child);
    await rm(target.runtimeDirectory, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  }
}, 120_000);

it('retains real Chromium evidence when a separate browser cannot launch', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'matrix-partial');
  const directory = await mkdtemp(join(tmpdir(), 'matrix-partial-'));
  const failure = vi.spyOn(firefox, 'launch').mockRejectedValue(new Error('private-error-marker'));
  try {
    const project = await validateProject(
      {
        name: 'Partial matrix',
        folder: root,
        origin: target.origin,
        captureConsent: true,
        browsers: ['chromium', 'firefox'],
        viewports: [{ width: 800, height: 600 }],
      },
      [root],
    );
    const result = await captureVisual(
      {
        id: 'partial',
        projectId: project.id,
        mode: 'visual',
        state: 'running',
        createdAt: new Date().toISOString(),
        finishedAt: null,
        project,
        result: null,
      },
      directory,
    );
    expect(result.outcome).toBe('blocked');
    expect(result.captures).toHaveLength(1);
    expect(result.visualEnvironments).toEqual([
      { browser: 'chromium', colorScheme: 'light', outcome: 'observed', captures: 1 },
      {
        browser: 'firefox',
        colorScheme: 'light',
        outcome: 'blocked',
        captures: 0,
        reason:
          'Environment could not start or complete. Check the installed Playwright browser and system dependencies.',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('private-error-marker');
  } finally {
    failure.mockRestore();
    await stopApp(target.child);
    await rm(target.runtimeDirectory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
