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

it('is deterministic: repeated invocation and shuffled node input give identical output', () => {
  const nodes: VisualScene['nodes'] = [
    { id: 0, parent: null, kind: 7, x: 0, y: 0, width: 480, height: 600 },
    { id: 1, parent: 0, kind: 5, x: 20, y: 20, width: 200, height: 40 },
    { id: 2, parent: 1, kind: 1, x: 30, y: 25, width: 60, height: 20 },
    { id: 3, parent: 0, kind: 3, x: 20, y: 80, width: 180, height: 30 },
    { id: 4, parent: 0, kind: 2, x: 240, y: 20, width: 120, height: 60 },
    { id: 5, parent: null, kind: 4, x: 300, y: 300, width: 90, height: 90 },
  ];
  const input = {
    diffRegions: [
      { x: 40, y: 40, width: 200, height: 100 },
      { x: 600, y: 600, width: 180, height: 180 },
    ],
    deviceScaleFactor: 2 as const,
    scene: scene(nodes),
    checks: [
      {
        id: 'text-contrast-1',
        kind: 'hard' as const,
        verdict: 'fail' as const,
        expected: '>= 4.5',
        measurementIds: ['tp-1'],
        reason: '2.2 < 4.5',
        region: { x: 30, y: 25, width: 50, height: 20 },
      },
    ],
    assessmentSha256: 'c'.repeat(64),
  };
  const first = explainDiffRegions(input);
  expect(explainDiffRegions(input)).toEqual(first);
  expect(explainDiffRegions({ ...input, scene: scene([...nodes].reverse()) })).toEqual(first);
});

it('excludes shared-edge contact and includes a one-pixel overlap with honest coverage', () => {
  const touching = explainDiffRegions({
    diffRegions: [{ x: 100, y: 0, width: 100, height: 50 }],
    deviceScaleFactor: 1,
    scene: scene([{ id: 0, parent: null, kind: 1, x: 0, y: 0, width: 100, height: 50 }]),
    checks: [],
  });
  // The node ends exactly where the region begins: zero-area contact is not intersection.
  expect(touching.regions[0].elements).toEqual([]);
  expect(touching.regions[0].unexplained).toBe(true);
  const onePixel = explainDiffRegions({
    diffRegions: [{ x: 99, y: 0, width: 100, height: 50 }],
    deviceScaleFactor: 1,
    scene: scene([{ id: 0, parent: null, kind: 1, x: 0, y: 0, width: 100, height: 50 }]),
    checks: [],
  });
  expect(onePixel.regions[0].unexplained).toBe(false);
  expect(onePixel.regions[0].elements[0].coverage).toBe(0.01); // (1*50) / (100*50)
});

it('bounds and rounds coverage: containment is exactly 1 and awkward ratios round to 3 decimals', () => {
  const contained = explainDiffRegions({
    diffRegions: [{ x: 50, y: 50, width: 40, height: 40 }],
    deviceScaleFactor: 1,
    scene: scene([{ id: 0, parent: null, kind: 7, x: 0, y: 0, width: 800, height: 600 }]),
    checks: [],
  });
  expect(contained.regions[0].elements[0].coverage).toBe(1);
  const awkward = explainDiffRegions({
    diffRegions: [{ x: 0, y: 0, width: 300, height: 50 }],
    deviceScaleFactor: 1,
    scene: scene([{ id: 0, parent: null, kind: 5, x: 0, y: 0, width: 100, height: 50 }]),
    checks: [],
  });
  expect(awkward.regions[0].elements[0].coverage).toBe(0.333);
});

it('ranks coverage-first exactly at 60% of the viewport area and depth-first below it', () => {
  // 800x600 viewport; a big shallow node covering ~half the region vs a tiny deep node.
  const nodes: VisualScene['nodes'] = [
    { id: 0, parent: null, kind: 7, x: 0, y: 0, width: 800, height: 600 },
    { id: 1, parent: 0, kind: 5, x: 0, y: 0, width: 400, height: 360 },
    { id: 2, parent: 1, kind: 1, x: 0, y: 0, width: 16, height: 16 },
  ];
  const run = (height: number) =>
    explainDiffRegions({
      diffRegions: [{ x: 0, y: 0, width: 800, height }],
      deviceScaleFactor: 1,
      scene: scene(nodes),
      checks: [],
    }).regions[0].elements[0].label;
  const large = explainDiffRegions({
    diffRegions: [{ x: 0, y: 0, width: 800, height: 360 }],
    deviceScaleFactor: 1,
    scene: scene(nodes),
    checks: [],
  }).regions[0].elements.map((element) => element.label);
  // 800*360 / (800*600) = exactly 0.6 -> coverage-first: root (100%), then the
  // big shallow Heading (50%) ahead of the tiny deep Button (~2%).
  expect(large).toEqual(['Region', 'Heading', 'Button']);
  // 800*359 / (800*600) < 0.6 -> depth-first: the deep Button outranks the shallow Heading.
  expect(run(359)).toBe('Button');
});
