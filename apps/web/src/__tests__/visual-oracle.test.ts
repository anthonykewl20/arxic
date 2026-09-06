import { expect, it } from 'vitest';
import { collectVisualScene, assessVisualScene, type VisualScene } from '../visual-oracle';

const scene: VisualScene = {
  schemaVersion: 1,
  viewport: { width: 800, height: 600 },
  documentWidth: 1000,
  nodes: [],
  truncated: false,
};

it('never passes missing, unstable, or malformed scene evidence', () => {
  for (const current of [scene, { ...scene, documentWidth: NaN }]) {
    const report = assessVisualScene(current, { screenshotSha256: '', stable: false });
    expect(report.verdict).toBe('unverified');
    expect(report.checks.every((check) => check.verdict === 'unverified')).toBe(true);
  }
});

it('rejects malformed numeric evidence even when the screenshot is stable', () => {
  for (const current of [
    { ...scene, viewport: { width: 800, height: NaN } },
    { ...scene, nodes: [{ id: 0, parent: null, x: Infinity, y: 0, width: 1, height: 1 }] },
  ]) {
    expect(
      assessVisualScene(current, { screenshotSha256: 'a'.repeat(64), stable: true }).verdict,
    ).toBe('unverified');
  }
});

it('keeps a hard failure when every model-dependent family is unavailable', () => {
  const report = assessVisualScene(scene, { screenshotSha256: 'a'.repeat(64), stable: true });
  expect(report.verdict).toBe('fail');
  expect(report.checks[0]).toMatchObject({ verdict: 'fail', delta: 200 });
  expect(report.coverage.complete).toBe(false);
});

it('records a checked predicate pass without turning coverage gaps green', () => {
  const report = assessVisualScene(
    { ...scene, documentWidth: 800, truncated: true },
    {
      screenshotSha256: 'a'.repeat(64),
      stable: true,
    },
  );
  expect(report.checks[0]).toMatchObject({ verdict: 'pass', delta: 0 });
  expect(report.verdict).toBe('unverified');
  expect(report.coverage.gaps).toContain('node-budget-exhausted');
});

it('rejects non-numeric browser output before it can become retained evidence', async () => {
  const page = {
    evaluate: async () => ({
      ...scene,
      nodes: [{ id: 0, parent: null, x: 'private-browser-value', y: 0, width: 1, height: 1 }],
    }),
  } as unknown as Parameters<typeof collectVisualScene>[0];
  await expect(collectVisualScene(page)).rejects.toThrow('Invalid numeric scene evidence');
});
