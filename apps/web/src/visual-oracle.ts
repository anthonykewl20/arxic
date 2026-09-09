import type { Page } from 'playwright';
import { elementKindProjection, validElementKind, type ElementKind } from './element-kinds';
import { collectTextPaint } from './text-paint';
import { assessTextContrast, validTextPaint, type TextPaint } from './text-contrast';

/** Numeric geometry and bounded kind codes; never retain raw DOM text, attributes, URLs or values. */
export type VisualScene = {
  schemaVersion: 1;
  kindSchemaVersion?: 1;
  viewport: { width: number; height: number };
  documentWidth: number;
  nodes: Array<{
    id: number;
    parent: number | null;
    kind?: ElementKind;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  truncated: boolean;
  textPaint?: TextPaint[];
  /**
   * Numeric geometry of the capture's privacy-masked elements (refs #402
   * finding determination): the automatic + required mask selectors' element
   * rects, collected host-side at capture time and persisted inside the
   * hash-covered assessment — the deterministic source for refuting findings
   * placed on mask pixels. Never text, attributes or values.
   */
  maskedRects?: Array<{ x: number; y: number; width: number; height: number }>;
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
  region?: { x: number; y: number; width: number; height: number };
  observed?: number;
  threshold?: number;
};
export type VisualAssessment = {
  schemaVersion: 1;
  screenshotSha256: string;
  verdict: VisualVerdict;
  checks: VisualCheck[];
  coverage: { state: 'initial'; complete: false; gaps: string[] };
};

/** Read-only layout observation. The limit bounds retained nodes and solver work. */
export async function collectVisualScene(page: Page, masks: string[] = []): Promise<VisualScene> {
  const scene = await page.evaluate((projection) => {
    const tags: Record<string, ElementKind> = projection.tags;
    const roles: Record<string, ElementKind> = projection.roles;
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
      ) {
        const tag = element.tagName.toLowerCase();
        const role = (element.getAttribute('role') ?? '')
          .slice(0, 256)
          .trim()
          .split(/\s+/u)
          .find((value) => Object.hasOwn(roles, value));
        let kind: ElementKind = 0;
        if (role) kind = roles[role];
        else if (tag === 'input')
          kind = ['button', 'submit', 'reset'].includes((element as HTMLInputElement).type) ? 1 : 3;
        else if (tag === 'a' && element.hasAttribute('href')) kind = 2;
        else if (Object.hasOwn(tags, tag)) kind = tags[tag];
        nodes.push({
          id,
          kind,
          parent: ids.get(element.parentElement!) ?? null,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        });
      }
      element = walker.nextNode() as Element | null;
    }
    return {
      schemaVersion: 1 as const,
      kindSchemaVersion: 1 as const,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      nodes,
      truncated: element !== null,
    };
  }, elementKindProjection);
  if (!numericScene(scene)) throw new Error('Invalid numeric scene evidence');
  if (scene.kindSchemaVersion !== 1 || !scene.nodes.every((node) => validElementKind(node.kind)))
    throw new Error('Invalid element kind evidence');
  // Rebuild the projection on the trusted host; do not retain unexpected browser fields.
  return {
    schemaVersion: 1,
    kindSchemaVersion: 1,
    viewport: { width: scene.viewport.width, height: scene.viewport.height },
    documentWidth: scene.documentWidth,
    truncated: scene.truncated,
    textPaint: await collectTextPaint(page, masks),
    nodes: scene.nodes.map(({ id, parent, kind, x, y, width, height }) => ({
      id,
      kind,
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
    (scene.textPaint === undefined || validTextPaint(scene.textPaint)) &&
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
  if (scene.textPaint) checks.push(...assessTextContrast(scene.textPaint, valid));
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

/** Collect the privacy-mask rects for the given selectors (bounded, numeric). */
export async function collectMaskedRects(
  page: Page,
  selectors: readonly string[],
): Promise<NonNullable<VisualScene['maskedRects']>> {
  const rects = await page.evaluate(
    (sources) => {
      const seen = new Set<Element>();
      for (const selector of sources)
        for (const element of document.querySelectorAll(selector)) seen.add(element);
      const output: Array<{ x: number; y: number; width: number; height: number }> = [];
      for (const element of seen) {
        if (output.length >= 100) break;
        const box = element.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) continue;
        output.push({ x: box.x, y: box.y, width: box.width, height: box.height });
      }
      return output;
    },
    [...selectors],
  );
  if (
    !Array.isArray(rects) ||
    rects.some(
      (rect) =>
        typeof rect?.x !== 'number' ||
        typeof rect?.y !== 'number' ||
        typeof rect?.width !== 'number' ||
        typeof rect?.height !== 'number',
    )
  )
    throw new Error('Invalid masked rect evidence');
  return rects.sort((left, right) => left.y - right.y || left.x - right.x);
}
