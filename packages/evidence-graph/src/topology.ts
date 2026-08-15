import Graph from 'graphology';

export type DirectedGraphTopologyInput = Readonly<{
  nodes: readonly Readonly<{ id: string }>[];
  edges: readonly Readonly<{ id: string; source: string; target: string }>[];
}>;

export type DirectedGraphTraversal = Readonly<{
  hasEdge: (edgeId: string) => boolean;
}>;

/**
 * Builds an opaque directed graph traversal capability.
 *
 * Callers provide domain topology, while this service owns the Graphology
 * ingestion and traversal mechanics. Graphology state is intentionally not
 * exposed outside this package.
 */
export function buildDirectedGraph(input: DirectedGraphTopologyInput): DirectedGraphTraversal {
  const graph = new Graph({ type: 'directed', multi: true });
  for (const node of input.nodes) graph.addNode(node.id);
  for (const edge of input.edges) {
    graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target);
  }
  return { hasEdge: (edgeId) => graph.hasEdge(edgeId) };
}
