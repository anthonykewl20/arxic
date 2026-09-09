import type { VisualScene } from './visual-oracle';

/**
 * What changed structurally between a baseline and a new capture, and what that
 * makes each changed pixel region mean.
 *
 * The pixel comparison says WHERE the page differs. The diff explanation
 * already says WHICH element sits under that difference in the new capture.
 * Neither can say whether the element moved, changed size, appeared, or simply
 * repainted — and that is the distinction between "the layout broke" and
 * "somebody changed a colour", which is the first question a reviewer asks.
 *
 * This compares the two captures' own measured layout trees to answer it. It is
 * a pure function over evidence both runs already persisted; nothing is
 * re-measured and no model is involved.
 */

export type Box = { x: number; y: number; width: number; height: number };
export type SceneNode = VisualScene['nodes'][number];

/**
 * Identity for matching a node across two captures.
 *
 * Node ids are array positions and shift the moment anything is inserted, so
 * they cannot be matched on. The path from the root — each step recording the
 * node's kind and its position among siblings of that kind — survives unrelated
 * edits elsewhere in the tree, which is what matching needs.
 */
export function nodeKey(scene: VisualScene, node: SceneNode): string {
  const byId = new Map(scene.nodes.map((item) => [item.id, item]));
  const steps: string[] = [];
  let current: SceneNode | undefined = node;
  const guard = new Set<number>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    const parent: SceneNode | undefined =
      current.parent === null ? undefined : byId.get(current.parent);
    const siblings = scene.nodes.filter((item) => item.parent === current!.parent);
    const ofKind = siblings.filter((item) => item.kind === current!.kind);
    steps.push(`${current.kind ?? 'node'}[${ofKind.indexOf(current)}]`);
    current = parent;
  }
  return steps.reverse().join('/');
}

export type LayoutDelta = {
  key: string;
  kind?: SceneNode['kind'];
  before: Box;
  after: Box;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
};

export type StructuralDiff = {
  schemaVersion: 1;
  matched: number;
  added: Array<{ key: string; kind?: SceneNode['kind']; box: Box }>;
  removed: Array<{ key: string; kind?: SceneNode['kind']; box: Box }>;
  /** Matched nodes whose position changed but whose size did not. */
  moved: LayoutDelta[];
  /** Matched nodes whose size changed. */
  resized: LayoutDelta[];
  /** Matched nodes whose box is identical — a difference here is paint only. */
  unchangedBoxes: number;
  documentWidthDelta: number;
  /** Either scene was truncated, so absence of a node is not evidence. */
  truncated: boolean;
};

const box = (node: SceneNode): Box => ({
  x: node.x,
  y: node.y,
  width: node.width,
  height: node.height,
});

/**
 * Compares two measured scenes.
 *
 * Sub-pixel differences are not layout changes: browsers report fractional
 * geometry and a half-pixel is below what a screenshot can express, so
 * comparison rounds to whole pixels.
 */
export function structuralDiff(baseline: VisualScene, current: VisualScene): StructuralDiff {
  const keyed = (scene: VisualScene) => {
    const map = new Map<string, SceneNode>();
    for (const node of scene.nodes) {
      const key = nodeKey(scene, node);
      // A duplicate key means two siblings the path cannot tell apart; keep the
      // first and let the rest fall out as added/removed rather than mismatch.
      if (!map.has(key)) map.set(key, node);
    }
    return map;
  };
  const before = keyed(baseline);
  const after = keyed(current);
  const moved: LayoutDelta[] = [];
  const resized: LayoutDelta[] = [];
  const added: StructuralDiff['added'] = [];
  const removed: StructuralDiff['removed'] = [];
  let matched = 0;
  let unchangedBoxes = 0;
  const round = (value: number) => Math.round(value);

  for (const [key, node] of after) {
    const other = before.get(key);
    if (!other) {
      added.push({ key, kind: node.kind, box: box(node) });
      continue;
    }
    matched++;
    const dx = round(node.x) - round(other.x);
    const dy = round(node.y) - round(other.y);
    const dw = round(node.width) - round(other.width);
    const dh = round(node.height) - round(other.height);
    const delta: LayoutDelta = {
      key,
      kind: node.kind,
      before: box(other),
      after: box(node),
      dx,
      dy,
      dw,
      dh,
    };
    if (dw || dh) resized.push(delta);
    else if (dx || dy) moved.push(delta);
    else unchangedBoxes++;
  }
  for (const [key, node] of before)
    if (!after.has(key)) removed.push({ key, kind: node.kind, box: box(node) });

  return {
    schemaVersion: 1,
    matched,
    added,
    removed,
    moved,
    resized,
    unchangedBoxes,
    documentWidthDelta: round(current.documentWidth) - round(baseline.documentWidth),
    truncated: !!baseline.truncated || !!current.truncated,
  };
}

