import type { EvidenceRefSource } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';
import type { AstGrepScanResult } from '@arxic/ast-grep-adapter';
import { ARXIC_SOURCE_UNSUPPORTED_LANGUAGE, SourceUaAdapter } from '@arxic/source-ua-adapter';
import { describe, expect, it } from 'vitest';
import {
  ARXIC_GRAPH_EDGE_EVIDENCE_MISSING,
  ARXIC_GRAPH_NODE_CONFLICT,
  buildStaticEvidenceGraph,
  createContentAddressedArtifacts,
  EvidenceGraphContainer,
  serializeCanonicalGraph,
} from '..';
import { makeRepository } from './test-repo';

const ref = (ruleId: string): EvidenceRefSource => ({
  kind: 'source',
  repo: 'file:///repo',
  commit: 'a'.repeat(40),
  path: 'src/auth.ts',
  startLine: 1,
  endLine: 2,
  blobSha256: 'b'.repeat(64),
  extractor: 'test@1.0.0',
  ruleId,
});

describe('evidence graph sad paths', () => {
  it('maps an unsupported language gap from SourceIndexer to a blocked diagnostic', async () => {
    const repo = await makeRepository(undefined, { 'auth.py': 'def login():\n  pass\n' });
    const source = await new SourceUaAdapter({ now: () => 'volatile-one' }).collect(repo.request);
    const result = buildStaticEvidenceGraph({ source, rules: emptyRules('volatile-two') });
    const diagnostic = result.diagnostics.find(
      (candidate) =>
        candidate.code === ARXIC_SOURCE_UNSUPPORTED_LANGUAGE && candidate.subject === 'auth.py',
    );
    expect(diagnostic).toMatchObject({ severity: 'blocked', subject: 'auth.py' });
    expect(validateDiagnostic(diagnostic)).toMatchObject({ ok: true });
  });

  it('surfaces conflicting source evidence for the same node as contradicted', () => {
    const graph = new EvidenceGraphContainer();
    graph.addNode({
      type: 'node',
      id: 'route:/login',
      kind: 'Route',
      label: '/login',
      evidenceRefs: [ref('route:first')],
    });
    expect(
      graph.addNode({
        type: 'node',
        id: 'route:/login',
        kind: 'Handler',
        label: 'login',
        evidenceRefs: [ref('handler:conflict')],
      }),
    ).toBe(false);
    expect(graph.diagnostics).toEqual([
      expect.objectContaining({ code: ARXIC_GRAPH_NODE_CONFLICT, severity: 'contradicted' }),
    ]);
    expect(validateDiagnostic(graph.diagnostics[0])).toMatchObject({ ok: true });
  });

  it('rejects an output-influencing edge with zero EvidenceRefs as blocked', () => {
    const graph = new EvidenceGraphContainer();
    graph.addNode({ type: 'node', id: 'route', kind: 'Route', label: '/login' });
    graph.addNode({ type: 'node', id: 'handler', kind: 'Handler', label: 'login' });
    const accepted = graph.addEdge({
      type: 'edge',
      id: 'route-handler',
      source: 'route',
      target: 'handler',
      kind: 'handles',
      outputInfluencing: true,
      // Runtime validation remains fail-closed for untyped callers.
      evidenceRefs: [],
    } as never);
    expect(accepted).toBe(false);
    expect(graph.graph.hasEdge('route-handler')).toBe(false);
    expect(graph.diagnostics).toEqual([
      expect.objectContaining({ code: ARXIC_GRAPH_EDGE_EVIDENCE_MISSING, severity: 'blocked' }),
    ]);
  });

  it('builds twice with byte-identical canonical output before timestamps', () => {
    const build = () => {
      const graph = new EvidenceGraphContainer();
      graph.ingest([
        { type: 'node', id: 'handler', kind: 'Handler', label: 'login handler' },
        { type: 'node', id: 'route', kind: 'Route', label: '/login' },
        {
          type: 'edge',
          id: 'route-handler',
          source: 'route',
          target: 'handler',
          kind: 'handles',
          outputInfluencing: true,
          evidenceRefs: [ref('route:login')],
        },
      ]);
      return graph.graph;
    };
    expect(serializeCanonicalGraph(build())).toBe(serializeCanonicalGraph(build()));
  });
});

function compileTimeEvidenceGuard(graph: EvidenceGraphContainer): void {
  // @ts-expect-error output-influencing edges require a non-empty EvidenceRef tuple
  graph.addEdge({
    type: 'edge',
    id: 'invalid-at-compile-time',
    source: 'route',
    target: 'handler',
    kind: 'handles',
    outputInfluencing: true,
    evidenceRefs: [],
  });
}
void compileTimeEvidenceGuard;

describe('evidence graph artifacts', () => {
  it('emits canonical content-addressed JSON and JSONL', () => {
    const graph = new EvidenceGraphContainer();
    graph.addNode({ type: 'node', id: 'repository', kind: 'Repository', label: 'repo' });
    const artifacts = createContentAddressedArtifacts(graph.graph);
    expect(artifacts.json.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(artifacts.jsonl.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.parse(artifacts.json.bytes)).toMatchObject({ schemaVersion: 1 });
    expect(artifacts.jsonl.bytes).toContain('"type":"graph"');
  });
});

function emptyRules(generatedAt: string): AstGrepScanResult {
  return { events: [], matches: [], chains: [], packs: [], generatedAt };
}
