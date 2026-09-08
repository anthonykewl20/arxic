import { expect, it } from 'vitest';
import { explainDiffRegions } from '../diff-explanation';
import type { VisualCheck, VisualScene } from '../visual-oracle';

const scene = (nodes: VisualScene['nodes'], truncated = false): VisualScene => ({
  schemaVersion: 1,
  kindSchemaVersion: 1,
  viewport: { width: 800, height: 600 },
  documentWidth: 800,
  nodes,
  truncated,
});

it('joins a diff region with the innermost intersecting elements and their coverage', () => {
  const explanation = explainDiffRegions({
    diffRegions: [{ x: 100, y: 50, width: 200, height: 100 }],
    deviceScaleFactor: 1,
    scene: scene([
      { id: 0, parent: null, kind: 7, x: 0, y: 0, width: 800, height: 600 },
      { id: 1, parent: 0, kind: 5, x: 120, y: 60, width: 100, height: 40 },
      { id: 2, parent: 0, kind: 1, x: 300, y: 300, width: 50, height: 20 },
    ]),
    checks: [],
    assessmentSha256: 'a'.repeat(64),
  });
  expect(explanation.regions).toHaveLength(1);
  const region = explanation.regions[0];
  expect(region.unexplained).toBe(false);
  expect(region.cssBox).toEqual({ x: 100, y: 50, width: 200, height: 100 });
  // Deepest first: the heading (depth 1) covers 4000/20000 of the region.
  expect(region.elements[0]).toMatchObject({
    label: 'Heading',
    box: { x: 120, y: 60, width: 100, height: 40 },
    coverage: 0.2,
  });
  // The outer region node is listed after the more specific heading.
  expect(region.elements.map((element) => element.label)).toEqual(['Heading', 'Region']);
  expect(explanation.unexplainedRegions).toBe(0);
});

it('divides image-pixel regions by the device scale factor before joining the CSS-pixel scene', () => {
  const explanation = explainDiffRegions({
    diffRegions: [{ x: 200, y: 100, width: 400, height: 200 }],
    deviceScaleFactor: 2,
    scene: scene([{ id: 0, parent: null, kind: 5, x: 100, y: 50, width: 200, height: 100 }]),
    checks: [],
  });
  expect(explanation.regions[0].cssBox).toEqual({ x: 100, y: 50, width: 200, height: 100 });
  expect(explanation.regions[0].elements[0]).toMatchObject({ label: 'Heading' });
  expect(explanation.deviceScaleFactor).toBe(2);
});

it('lists failing checks that intersect the region and document-level non-pass checks separately', () => {
  const checks: VisualCheck[] = [
    {
      id: 'text-contrast-3',
      kind: 'hard',
      verdict: 'fail',
      expected: '>= 4.5',
      measurementIds: ['tp-3'],
      reason: '2.1 < 4.5',
      region: { x: 120, y: 60, width: 10, height: 10 },
    },
    {
      id: 'text-contrast-9',
      kind: 'hard',
      verdict: 'unverified',
      expected: '>= 4.5',
      measurementIds: ['tp-9'],
      reason: 'masked paint',
      region: { x: 120, y: 60, width: 5, height: 5 },
    },
    {
      id: 'text-contrast-7',
      kind: 'hard',
      verdict: 'pass',
      expected: '>= 4.5',
      measurementIds: ['tp-7'],
      reason: 'ok',
      region: { x: 120, y: 60, width: 5, height: 5 },
    },
    {
      id: 'document-horizontal-overflow',
      kind: 'hard',
      verdict: 'fail',
      expected: '0',
      measurementIds: [],
      reason: '1008px scroll width',
    },
    {
      id: 'elsewhere-contrast',
      kind: 'hard',
      verdict: 'fail',
      expected: '>= 4.5',
      measurementIds: ['tp-2'],
      reason: '2.0 < 4.5',
      region: { x: 700, y: 500, width: 20, height: 20 },
    },
  ];
  const explanation = explainDiffRegions({
    diffRegions: [{ x: 100, y: 50, width: 200, height: 100 }],
    deviceScaleFactor: 1,
    scene: scene([{ id: 0, parent: null, kind: 5, x: 110, y: 55, width: 50, height: 50 }]),
    checks,
    assessmentSha256: 'b'.repeat(64),
  });
  const region = explanation.regions[0];
  // Failing checks before unverified; passing and non-intersecting never listed.
  expect(region.checks.map((check) => check.id)).toEqual(['text-contrast-3', 'text-contrast-9']);
  expect(explanation.documentChecks.map((check) => check.id)).toEqual([
    'document-horizontal-overflow',
  ]);
});

