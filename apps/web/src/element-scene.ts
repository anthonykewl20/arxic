import type { Capture } from './types';
import type { VisualScene } from './visual-oracle';
import { validElementKind } from './element-kinds';
export type ElementScene = Pick<
  VisualScene,
  'viewport' | 'nodes' | 'truncated' | 'kindSchemaVersion'
>;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const finite = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;

/** Image-bound geometry and versioned kind projection; no new solver verdicts. */
export function parseElementScene(
  value: unknown,
  capture: Pick<Capture, 'viewport' | 'sha256' | 'status'>,
): ElementScene | undefined {
  const envelope = record(value),
    scene = record(envelope?.scene),
    assessment = record(envelope?.assessment);
  const viewport = record(scene?.viewport);
  if (
    capture.status === 'unstable' ||
    !/^[a-f0-9]{64}$/u.test(capture.sha256) ||
    assessment?.screenshotSha256 !== capture.sha256 ||
    scene?.schemaVersion !== 1 ||
    (scene.kindSchemaVersion !== undefined && scene.kindSchemaVersion !== 1) ||
    typeof scene.truncated !== 'boolean' ||
    !viewport ||
    !finite(viewport.width, 1, 8192) ||
    !finite(viewport.height, 1, 8192) ||
    viewport.width !== capture.viewport.width ||
    viewport.height !== capture.viewport.height ||
    !finite(scene.documentWidth, 1, 1e7) ||
    !Array.isArray(scene.nodes) ||
    scene.nodes.length > 2000
  )
    return;
  const ids = new Set<number>();
  const nodes: ElementScene['nodes'] = [];
  for (const entry of scene.nodes) {
    const n = record(entry);
    if (
      !n ||
      (scene.kindSchemaVersion === 1 && !validElementKind(n.kind)) ||
      !finite(n.id, 0, 1999) ||
      !Number.isInteger(n.id) ||
      ids.has(n.id) ||
      !(n.parent === null || (finite(n.parent, 0, n.id - 1) && Number.isInteger(n.parent))) ||
      !finite(n.x, -1e7, 1e7) ||
      !finite(n.y, -1e7, 1e7) ||
      !finite(n.width, Number.MIN_VALUE, 1e7) ||
      !finite(n.height, Number.MIN_VALUE, 1e7) ||
      n.x + n.width <= 0 ||
      n.y + n.height <= 0 ||
      n.x >= viewport.width ||
      n.y >= viewport.height
    )
      return;
    ids.add(n.id);
    nodes.push({
      id: n.id,
      parent: n.parent,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      ...(scene.kindSchemaVersion === 1 && validElementKind(n.kind) ? { kind: n.kind } : {}),
    });
  }
  return {
    ...(scene.kindSchemaVersion === 1 ? { kindSchemaVersion: 1 as const } : {}),
    viewport: { width: viewport.width, height: viewport.height },
    truncated: scene.truncated,
    nodes: nodes.sort((a, b) => a.id - b.id),
  };
}

/** Half-open CSS boxes; ties use descending preorder ID, never inferred paint order. */
export function elementsAtPoint(scene: ElementScene, x: number, y: number): ElementScene['nodes'] {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= scene.viewport.width ||
    y >= scene.viewport.height
  )
    return [];
  return scene.nodes
    .filter((n) => x >= n.x && x < n.x + n.width && y >= n.y && y < n.y + n.height)
    .sort((a, b) => a.width * a.height - b.width * b.height || b.id - a.id);
}
