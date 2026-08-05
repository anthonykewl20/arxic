import type { Diagnostic, EvidenceEvent, EvidenceRef, EvidenceRefSource } from '@arxic/contracts';
import type { AstGrepScanResult, EvidencedRuleMatch } from '@arxic/ast-grep-adapter';
import type { NormalizedSourceIndex } from '@arxic/source-ua-adapter';
import { EvidenceGraphContainer } from './graph';
import { canonicalJson, codepointCompare, evidenceRefId } from './serialize';
import type { EdgeKind, GraphBuildResult, GraphNodeInput, NodeKind } from './types';

export type StaticGraphInput = {
  source: NormalizedSourceIndex;
  rules: AstGrepScanResult;
};

export function buildStaticEvidenceGraph(input: StaticGraphInput): GraphBuildResult {
  const container = new EvidenceGraphContainer();
  const diagnostics: Diagnostic[] = [
    ...diagnosticsOf(input.source.events),
    ...diagnosticsOf(input.rules.events),
  ];
  const repositoryId = `repository:${input.source.revision.repository}`;
  const revisionId = `revision:${input.source.revision.repository}@${input.source.revision.commit ?? 'unknown'}`;
  container.addNode({
    type: 'node',
    id: repositoryId,
    kind: 'Repository',
    label: input.source.revision.repository,
  });
  container.addNode({
    type: 'node',
    id: revisionId,
    kind: 'Revision',
    label: input.source.revision.commit ?? 'unknown',
  });
  container.addEdge({
    type: 'edge',
    id: `${repositoryId}->${revisionId}:revises`,
    source: repositoryId,
    target: revisionId,
    kind: 'revises',
    outputInfluencing: false,
  });

  for (const file of [...input.source.manifest].sort((a, b) => codepointCompare(a.path, b.path))) {
    const fileId = fileNodeId(file.path);
    container.addNode({
      type: 'node',
      id: fileId,
      kind: 'File',
      label: file.path,
      data: { blobSha256: file.blobSha256, language: file.language, status: file.status },
    });
    container.addEdge({
      type: 'edge',
      id: `${revisionId}->${fileId}:contains`,
      source: revisionId,
      target: fileId,
      kind: 'contains',
      outputInfluencing: false,
    });
  }

  for (const event of input.source.events) {
    if ('ref' in event && event.ref.kind === 'source') addUaRef(container, event.ref);
  }
  for (const match of input.rules.matches) addRuleMatch(container, match);
  for (const chain of input.rules.chains.filter((candidate) => candidate.status === 'connected')) {
    const matches = chain.evidence
      .map((ref) => input.rules.matches.find((match) => sameRef(match.evidence, ref)))
      .filter((match): match is EvidencedRuleMatch => match !== undefined);
    const route = matches.find((match) => match.category === 'route');
    const handler = matches.find((match) => match.category === 'handler');
    const guards = matches.filter((match) => match.category === 'guard');
    if (!route || !handler) continue;
    addLinkedEdge(container, route, handler, 'handles');
    for (const guard of guards) addLinkedEdge(container, handler, guard, 'guards');
  }
  return { graph: container.graph, diagnostics: [...diagnostics, ...container.diagnostics] };
}

/** Plain EvidenceRefs remain ingestible when a caller supplies the missing frozen-contract semantics. */
export function graphNodeFromEvidence(
  ref: EvidenceRef,
  semantics: Omit<GraphNodeInput, 'type' | 'evidenceRefs'>,
): GraphNodeInput {
  return { type: 'node', ...semantics, evidenceRefs: [ref] };
}

export function ruleMatchNodeId(match: EvidencedRuleMatch): string {
  return `rule:${match.category}:${match.file}:${match.startLine}-${match.endLine}:${match.packId}/${match.ruleId}@${match.ruleVersion}`;
}

function addUaRef(container: EvidenceGraphContainer, ref: EvidenceRefSource): void {
  const [rawKind = 'symbol', ...valueParts] = (ref.ruleId ?? 'symbol:unknown').split(':');
  const value = valueParts.join(':');
  const kind: NodeKind = rawKind === 'route' ? 'Route' : 'Symbol';
  const nodeId = `source:${rawKind}:${ref.path}:${value}:${ref.startLine}-${ref.endLine}`;
  container.addNode({ type: 'node', id: nodeId, kind, label: value, evidenceRefs: [ref] });
  const edgeKind: EdgeKind =
    rawKind === 'import' ? 'imports' : rawKind === 'call' ? 'calls' : 'defines';
  container.addEdge({
    type: 'edge',
    id: `${fileNodeId(ref.path)}->${nodeId}:${edgeKind}`,
    source: fileNodeId(ref.path),
    target: nodeId,
    kind: edgeKind,
    outputInfluencing: true,
    evidenceRefs: [ref],
  });
}

function addRuleMatch(container: EvidenceGraphContainer, match: EvidencedRuleMatch): void {
  const id = ruleMatchNodeId(match);
  container.addNode({
    type: 'node',
    id,
    kind: nodeKindForCategory(match.category),
    label: match.ruleId,
    data: { category: match.category, fields: match.fields, framework: match.packId },
    evidenceRefs: [match.evidence],
  });
  container.addEdge({
    type: 'edge',
    id: `${fileNodeId(match.file)}->${id}:defines`,
    source: fileNodeId(match.file),
    target: id,
    kind: 'defines',
    outputInfluencing: true,
    evidenceRefs: [match.evidence],
  });
}

function addLinkedEdge(
  container: EvidenceGraphContainer,
  source: EvidencedRuleMatch,
  target: EvidencedRuleMatch,
  kind: 'handles' | 'guards',
): void {
  const sourceId = ruleMatchNodeId(source);
  const targetId = ruleMatchNodeId(target);
  container.addEdge({
    type: 'edge',
    id: `${sourceId}->${targetId}:${kind}`,
    source: sourceId,
    target: targetId,
    kind,
    outputInfluencing: true,
    evidenceRefs: [source.evidence, target.evidence],
  });
}

function nodeKindForCategory(category: string): NodeKind {
  if (category === 'route') return 'Route';
  if (category === 'handler') return 'Handler';
  if (category === 'guard') return 'Guard';
  if (category.includes('valid')) return 'Validator';
  if (category.includes('config') || category.includes('session')) return 'Config';
  if (category.includes('control') || category.includes('form')) return 'Control';
  if (category.includes('endpoint') || category.includes('transport')) return 'Endpoint';
  return 'Symbol';
}

function fileNodeId(path: string): string {
  return `file:${path}`;
}

function diagnosticsOf(events: EvidenceEvent[]): Diagnostic[] {
  return events.flatMap((event) => ('diagnostic' in event ? [event.diagnostic] : []));
}

function sameRef(left: EvidenceRef, right: EvidenceRef): boolean {
  return (
    evidenceRefId(left) === evidenceRefId(right) && canonicalJson(left) === canonicalJson(right)
  );
}
