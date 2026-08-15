import { canonicalJson, sha256 } from '@arxic/contracts';
import type { EvidenceRef } from '@arxic/contracts';
import type Graph from 'graphology';
import type { EvidenceGraphAttributes, GraphEdgeAttributes, GraphNodeAttributes } from './types';

export type EvidenceGraph = Graph<
  GraphNodeAttributes,
  GraphEdgeAttributes,
  EvidenceGraphAttributes
>;

export function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export { canonicalJson } from '@arxic/contracts';

export function evidenceRefId(ref: EvidenceRef): string {
  return `${ref.kind}:${sha256(canonicalJson(ref))}`;
}

export function canonicalGraphValue(graph: EvidenceGraph) {
  const nodes = graph
    .nodes()
    .sort(codepointCompare)
    .map((id) => ({ id, ...graph.getNodeAttributes(id) }));
  const edges = graph
    .edges()
    .sort(codepointCompare)
    .map((id) => ({
      id,
      source: graph.source(id),
      target: graph.target(id),
      ...graph.getEdgeAttributes(id),
    }));
  return { schemaVersion: 1 as const, nodes, edges };
}

export function serializeCanonicalGraph(graph: EvidenceGraph): string {
  return canonicalJson(canonicalGraphValue(graph));
}

export function serializeCanonicalJsonl(graph: EvidenceGraph): string {
  const value = canonicalGraphValue(graph);
  return [
    canonicalJson({ type: 'graph', schemaVersion: value.schemaVersion }),
    ...value.nodes.map((node) => canonicalJson({ type: 'node', ...node })),
    ...value.edges.map((edge) => canonicalJson({ type: 'edge', ...edge })),
  ].join('\n');
}

export function createContentAddressedArtifacts(graph: EvidenceGraph) {
  const json = serializeCanonicalGraph(graph);
  const jsonl = serializeCanonicalJsonl(graph);
  return {
    json: { bytes: json, sha256: sha256(json) },
    jsonl: { bytes: jsonl, sha256: sha256(jsonl) },
  };
}
