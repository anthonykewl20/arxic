import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { Workbench } from '../workbench';
import { reviewImage } from '../visual-review';

it('reads an authorized native 2x capture without relaxing model image limits', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'density-review');
  const state = await mkdtemp(join(tmpdir(), 'density-review-'));
  const wb = await Workbench.open(state, [root]);
  try {
    const project = await wb.saveProject({
      name: 'Density review',
      folder: join(root, 'test-fixtures/vulnerable-auth-app'),
      origin: target.origin,
      captureConsent: true,
      deviceScaleFactors: [2, 3],
      viewports: [{ width: 800, height: 600 }],
    });
    const run = wb.enqueue(project.id, 'visual');
    await wb.idle();
    const captures = wb.store.run(run.id)!.result!.captures!;
    expect(captures).toHaveLength(2);
    const scope = (density: number) => ({
      sourceRunId: run.id,
      capture: captures.find((c) => c.environment?.deviceScaleFactor === density)!,
    });
    await expect(reviewImage(join(state, 'runs'), scope(3))).rejects.toThrow();
    const image = await reviewImage(join(state, 'runs'), scope(2));
    expect(image.metadata).toMatchObject({ width: 1600, height: 1200 });
    expect(image.sha256).toBe(scope(2).capture.sha256);
  } finally {
    await wb.close();
    await stopApp(target.child);
    await rm(target.runtimeDirectory, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  }
}, 60_000);
