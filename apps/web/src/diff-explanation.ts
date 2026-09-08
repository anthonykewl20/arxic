import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 as digest } from '@arxic/contracts';
import { elementKindLabels, validElementKind, type ElementKind } from './element-kinds';
import type { VisualCheck, VisualScene } from './visual-oracle';

type Box = { x: number; y: number; width: number; height: number };

export type RegionExplanation = {
  /** Echoed image-pixel box from pixelmatch region detection. */
  box: Box;
  /** The same region in CSS pixels after device-scale division. */
  cssBox: Box;
  elements: Array<{ kind: ElementKind; label: string; box: Box; coverage: number }>;
  checks: Array<{ id: string; verdict: 'fail' | 'unverified'; reason: string }>;
  /** No measured scene element intersects this region; the paint change is preserved unattributed. */
  unexplained: boolean;
};
export type DiffExplanation = {
  schemaVersion: 1;
  /** Binds the explanation to the exact assessment bytes it was fused from. */
  assessmentSha256?: string;
  deviceScaleFactor: number;
  regions: RegionExplanation[];
  unexplainedRegions: number;
  sceneTruncated: boolean;
  sceneMissing?: boolean;
  /** Document-level non-pass checks (no region of their own). */
  documentChecks: Array<{ id: string; verdict: 'fail' | 'unverified'; reason: string }>;
};

const overlapArea = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * Deterministic diff explanation: joins each pixel-diff region with the measured
 * scene elements and non-pass checks that geometrically intersect it. No model in
 * the path — unattributed paint stays unexplained, never guessed (visual-oracle
 * "Pixels" rule). Pure function over already-collected evidence.
 */
export function explainDiffRegions(input: {
  diffRegions: Box[];
  deviceScaleFactor: number;
  scene?: VisualScene;
  checks?: VisualCheck[];
  assessmentSha256?: string;
}): DiffExplanation {
  const scale = input.deviceScaleFactor;
  const supportedScale = scale === 1 || scale === 2 || scale === 3;
  const checks = input.checks ?? [];
  const nonPass = checks.filter(
    (check): check is VisualCheck & { verdict: 'fail' | 'unverified' } =>
      check.verdict === 'fail' || check.verdict === 'unverified',
  );
  const documentChecks = nonPass
    .filter((check) => !check.region)
    .map(({ id, verdict, reason }) => ({ id, verdict, reason }));
  const regionalChecks = nonPass.filter((check) => !!check.region);
  const depth = new Map<number, number>();
  if (input.scene)
    for (const node of input.scene.nodes) {
      let level = 0;
      let parent = node.parent;
      const seen = new Set<number>([node.id]);
      while (parent !== null && !seen.has(parent)) {
        seen.add(parent);
        level++;
        parent = input.scene.nodes.find((candidate) => candidate.id === parent)?.parent ?? null;
      }
      depth.set(node.id, level);
    }
  const regions: RegionExplanation[] = input.diffRegions.map((box) => {
    const cssBox: Box = supportedScale
      ? {
          x: box.x / scale,
          y: box.y / scale,
          width: box.width / scale,
          height: box.height / scale,
        }
      : box;
    const regionArea = cssBox.width * cssBox.height;
    // A region covering most of the viewport (>= 60% of its area) attributes by
    // coverage first: depth-first would fill the cap with the deepest nodes and
    // never surface the actually-repainted large element (#510 finding, #520 fix).
    const viewportArea = input.scene ? input.scene.viewport.width * input.scene.viewport.height : 0;
    const largeRegion = viewportArea > 0 && regionArea / viewportArea >= 0.6;
    const joinable =
      supportedScale &&
      !!input.scene &&
      regionArea > 0 &&
      cssBox.x < input.scene.viewport.width &&
      cssBox.y < input.scene.viewport.height &&
      cssBox.x + cssBox.width > 0 &&
      cssBox.y + cssBox.height > 0;
    const elements = (input.scene?.nodes ?? [])
      .filter((node) => {
        const nodeBox = { x: node.x, y: node.y, width: node.width, height: node.height };
        return overlapArea(cssBox, nodeBox) > 0;
      })
      .map((node) => {
        const nodeBox = { x: node.x, y: node.y, width: node.width, height: node.height };
        const kind: ElementKind = validElementKind(node.kind) ? node.kind : 0;
        return {
          kind,
          label: elementKindLabels[kind],
          box: nodeBox,
          coverage: overlapArea(cssBox, nodeBox) / regionArea,
          depth: depth.get(node.id) ?? 0,
          id: node.id,
        };
      })
      .sort((a, b) =>
        largeRegion
          ? b.coverage - a.coverage || b.depth - a.depth || a.id - b.id
          : b.depth - a.depth || b.coverage - a.coverage || a.id - b.id,
      )
      .slice(0, 5)
      .map(({ kind, label, box: elementBox, coverage }) => ({
        kind,
        label,
        box: elementBox,
        coverage: Math.round(coverage * 1000) / 1000,
      }));
    const regionChecks = joinable
      ? regionalChecks
          .filter((check) => overlapArea(cssBox, check.region!) > 0)
          .sort((a, b) =>
            a.verdict === b.verdict ? a.id.localeCompare(b.id) : a.verdict === 'fail' ? -1 : 1,
          )
          .map(({ id, verdict, reason }) => ({ id, verdict, reason }))
      : [];
    return {
      box,
      cssBox,
      elements: joinable ? elements : [],
      checks: regionChecks,
      unexplained: !joinable || elements.length === 0,
    };
  });
  return {
    schemaVersion: 1,
    ...(input.assessmentSha256 ? { assessmentSha256: input.assessmentSha256 } : {}),
    deviceScaleFactor: scale,
    regions,
    unexplainedRegions: regions.filter((region) => region.unexplained).length,
    sceneTruncated: input.scene?.truncated ?? false,
    ...(input.scene ? {} : { sceneMissing: true }),
    documentChecks,
  };
}

/**
 * Loads the current capture's assessment bytes, verifies them against the
 * recorded SHA-256, and fuses the diff explanation from them. Any missing,
 * unreadable, hash-mismatched or malformed assessment yields no explanation —
 * honest absence, never a fabricated one.
 */
export async function explainFromAssessment(
  directory: string,
  capture: {
    assessmentFile?: string;
    assessmentSha256?: string;
    environment?: { deviceScaleFactor?: 1 | 2 | 3 };
  },
  diffRegions: Box[],
): Promise<{ diffExplanation?: DiffExplanation }> {
  if (!capture.assessmentFile || !capture.assessmentSha256) return {};
  try {
    const bytes = await readFile(join(directory, capture.assessmentFile));
    if (digest(bytes) !== capture.assessmentSha256) return {};
    const parsed = JSON.parse(bytes.toString()) as {
      scene?: VisualScene;
      assessment?: { checks?: VisualCheck[] };
    };
    return {
      diffExplanation: explainDiffRegions({
        diffRegions,
        deviceScaleFactor: capture.environment?.deviceScaleFactor ?? 1,
        scene: parsed.scene,
        checks: parsed.assessment?.checks,
        assessmentSha256: capture.assessmentSha256,
      }),
    };
  } catch {
    return {};
  }
}
