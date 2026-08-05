import type { Diagnostic, EvidenceRef } from '@arxic/contracts';

export const NODE_KINDS = [
  'Repository',
  'Revision',
  'File',
  'Symbol',
  'Config',
  'Route',
  'Endpoint',
  'UiSurface',
  'Control',
  'Handler',
  'Guard',
  'Validator',
  'Document',
  'RuntimeSurface',
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export const EDGE_KINDS = [
  'contains',
  'revises',
  'defines',
  'imports',
  'calls',
  'renders',
  'handles',
  'guards',
  'validates',
  'configures',
  'exposes',
] as const;

export type EdgeKind = (typeof EDGE_KINDS)[number];
export type NonEmptyEvidenceRefs = readonly [EvidenceRef, ...EvidenceRef[]];

export type GraphNodeInput = {
  type: 'node';
  id: string;
  kind: NodeKind;
  label: string;
  data?: Readonly<Record<string, unknown>>;
  evidenceRefs?: readonly EvidenceRef[];
};

type EdgeBase = {
  type: 'edge';
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  data?: Readonly<Record<string, unknown>>;
};

export type OutputInfluencingGraphEdgeInput = EdgeBase & {
  outputInfluencing: true;
  evidenceRefs: NonEmptyEvidenceRefs;
};

export type InformationalGraphEdgeInput = EdgeBase & {
  outputInfluencing: false;
  evidenceRefs?: readonly EvidenceRef[];
};

export type GraphEdgeInput = OutputInfluencingGraphEdgeInput | InformationalGraphEdgeInput;

/**
 * Frozen EvidenceEvent intentionally has no graph semantics. GraphIngestEvent is the local bridge:
 * callers attach explicit node/edge meaning, while richer adapter results are mapped by builders.
 */
export type GraphIngestEvent = GraphNodeInput | GraphEdgeInput;

export type GraphNodeAttributes = Omit<GraphNodeInput, 'type' | 'id'> & {
  evidenceRefs: EvidenceRef[];
};
export type GraphEdgeAttributes = Omit<GraphEdgeInput, 'type' | 'id' | 'source' | 'target'> & {
  evidenceRefs: EvidenceRef[];
};
export type EvidenceGraphAttributes = { schemaVersion: 1 };

export type GraphBuildResult = {
  graph: import('graphology').default<
    GraphNodeAttributes,
    GraphEdgeAttributes,
    EvidenceGraphAttributes
  >;
  diagnostics: Diagnostic[];
};
