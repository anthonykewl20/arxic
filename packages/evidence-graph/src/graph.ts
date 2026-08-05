import type { Diagnostic, EvidenceRef } from '@arxic/contracts';
import Graph from 'graphology';
import {
  ARXIC_GRAPH_EDGE_CONFLICT,
  ARXIC_GRAPH_EDGE_EVIDENCE_MISSING,
  ARXIC_GRAPH_NODE_CONFLICT,
  graphDiagnostic,
} from './diagnostics';
import { canonicalJson, codepointCompare, evidenceRefId, type EvidenceGraph } from './serialize';
import type {
  GraphBuildResult,
  GraphEdgeAttributes,
  GraphEdgeInput,
  GraphIngestEvent,
  GraphNodeAttributes,
  GraphNodeInput,
} from './types';

export class EvidenceGraphContainer {
  readonly graph: EvidenceGraph;
  readonly diagnostics: Diagnostic[] = [];

  constructor() {
    this.graph = new Graph<GraphNodeAttributes, GraphEdgeAttributes, { schemaVersion: 1 }>({
      type: 'directed',
      multi: true,
    });
    this.graph.setAttribute('schemaVersion', 1);
  }

  ingest(events: readonly GraphIngestEvent[]): GraphBuildResult {
    for (const event of events) {
      if (event.type === 'node') this.addNode(event);
      else this.addEdge(event);
    }
    return this.result();
  }

  addNode(input: GraphNodeInput): boolean {
    const attributes: GraphNodeAttributes = {
      kind: input.kind,
      label: input.label,
      ...(input.data ? { data: input.data } : {}),
      evidenceRefs: sortedEvidence(input.evidenceRefs ?? []),
    };
    if (!this.graph.hasNode(input.id)) {
      this.graph.addNode(input.id, attributes);
      return true;
    }
    const existing = this.graph.getNodeAttributes(input.id);
    if (canonicalJson(withoutEvidence(existing)) !== canonicalJson(withoutEvidence(attributes))) {
      this.diagnostics.push(
        graphDiagnostic(
          ARXIC_GRAPH_NODE_CONFLICT,
          'contradicted',
          input.id,
          'The same graph node id was supplied with conflicting structural attributes.',
          [...existing.evidenceRefs, ...attributes.evidenceRefs],
        ),
      );
      return false;
    }
    this.graph.replaceNodeAttributes(input.id, {
      ...existing,
      evidenceRefs: sortedEvidence([...existing.evidenceRefs, ...attributes.evidenceRefs]),
    });
    return true;
  }

  addEdge(input: GraphEdgeInput): boolean {
    if (input.outputInfluencing && input.evidenceRefs.length === 0) {
      this.diagnostics.push(
        graphDiagnostic(
          ARXIC_GRAPH_EDGE_EVIDENCE_MISSING,
          'blocked',
          input.id,
          'Output-influencing graph edges require at least one EvidenceRef.',
        ),
      );
      return false;
    }
    const attributes: GraphEdgeAttributes = {
      kind: input.kind,
      outputInfluencing: input.outputInfluencing,
      ...(input.data ? { data: input.data } : {}),
      evidenceRefs: sortedEvidence(input.evidenceRefs ?? []),
    };
    if (this.graph.hasEdge(input.id)) {
      const existing = this.graph.getEdgeAttributes(input.id);
      const endpointsMatch =
        this.graph.source(input.id) === input.source &&
        this.graph.target(input.id) === input.target;
      if (
        !endpointsMatch ||
        canonicalJson(withoutEvidence(existing)) !== canonicalJson(withoutEvidence(attributes))
      ) {
        this.diagnostics.push(
          graphDiagnostic(
            ARXIC_GRAPH_EDGE_CONFLICT,
            'contradicted',
            input.id,
            'The same graph edge id was supplied with conflicting endpoints or attributes.',
            [...existing.evidenceRefs, ...attributes.evidenceRefs],
          ),
        );
        return false;
      }
      this.graph.replaceEdgeAttributes(input.id, {
        ...existing,
        evidenceRefs: sortedEvidence([...existing.evidenceRefs, ...attributes.evidenceRefs]),
      });
      return true;
    }
    if (!this.graph.hasNode(input.source) || !this.graph.hasNode(input.target)) {
      throw new Error(`Edge ${input.id} references a missing node`);
    }
    this.graph.addDirectedEdgeWithKey(input.id, input.source, input.target, attributes);
    return true;
  }

  result(): GraphBuildResult {
    return { graph: this.graph, diagnostics: [...this.diagnostics] };
  }
}

function withoutEvidence<T extends { evidenceRefs: EvidenceRef[] }>(attributes: T) {
  return Object.fromEntries(Object.entries(attributes).filter(([key]) => key !== 'evidenceRefs'));
}

function sortedEvidence(evidence: readonly EvidenceRef[]): EvidenceRef[] {
  return [...new Map(evidence.map((ref) => [evidenceRefId(ref), ref])).entries()]
    .sort(([left], [right]) => codepointCompare(left, right))
    .map(([, ref]) => ref);
}