it('preserves regions with no measured element as unexplained instead of attributing them', () => {
  const explanation = explainDiffRegions({
    diffRegions: [
      { x: 0, y: 0, width: 50, height: 50 },
      { x: 400, y: 400, width: 60, height: 60 },
    ],
    deviceScaleFactor: 1,
    scene: scene([{ id: 0, parent: null, kind: 4, x: 400, y: 400, width: 30, height: 30 }]),
    checks: [],
  });
  expect(explanation.regions[0].unexplained).toBe(true);
  expect(explanation.regions[0].elements).toEqual([]);
  expect(explanation.regions[1].unexplained).toBe(false);
  expect(explanation.unexplainedRegions).toBe(1);
});

it('fails closed to unexplained for unsupported scale factors, out-of-canvas regions and truncated scenes', () => {
  const unsupported = explainDiffRegions({
    diffRegions: [{ x: 0, y: 0, width: 10, height: 10 }],
    deviceScaleFactor: 4 as never,
    scene: scene([{ id: 0, parent: null, kind: 1, x: 0, y: 0, width: 800, height: 600 }]),
    checks: [],
  });
  expect(unsupported.regions[0].unexplained).toBe(true);
  expect(unsupported.regions[0].elements).toEqual([]);
  const outside = explainDiffRegions({
    diffRegions: [{ x: 0, y: 5000, width: 10, height: 10 }],
    deviceScaleFactor: 1,
    scene: scene([{ id: 0, parent: null, kind: 1, x: 0, y: 0, width: 800, height: 600 }]),
    checks: [],
  });
  expect(outside.regions[0].unexplained).toBe(true);
  const truncated = explainDiffRegions({
    diffRegions: [{ x: 0, y: 0, width: 10, height: 10 }],
    deviceScaleFactor: 1,
    scene: scene([{ id: 0, parent: null, kind: 1, x: 0, y: 0, width: 800, height: 600 }], true),
    checks: [],
  });
  expect(truncated.sceneTruncated).toBe(true);
});

it('treats a missing scene as honest absence: every region unexplained, no crash', () => {
  const explanation = explainDiffRegions({
    diffRegions: [{ x: 0, y: 0, width: 10, height: 10 }],
    deviceScaleFactor: 1,
    checks: [],
  });
  expect(explanation.regions[0].unexplained).toBe(true);
  expect(explanation.sceneMissing).toBe(true);
  expect(explanation.assessmentSha256).toBeUndefined();
});

it('orders elements deterministically: deepest, then coverage, then node id', () => {
  const explanation = explainDiffRegions({
    diffRegions: [{ x: 0, y: 0, width: 100, height: 100 }],
    deviceScaleFactor: 1,
    scene: scene([
      { id: 0, parent: null, kind: 7, x: 0, y: 0, width: 800, height: 600 },
      { id: 2, parent: 0, kind: 1, x: 0, y: 0, width: 40, height: 40 },
      { id: 1, parent: 0, kind: 2, x: 0, y: 0, width: 80, height: 80 },
    ]),
    checks: [],
  });
  const labels = explanation.regions[0].elements.map((element) => element.label);
  // Both depth-1 nodes before the root; equal depth orders by coverage desc.
  expect(labels).toEqual(['Link', 'Button', 'Region']);
  expect(explanation.regions[0].elements.map((element) => element.coverage)).toEqual([
    expect.closeTo(0.64, 5),
    expect.closeTo(0.16, 5),
    expect.closeTo(1, 5),
  ]);
});
