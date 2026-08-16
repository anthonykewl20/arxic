import { describe, expect, it } from 'vitest';
import type { DomainInventory } from '@arxic/domain-inventory';
import { buildInventory } from '@arxic/domain-inventory';
import { buildInventoryEvidenceGraph } from '../inventory';
import { canonicalGraphValue } from '../serialize';

/**
 * Evidence-graph fusion (#250 scope 3 / ADR-001 §8.4): every inventory row
 * lands in the evidence graph; every OUTPUT-INFLUENCING edge carries ≥1
 * EvidenceRef (enforced fail-closed by EvidenceGraphContainer — a builder
 * bug surfaces as ARXIC-GRAPH-EDGE-EVIDENCE-MISSING, tested sad-path-first
 * in graph.test.ts).
 */

const commit = 'a'.repeat(40);

function inventory(): DomainInventory {
  return buildInventory({
    sourceIndex: {
      revision: { repository: 'file:///tmp/x', commit, dirty: false },
      manifest: [],
      events: [
        {
          ref: {
            kind: 'source',
            repo: 'file:///tmp/x',
            commit,
            path: 'app/page.tsx',
            startLine: 1,
            endLine: 2,
            blobSha256: 'b'.repeat(64),
            extractor: 'source-ua-adapter/nextjs-file-conventions@0.0.0',
            ruleId: 'route:GET /',
          },
        },
      ],
      toolVersions: {},
      generatedAt: '2026-08-17T00:00:00.000Z',
    },
    interchanges: [
      {
        schemaVersion: 1,
        packId: 'arxic-langpack-php@1.0.0',
        language: 'php',
        framework: 'laravel',
        standIn: false,
        provenance: { repository: 'https://example.invalid/app.git', commit },
        routes: [
          {
            methods: ['POST'],
            uri: '/api/albums',
            sourcePath: 'routes/api.php',
            startLine: 5,
            endLine: 5,
          },
        ],
        gaps: [],
        files: [{ path: 'routes/api.php', sha256: 'c'.repeat(64) }],
      },
    ],
    surfaceMap: {
      schemaVersion: 1,
      truthState: 'observed',
      origin: 'http://127.0.0.1:3999',
      routes: [
        {
          truthState: 'observed',
          url: 'http://127.0.0.1:3999/login',
          path: '/login',
          depth: 1,
          title: 'Login',
          forms: [
            {
              action: 'http://127.0.0.1:3999/login',
              method: 'post',
              destructive: true,
            },
          ],
          controls: [],
          links: [],
        },
      ],
      navigationEdges: [],
      diagnostics: [],
    },
  });
}

describe('inventory rows land in the evidence graph', () => {
  it('creates one node per inventory row with kind by surface', () => {
    const { graph, diagnostics } = buildInventoryEvidenceGraph({ inventory: inventory() });
    expect(diagnostics).toEqual([]);

    const value = canonicalGraphValue(graph);
    const pageNode = value.nodes.find((node) => node.data?.path === '/');
    expect(pageNode?.kind).toBe('UiSurface');
    const endpointNode = value.nodes.find((node) => node.data?.path === '/api/albums');
    expect(endpointNode?.kind).toBe('Route');
    // Runtime-only unsafe mutation surface (no source grounding): a page row
    // (no-source-match) and an unsafe destructive-form endpoint row.
    const loginRows = value.nodes.filter((node) => node.data?.path === '/login');
    expect(loginRows).toHaveLength(2);
    expect(loginRows.find((node) => node.data?.method === 'POST')?.kind).toBe('Route');
    expect(loginRows.find((node) => node.data?.method === 'POST')?.data).toMatchObject({
      disposition: 'unsafe',
    });
  });

  it('grounds every output-influencing defines edge with ≥1 EvidenceRef', () => {
    const { graph } = buildInventoryEvidenceGraph({ inventory: inventory() });
    const value = canonicalGraphValue(graph);
    const outputInfluencing = value.edges.filter((edge) => edge.outputInfluencing);
    expect(outputInfluencing.length).toBeGreaterThan(0);
    for (const edge of outputInfluencing) {
      expect(edge.evidenceRefs.length).toBeGreaterThan(0);
      for (const ref of edge.evidenceRefs) {
        if (ref.kind === 'source') {
          expect(ref.startLine).toBeGreaterThanOrEqual(1);
        }
      }
    }
    // Extracted rows sit behind their source file nodes via `defines`.
    expect(outputInfluencing.filter((edge) => edge.source === 'file:routes/api.php')).toHaveLength(
      1,
    );
  });

  it('never emits an output-influencing edge for ungrounded rows (honest, not fabricated)', () => {
    const { graph, diagnostics } = buildInventoryEvidenceGraph({ inventory: inventory() });
    const value = canonicalGraphValue(graph);
    // The unsafe runtime-only row has no source ref → no defines edge at all.
    expect(value.edges.some((edge) => edge.target.includes('/login'))).toBe(false);
    expect(diagnostics.filter((diagnostic) => diagnostic.code.includes('EVIDENCE'))).toEqual([]);
  });

  it('is deterministic: identical inventory → identical canonical graph value', () => {
    const first = buildInventoryEvidenceGraph({ inventory: inventory() });
    const second = buildInventoryEvidenceGraph({ inventory: inventory() });
    expect(canonicalGraphValue(second.graph)).toEqual(canonicalGraphValue(first.graph));
    expect(second.diagnostics).toEqual(first.diagnostics);
  });
});
