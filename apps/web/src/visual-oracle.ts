import type { Page } from 'playwright';

/** Numeric-only projection: never retain DOM text, attributes, URLs or field values. */
export type VisualScene = {
  schemaVersion: 1;
  viewport: { width: number; height: number };
  documentWidth: number;
  nodes: Array<{
    id: number;
    parent: number | null;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  truncated: boolean;
};
export type VisualVerdict = 'pass' | 'fail' | 'unverified';
export type VisualCheck = {
  id: string;
  kind: 'hard' | 'suspect' | 'vision';
  verdict: VisualVerdict;
  expected: string;
  measurementIds: string[];
  reason: string;
  delta?: number;
};
export type VisualAssessment = {
  schemaVersion: 1;
  screenshotSha256: string;
  verdict: VisualVerdict;
  checks: VisualCheck[];
  coverage: { state: 'initial'; complete: false; gaps: string[] };
};

/** Read-only layout observation. The limit bounds retained nodes and solver work. */
export async function collectVisualScene(page: Page): Promise<VisualScene> {
  const scene = await page.evaluate(() => {
    const nodes: VisualScene['nodes'] = [];
    const ids = new Map<Element, number>();
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
    let element: Element | null = document.documentElement;
    let scanned = 0;
    while (element && scanned < 2000) {
      const id = scanned++;
      ids.set(element, id);
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        box.width > 0 &&
        box.height > 0 &&
        box.right > 0 &&
        box.bottom > 0 &&
        box.left < window.innerWidth &&
        box.top < window.innerHeight &&
        style.visibility === 'visible' &&
        style.display !== 'none'
      )
        nodes.push({
          id,
          parent: ids.get(element.parentElement!) ?? null,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        });
      element = walker.nextNode() as Element | null;
    }
    return {
      schemaVersion: 1 as const,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      nodes,
      truncated: element !== null,
    };
  });
  if (!numericScene(scene)) throw new Error('Invalid numeric scene evidence');
  // Rebuild the projection on the trusted host; do not retain unexpected browser fields.
  return {
    schemaVersion: 1,
    viewport: { width: scene.viewport.width, height: scene.viewport.height },
    documentWidth: scene.documentWidth,
    truncated: scene.truncated,
    nodes: scene.nodes.map(({ id, parent, x, y, width, height }) => ({
      id,
      parent,
      x,
      y,
      width,
      height,
    })),
  };
}

function numericScene(scene: VisualScene): boolean {
  return (
    !!scene &&
    scene.schemaVersion === 1 &&
    typeof scene.truncated === 'boolean' &&
    Number.isFinite(scene.documentWidth) &&
    scene.documentWidth > 0 &&
    Number.isFinite(scene.viewport?.width) &&
    scene.viewport.width > 0 &&
    Number.isFinite(scene.viewport?.height) &&
    scene.viewport.height > 0 &&
    Array.isArray(scene.nodes) &&
    scene.nodes.length <= 2000 &&
    scene.nodes.every(
      (node) =>
        !!node &&
        Number.isInteger(node.id) &&
        node.id >= 0 &&
        (node.parent === null || (Number.isInteger(node.parent) && node.parent >= 0)) &&
        [node.x, node.y, node.width, node.height].every(Number.isFinite) &&
        node.width > 0 &&
        node.height > 0,
    )
  );
}

/** Decision boundary: no model argument, exemptions, or model-assigned truth state. */
export function assessVisualScene(
  scene: VisualScene,
  evidence: { screenshotSha256: string; stable: boolean },
): VisualAssessment {
  const valid =
    evidence.stable && /^[a-f0-9]{64}$/u.test(evidence.screenshotSha256) && numericScene(scene);
  const gaps = [
    'clip-chain-containment',
    'paint-occlusion',
    'contrast-painted-pairs',
    'alignment-declared-groups',
    'typography-baselines',
    'symmetry-intent',
    'tokens',
    'a11y-tree',
    'interaction-states',
    'discovery-frontier',
    'browser-theme-locale-role-matrix',
    'temporal-motion',
    'vision-review',
  ];
  if (scene.truncated) gaps.push('node-budget-exhausted');
  const delta = scene.documentWidth - scene.viewport.width;
  const checks: VisualCheck[] = [
    {
      id: 'document-horizontal-overflow',
      kind: 'hard',
      verdict: valid ? (delta > 1 ? 'fail' : 'pass') : 'unverified',
      expected:
        'Document scroll width must not exceed viewport width by more than 1 CSS px (capture profile, not WCAG certification).',
      measurementIds: ['documentWidth', 'viewport.width'],
      reason: valid
        ? 'Measured document extent; nested scrollports are not this predicate.'
        : 'Stable screenshot and finite layout evidence are required.',
      ...(valid ? { delta } : {}),
    },
  ];
  for (const gap of gaps)
    checks.push({
      id: gap,
      kind: gap === 'vision-review' ? 'vision' : 'suspect',
      verdict: 'unverified',
      expected: 'Run the scoped detector with its required evidence and declared expectations.',
      measurementIds: [],
      reason: 'Not measured by this capture profile.',
    });
  return {
    schemaVersion: 1,
    screenshotSha256: evidence.screenshotSha256,
    verdict: checks.some((check) => check.verdict === 'fail') ? 'fail' : 'unverified',
    checks,
    coverage: { state: 'initial', complete: false, gaps },
  };
}
