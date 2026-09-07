import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { Workbench } from '../workbench';

it('binds native density pixels to independent real browser baselines', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'visual-density');
  const state = await mkdtemp(join(tmpdir(), 'visual-density-state-'));
  let changed = false;
  const capturedRuns: string[] = [];
  const proxy = createServer(async (_request, response) => {
    const html = await (await fetch(target.origin)).text();
    response.setHeader('content-type', 'text/html');
    response.end(
      html.replace(
        '</head>',
        `<style>
      body { background: #fff; color: #111; }
      @media (resolution: 2dppx) { body { background: ${changed ? '#603020' : '#d0e0f0'}; } }
      @media (resolution: 3dppx) { body { background: #f0e0d0; } }
      </style></head>`,
      ),
    );
  });
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
  const wb = await Workbench.open(state, [root]);
  try {
    const project = await wb.saveProject({
      name: 'Native density reference',
      folder: join(root, 'test-fixtures/vulnerable-auth-app'),
      origin: `http://127.0.0.1:${(proxy.address() as { port: number }).port}`,
      captureConsent: true,
      browsers: ['chromium', 'firefox', 'webkit'],
      colorSchemes: ['light'],
      deviceScaleFactors: [1, 2, 3],
      viewports: [{ width: 800, height: 600 }],
    });
    const run = async () => {
      const queued = wb.enqueue(project.id, 'visual');
      await wb.idle();
      capturedRuns.push(queued.id);
      const result = wb.store.run(queued.id)!.result!;
      expect(result.outcome).toBe('observed');
      expect(result.captures).toHaveLength(9);
      expect(result.visualEnvironments).toHaveLength(9);
      expect(new Set(result.captures!.map((c) => c.file)).size).toBe(9);
      expect(new Set(result.captures!.map((c) => c.specHash)).size).toBe(9);
      for (const capture of result.captures!) {
        const density = capture.environment?.deviceScaleFactor ?? 1;
        const png = await sharp(join(state, 'runs', queued.id, capture.file)).metadata();
        expect([png.width, png.height]).toEqual([800 * density, 600 * density]);
        const scene = JSON.parse(
          await readFile(join(state, 'runs', queued.id, capture.assessmentFile!), 'utf8'),
        );
        expect(scene.scene.viewport).toEqual({ width: 800, height: 600 });
      }
      return { id: queued.id, result };
    };
    const first = await run();
    for (const capture of first.result.captures!) await wb.approveBaseline(first.id, capture.id);
    const repeat = await run();
    for (const capture of repeat.result.captures!) {
      expect(
        capture.status,
        JSON.stringify({
          environment: capture.environment,
          changedPixels: capture.changedPixels,
          ratio: capture.ratio,
        }),
      ).toBe('unchanged');
      expect(capture.baselineRunId).toBe(first.id);
      expect(capture.baselineFile).toBe(
        first.result.captures!.find((old) => old.specHash === capture.specHash)!.file,
      );
    }
    changed = true;
    const regression = await run();
    for (const capture of regression.result.captures!)
      expect(capture.status).toBe(
        capture.environment?.deviceScaleFactor === 2 ? 'changed' : 'unchanged',
      );
  } finally {
    try {
      const evidence = process.env.ARXIC_DENSITY_ENGINE_EVIDENCE_DIR;
      if (evidence) {
        for (const [index, id] of capturedRuns.entries()) {
          const destination = join(evidence, ['baseline', 'repeat', 'regression'][index]);
          await mkdir(destination, { recursive: true });
          const result = wb.store.run(id)!.result!;
          for (const file of [
            'timeline.json',
            'timeline.sanitization.json',
            ...(result.captures ?? []).flatMap((c) => [
              c.file,
              `${c.file}.privacy.json`,
              c.assessmentFile!,
            ]),
          ])
            await cp(join(state, 'runs', id, file), join(destination, file));
          await writeFile(join(destination, 'result.json'), JSON.stringify(result, null, 2));
        }
        await writeFile(
          join(evidence, 'source.json'),
          JSON.stringify(
            {
              sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
              dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
            },
            null,
            2,
          ),
        );
      }
    } finally {
      await wb.close();
      proxy.closeAllConnections();
      await new Promise<void>((done) => proxy.close(() => done()));
      await stopApp(target.child);
      await rm(target.runtimeDirectory, { recursive: true, force: true });
      await rm(state, { recursive: true, force: true });
    }
  }
}, 180_000);
