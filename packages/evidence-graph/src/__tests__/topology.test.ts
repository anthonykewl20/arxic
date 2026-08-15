import { describe, expect, it } from 'vitest';
import { buildDirectedGraph } from '..';

describe('directed graph topology service', () => {
  it('accepts a supplied topology and exposes only edge traversal', () => {
    const graph = buildDirectedGraph({
      nodes: [{ id: 'candidate:login' }, { id: 'runtime:/login' }],
      edges: [
        {
          id: 'candidate:login->runtime:/login',
          source: 'candidate:login',
          target: 'runtime:/login',
        },
      ],
    });

    expect(graph.hasEdge('candidate:login->runtime:/login')).toBe(true);
    expect(graph.hasEdge('candidate:login->runtime:/logout')).toBe(false);
    expect('graph' in graph).toBe(false);
  });

  it('preserves edge traversal results when callers supply topology in a different order', () => {
    const nodes = [{ id: 'candidate:login' }, { id: 'runtime:/login' }, { id: 'runtime:/logout' }];
    const edges = [
      {
        id: 'candidate:login->runtime:/login',
        source: 'candidate:login',
        target: 'runtime:/login',
      },
      {
        id: 'candidate:login->runtime:/logout',
        source: 'candidate:login',
        target: 'runtime:/logout',
      },
    ];
    const inOriginalOrder = buildDirectedGraph({ nodes, edges });
    const inShuffledOrder = buildDirectedGraph({
      nodes: [...nodes].reverse(),
      edges: [...edges].reverse(),
    });
    const probes = [
      'candidate:login->runtime:/login',
      'candidate:login->runtime:/logout',
      'candidate:logout->runtime:/logout',
    ];

    expect(probes.map(inOriginalOrder.hasEdge)).toEqual(probes.map(inShuffledOrder.hasEdge));
  });

  it('reports no edges for empty topology', () => {
    const graph = buildDirectedGraph({ nodes: [], edges: [] });

    expect(graph.hasEdge('candidate:login->runtime:/login')).toBe(false);
  });

  it('rejects duplicate edge keys', () => {
    // Reconciliation pre-deduplicates keys; Graphology rejects duplicate keys even in multi mode.
    expect(() =>
      buildDirectedGraph({
        nodes: [{ id: 'candidate:login' }, { id: 'runtime:/login' }],
        edges: [
          {
            id: 'candidate:login->runtime:/login',
            source: 'candidate:login',
            target: 'runtime:/login',
          },
          {
            id: 'candidate:login->runtime:/login',
            source: 'candidate:login',
            target: 'runtime:/login',
          },
        ],
      }),
    ).toThrow();
  });
});