/**
 * What a changed pixel region means, given the structural diff.
 *
 * `content-change`  something appeared or disappeared under this region.
 * `layout-shift`    an element under it moved or changed size.
 * `visual-change`   every element under it kept exactly its box, so the
 *                   difference is paint: colour, border, text, image.
 * `unclassified`    nothing measured intersects it. Preserved rather than
 *                   guessed, exactly as an unexplained diff region already is.
 */
export type RegionClassification =
  'content-change' | 'layout-shift' | 'visual-change' | 'unclassified';

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export function classifyRegion(region: Box, diff: StructuralDiff): RegionClassification {
  // Order matters: an element appearing is a stronger statement about the
  // region than the shift it caused in its neighbours.
  if ([...diff.added, ...diff.removed].some((item) => intersects(region, item.box)))
    return 'content-change';
  if (
    [...diff.moved, ...diff.resized].some(
      (item) => intersects(region, item.before) || intersects(region, item.after),
    )
  )
    return 'layout-shift';
  return diff.unchangedBoxes ? 'visual-change' : 'unclassified';
}

/** One classification per changed region, in the order the regions were found. */
export function classifyRegions(
  regions: readonly Box[],
  diff: StructuralDiff,
): RegionClassification[] {
  return regions.map((region) => classifyRegion(region, diff));
}

/** The single word for the capture as a whole, for a list that has no room for detail. */
export function summarizeClassifications(
  classifications: readonly RegionClassification[],
): RegionClassification | undefined {
  for (const rank of ['content-change', 'layout-shift', 'visual-change'] as const)
    if (classifications.includes(rank)) return rank;
  return classifications.length ? 'unclassified' : undefined;
}

/**
 * Loads both captures' persisted scenes and classifies the changed regions.
 *
 * Mirrors the diff explanation's discipline: each assessment is only used when
 * its bytes still hash to what the capture recorded, so a classification is
 * always derived from evidence that has not been altered since it was written.
 * Unverifiable evidence leaves the capture unclassified rather than guessed.
 *
 * Diff regions arrive in device pixels, straight from the compared image; scene
 * geometry is in CSS pixels. Regions are converted before they are intersected.
 */
export type CaptureClassification = {
  schemaVersion: 1;
  /** One per changed region, in the order the comparison found them. */
  regions: RegionClassification[];
  /** The strongest classification present, for a list with no room for detail. */
  summary: RegionClassification;
  layoutShifts: number;
  addedElements: number;
  removedElements: number;
  documentWidthDelta: number;
  /** Either scene was truncated, so absence of an element is not evidence. */
  truncated: boolean;
};

export async function classifyAgainstBaseline(
  read: (path: string) => Promise<Buffer>,
  digestBytes: (bytes: Buffer) => string,
  current: { path: string; sha256?: string },
  baseline: { path: string; sha256?: string },
  diffRegions: readonly Box[],
  deviceScaleFactor = 1,
): Promise<{ classification?: CaptureClassification }> {
  if (!current.sha256 || !baseline.sha256 || !diffRegions.length) return {};
  const scene = async (source: { path: string; sha256?: string }) => {
    const bytes = await read(source.path);
    if (digestBytes(bytes) !== source.sha256) return undefined;
    return (JSON.parse(bytes.toString()) as { scene?: VisualScene }).scene;
  };
  try {
    const [currentScene, baselineScene] = await Promise.all([scene(current), scene(baseline)]);
    if (!currentScene || !baselineScene) return {};
    const diff = structuralDiff(baselineScene, currentScene);
    const cssRegions = diffRegions.map((region) => ({
      x: region.x / deviceScaleFactor,
      y: region.y / deviceScaleFactor,
      width: region.width / deviceScaleFactor,
      height: region.height / deviceScaleFactor,
    }));
    const regions = classifyRegions(cssRegions, diff);
    return {
      classification: {
        schemaVersion: 1,
        regions,
        summary: summarizeClassifications(regions) ?? 'unclassified',
        layoutShifts: diff.moved.length + diff.resized.length,
        addedElements: diff.added.length,
        removedElements: diff.removed.length,
        documentWidthDelta: diff.documentWidthDelta,
        truncated: diff.truncated,
      },
    };
  } catch {
    return {};
  }
}
