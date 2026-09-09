import { expect, it } from 'vitest';
import {
  classifyAgainstBaseline,
  classifyRegion,
  classifyRegions,
  nodeKey,
  structuralDiff,
  summarizeClassifications,
} from '../structural-diff';
import type { VisualScene } from '../visual-oracle';

type Node = VisualScene['nodes'][number];

// ElementKind is the numeric projection from element-kinds.ts, not a string.
const REGION = 7; // 'Region'
const HEADING = 5; // 'Heading'

function scene(nodes: Array<Partial<Node> & Pick<Node, 'id' | 'parent'>>): VisualScene {
  return {
    schemaVersion: 1,
    viewport: { width: 400, height: 300 },
    documentWidth: 400,
    truncated: false,
    nodes: nodes.map((node) => ({
      kind: REGION,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      ...node,
    })) as Node[],
  };
}

/** root > header, card. The card is what most assertions follow. */
const page = (headerHeight: number, cardY: number) =>
  scene([
    { id: 0, parent: null, kind: REGION, x: 0, y: 0, width: 400, height: 300 },
    { id: 1, parent: 0, kind: REGION, x: 0, y: 0, width: 400, height: headerHeight },
    { id: 2, parent: 0, kind: REGION, x: 10, y: cardY, width: 200, height: 60 },
  ]);

it('matches nodes by tree path, not by array position', () => {
  const before = page(40, 50);
  const withInsert = scene([
    { id: 0, parent: null, kind: REGION, x: 0, y: 0, width: 400, height: 300 },
    // A new banner inserted first shifts every later id.
    { id: 1, parent: 0, kind: HEADING, x: 0, y: 0, width: 400, height: 20 },
    { id: 2, parent: 0, kind: REGION, x: 0, y: 20, width: 400, height: 40 },
    { id: 3, parent: 0, kind: REGION, x: 10, y: 70, width: 200, height: 60 },
  ]);
  const diff = structuralDiff(before, withInsert);
  // Both containers still match despite every id changing.
  expect(diff.matched).toBe(3);
  expect(diff.added.map((item) => item.kind)).toEqual([HEADING]);
  expect(diff.removed).toEqual([]);
});

it('separates a move from a resize', () => {
  const diff = structuralDiff(page(40, 50), page(40, 90));
  expect(diff.moved).toHaveLength(1);
  expect(diff.moved[0]).toMatchObject({ dx: 0, dy: 40, dw: 0, dh: 0 });
  expect(diff.resized).toEqual([]);

  const grown = structuralDiff(page(40, 50), page(90, 50));
  expect(grown.resized).toHaveLength(1);
  expect(grown.resized[0]).toMatchObject({ dh: 50 });
});

it('treats a sub-pixel difference as no change at all', () => {
  const before = page(40, 50);
  const jittered = page(40, 50);
  jittered.nodes[2]!.y = 50.4;
  jittered.nodes[2]!.width = 200.2;
  const diff = structuralDiff(before, jittered);
  expect(diff.moved).toEqual([]);
  expect(diff.resized).toEqual([]);
  expect(diff.unchangedBoxes).toBe(3);
});

it('reports a node that disappeared as removed, not as a move', () => {
  const after = scene([
    { id: 0, parent: null, kind: REGION, x: 0, y: 0, width: 400, height: 300 },
    { id: 1, parent: 0, kind: REGION, x: 0, y: 0, width: 400, height: 40 },
  ]);
  const diff = structuralDiff(page(40, 50), after);
  expect(diff.removed).toHaveLength(1);
  expect(diff.moved).toEqual([]);
});

it('calls a region over a moved element a layout shift', () => {
  const diff = structuralDiff(page(40, 50), page(40, 90));
  expect(classifyRegion({ x: 10, y: 90, width: 200, height: 60 }, diff)).toBe('layout-shift');
  // The element's ORIGINAL position counts too: the region it vacated is part
  // of the same shift, and a reviewer looking there must not be told the paint
  // changed on its own.
  expect(classifyRegion({ x: 10, y: 50, width: 200, height: 10 }, diff)).toBe('layout-shift');
});

it('calls a region where every box is identical a visual change', () => {
  // Same geometry on both sides: whatever the pixels did, it was paint.
  const diff = structuralDiff(page(40, 50), page(40, 50));
  expect(diff.moved).toEqual([]);
  expect(classifyRegion({ x: 10, y: 50, width: 200, height: 60 }, diff)).toBe('visual-change');
});

it('calls a region over something that appeared a content change', () => {
  const after = scene([
    { id: 0, parent: null, kind: REGION, x: 0, y: 0, width: 400, height: 300 },
    { id: 1, parent: 0, kind: REGION, x: 0, y: 0, width: 400, height: 40 },
    { id: 2, parent: 0, kind: REGION, x: 10, y: 50, width: 200, height: 60 },
    { id: 3, parent: 0, kind: HEADING, x: 10, y: 200, width: 100, height: 20 },
  ]);
  const diff = structuralDiff(page(40, 50), after);
  expect(classifyRegion({ x: 10, y: 200, width: 100, height: 20 }, diff)).toBe('content-change');
});

