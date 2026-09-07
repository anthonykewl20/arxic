import { expect, it } from 'vitest';
import { parseElementScene, elementsAtPoint } from '../element-scene';
const capture = {
  viewport: { width: 800, height: 600 },
  sha256: 'a'.repeat(64),
  status: 'needs-baseline' as const,
};
const scene = {
  schemaVersion: 1,
  viewport: { width: 800, height: 600 },
  documentWidth: 800,
  truncated: false,
  nodes: [
    { id: 0, parent: null, x: 0, y: 0, width: 800, height: 600 },
    { id: 2, parent: 0, x: 10, y: 20, width: 100, height: 40 },
    { id: 3, parent: 2, x: 15, y: 25, width: 20, height: 10 },
  ],
};
const report = { scene, assessment: { screenshotSha256: capture.sha256 } };
it.each([
  null,
  {},
  { ...report, assessment: { screenshotSha256: 'b'.repeat(64) } },
  { ...report, scene: { ...scene, viewport: { width: 801, height: 600 } } },
  { ...report, scene: { ...scene, nodes: [scene.nodes[0], scene.nodes[0]] } },
  { ...report, scene: { ...scene, nodes: [{ ...scene.nodes[0], parent: 0 }] } },
  { ...report, scene: { ...scene, nodes: [{ ...scene.nodes[0], x: Infinity }] } },
  { ...report, scene: { ...scene, nodes: [{ ...scene.nodes[0], x: 900 }] } },
  { ...report, scene: { ...scene, nodes: Array(2001).fill(scene.nodes[0]) } },
])('does not expose malformed or unbound element geometry %j', (value) => {
  expect(parseElementScene(value, capture)).toBeUndefined();
});
it('keeps unstable captures unavailable for element picking', () => {
  expect(parseElementScene(report, { ...capture, status: 'unstable' })).toBeUndefined();
});
it('projects numeric nodes only and picks overlapping boxes smallest-first', () => {
  const parsed = parseElementScene(
    {
      ...report,
      scene: { ...scene, nodes: scene.nodes.map((node) => ({ ...node, text: 'must not retain' })) },
    },
    capture,
  )!;
  expect(parsed).toBeDefined();
  expect(JSON.stringify(parsed)).not.toContain('must not retain');
  expect(elementsAtPoint(parsed, 20, 30).map((node) => node.id)).toEqual([3, 2, 0]);
  expect(elementsAtPoint(parsed, 810, 30)).toEqual([]);
  expect(elementsAtPoint(parsed, NaN, 30)).toEqual([]);
});

it('preserves incomplete scan scope and missing parents without inventing nodes', () => {
  const parsed = parseElementScene(
    { ...report, scene: { ...scene, truncated: true, nodes: [{ ...scene.nodes[2], parent: 1 }] } },
    capture,
  )!;
  expect(parsed.truncated).toBe(true);
  expect(parsed.nodes).toEqual([{ id: 3, parent: 1, x: 15, y: 25, width: 20, height: 10 }]);
  expect(parseElementScene({ ...report, scene: { ...scene, nodes: [] } }, capture)?.nodes).toEqual(
    [],
  );
});
it('uses half-open edges and deterministic preorder ties without claiming paint order', () => {
  const parsed = parseElementScene(
    {
      ...report,
      scene: {
        ...scene,
        nodes: [
          { ...scene.nodes[2], parent: 0 },
          { ...scene.nodes[2], id: 4, parent: 0 },
        ],
      },
    },
    capture,
  )!;
  expect(elementsAtPoint(parsed, 15, 25).map((node) => node.id)).toEqual([4, 3]);
  expect(elementsAtPoint(parsed, 35, 25)).toEqual([]);
  expect(elementsAtPoint(parsed, 15, 35)).toEqual([]);
});

it.each([-1, 10, 1.5, 'button', null, undefined, { role: 'private-value' }])(
  'rejects malformed versioned element-kind metadata %j',
  (kind) => {
    expect(
      parseElementScene(
        {
          ...report,
          scene: {
            ...scene,
            kindSchemaVersion: 1,
            nodes: scene.nodes.map((node) => ({ ...node, kind })),
          },
        },
        capture,
      ),
    ).toBeUndefined();
  },
);
it('retains bounded kinds only in their supported version and keeps legacy captures numeric', () => {
  const versioned = {
    ...report,
    scene: {
      ...scene,
      kindSchemaVersion: 1,
      nodes: scene.nodes.map((node) => ({
        ...node,
        kind: 1,
        role: 'private-role',
        name: 'private-name',
      })),
    },
  };
  const parsed = parseElementScene(versioned, capture)!;
  expect(parsed).toMatchObject({
    kindSchemaVersion: 1,
    nodes: scene.nodes.map((n) => ({ ...n, kind: 1 })),
  });
  expect(JSON.stringify(parsed)).not.toContain('private-');
  expect(
    parseElementScene(
      { ...versioned, scene: { ...versioned.scene, kindSchemaVersion: 2 } },
      capture,
    ),
  ).toBeUndefined();
  expect(
    parseElementScene(
      { ...versioned, scene: { ...versioned.scene, kindSchemaVersion: undefined } },
      capture,
    )?.nodes,
  ).toEqual(scene.nodes);
});