it('prefers the stronger statement when a region is both new content and a shift', () => {
  const after = scene([
    { id: 0, parent: null, kind: REGION, x: 0, y: 0, width: 400, height: 300 },
    { id: 1, parent: 0, kind: HEADING, x: 10, y: 50, width: 200, height: 30 },
    { id: 2, parent: 0, kind: REGION, x: 0, y: 0, width: 400, height: 40 },
    { id: 3, parent: 0, kind: REGION, x: 10, y: 90, width: 200, height: 60 },
  ]);
  const diff = structuralDiff(page(40, 50), after);
  expect(classifyRegion({ x: 10, y: 50, width: 200, height: 40 }, diff)).toBe('content-change');
});

it('leaves a region with nothing measured under it unclassified rather than guessing', () => {
  const empty = scene([]);
  const diff = structuralDiff(empty, empty);
  expect(classifyRegion({ x: 0, y: 0, width: 10, height: 10 }, diff)).toBe('unclassified');
});

it('records a document width change, which a viewport comparison cannot see', () => {
  const wider = page(40, 50);
  wider.documentWidth = 520;
  expect(structuralDiff(page(40, 50), wider).documentWidthDelta).toBe(120);
});

it('marks the diff truncated when either scene was, so absence is not read as removal', () => {
  const truncated = page(40, 50);
  truncated.truncated = true;
  expect(structuralDiff(page(40, 50), truncated).truncated).toBe(true);
});

it('summarizes a capture by its strongest region', () => {
  expect(summarizeClassifications(['visual-change', 'layout-shift'])).toBe('layout-shift');
  expect(summarizeClassifications(['visual-change', 'content-change', 'layout-shift'])).toBe(
    'content-change',
  );
  expect(summarizeClassifications(['visual-change'])).toBe('visual-change');
  expect(summarizeClassifications([])).toBeUndefined();
});

it('classifies every region in order', () => {
  const diff = structuralDiff(page(40, 50), page(40, 90));
  expect(
    classifyRegions(
      [
        { x: 10, y: 90, width: 200, height: 60 },
        { x: 300, y: 0, width: 10, height: 10 },
      ],
      diff,
    ),
  ).toEqual(['layout-shift', 'visual-change']);
});

it('builds a stable path key from the tree', () => {
  const built = page(40, 50);
  expect(nodeKey(built, built.nodes[2]!)).toBe(`${REGION}[0]/${REGION}[1]`);
});

// ---------------------------------------------------------------------------
// Loading both captures' persisted scenes.
// ---------------------------------------------------------------------------

const assessment = (built: VisualScene) => Buffer.from(JSON.stringify({ scene: built }));
const hash = (bytes: Buffer) => `sha-${bytes.length}-${bytes.subarray(0, 8).toString('hex')}`;

function reader(files: Record<string, Buffer>) {
  return async (path: string) => {
    const bytes = files[path];
    if (!bytes) throw new Error(`no such file ${path}`);
    return bytes;
  };
}

it('classifies a real region set from two persisted scenes', async () => {
  const before = assessment(page(40, 50));
  const after = assessment(page(40, 90));
  const { classification } = await classifyAgainstBaseline(
    reader({ '/current': after, '/baseline': before }),
    hash,
    { path: '/current', sha256: hash(after) },
    { path: '/baseline', sha256: hash(before) },
    [{ x: 10, y: 90, width: 200, height: 60 }],
  );
  expect(classification?.summary).toBe('layout-shift');
  expect(classification?.layoutShifts).toBe(1);
  expect(classification?.regions).toEqual(['layout-shift']);
});

it('converts device-pixel regions to CSS pixels before intersecting the scene', async () => {
  const before = assessment(page(40, 50));
  const after = assessment(page(40, 90));
  // The same region expressed at 2x: without the conversion it would land at
  // y=180, miss the moved card entirely, and be called a visual change.
  const { classification } = await classifyAgainstBaseline(
    reader({ '/current': after, '/baseline': before }),
    hash,
    { path: '/current', sha256: hash(after) },
    { path: '/baseline', sha256: hash(before) },
    [{ x: 20, y: 180, width: 400, height: 120 }],
    2,
  );
  expect(classification?.summary).toBe('layout-shift');
});

it('refuses to classify when an assessment no longer hashes to what was recorded', async () => {
  const before = assessment(page(40, 50));
  const after = assessment(page(40, 90));
  const tampered = await classifyAgainstBaseline(
    reader({ '/current': after, '/baseline': before }),
    hash,
    { path: '/current', sha256: 'not-the-recorded-hash' },
    { path: '/baseline', sha256: hash(before) },
    [{ x: 10, y: 90, width: 200, height: 60 }],
  );
  expect(tampered).toEqual({});
});

it('returns nothing when an assessment is missing or unreadable', async () => {
  const before = assessment(page(40, 50));
  expect(
    await classifyAgainstBaseline(
      reader({ '/baseline': before }),
      hash,
      { path: '/current', sha256: 'x' },
      { path: '/baseline', sha256: hash(before) },
      [{ x: 0, y: 0, width: 10, height: 10 }],
    ),
  ).toEqual({});
  expect(
    await classifyAgainstBaseline(
      reader({ '/baseline': before }),
      hash,
      { path: '/current', sha256: undefined },
      { path: '/baseline', sha256: hash(before) },
      [{ x: 0, y: 0, width: 10, height: 10 }],
    ),
  ).toEqual({});
});

it('does not classify a capture that has no changed regions', async () => {
  const built = assessment(page(40, 50));
  expect(
    await classifyAgainstBaseline(
      reader({ '/current': built, '/baseline': built }),
      hash,
      { path: '/current', sha256: hash(built) },
      { path: '/baseline', sha256: hash(built) },
      [],
    ),
  ).toEqual({});
});
