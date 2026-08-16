import type { DomainInventory, InventoryRow } from '@arxic/domain-inventory';
import { EvidenceGraphContainer } from './graph';
import type { GraphBuildResult } from './types';
import { codepointCompare } from './serialize';

/**
 * DOMAIN INVENTORY → EVIDENCE GRAPH FUSION (DG-06 #250; ADR-001 §8.4):
 * every inventory row lands as a graph node; every OUTPUT-INFLUENCING edge
 * carries ≥1 EvidenceRef (fail-closed by EvidenceGraphContainer — a builder
 * bug surfaces as ARXIC-GRAPH-EDGE-EVIDENCE-MISSING, never a silent ungrounded
 * edge).
 *
 * Honest-grounding rule (ADR-008 Decision 6): only rows with ≥1 source
 * EvidenceRef get an output-influencing `defines` edge from their source FILE
 * node. Runtime-only / unsupported / gap rows carry their (possibly empty)
 * evidence at the NODE level and NO output-influencing edge — an ungrounded
 * row must stay visible without fabricating influence.
 */
export type InventoryGraphInput = Readonly<{
  inventory: DomainInventory;
}>;

/** Stable node id for an inventory row (its fusion key is unique). */
export function inventoryRowNodeId(row: Pick<InventoryRow, 'key'>): string {
  return `inventory-row:${row.key}`;
}

export function buildInventoryEvidenceGraph(input: InventoryGraphInput): GraphBuildResult {
  const container = new EvidenceGraphContainer();

  for (const row of [...input.inventory.rows].sort((left, right) =>
    codepointCompare(left.key, right.key),
  )) {
    if (row.sourceRefs.length > 0) {
      for (const file of new Set(row.sourceRefs.map((ref) => ref.path))) {
        container.addNode({
          type: 'node',
          id: fileNodeId(file),
          kind: 'File',
          label: file,
          data: { blobSha256: row.sourceRefs.find((ref) => ref.path === file)?.blobSha256 },
        });
      }
    }
    const nodeId = inventoryRowNodeId(row);
    container.addNode({
      type: 'node',
      id: nodeId,
      kind: nodeKindForRow(row),
      label: row.key,
      data: {
        disposition: row.disposition,
        surfaceKind: row.surfaceKind,
        method: row.method,
        path: row.path,
        domain: row.domain,
        origin: row.origin,
        ...(row.language ? { language: row.language } : {}),
        ...(row.framework ? { framework: row.framework } : {}),
      },
      evidenceRefs: [...row.sourceRefs, ...row.runtimeRefs],
    });
    if (row.sourceRefs.length > 0) {
      const files = [...new Set(row.sourceRefs.map((ref) => ref.path))].sort(codepointCompare);
      for (const file of files) {
        const refs = row.sourceRefs.filter((ref) => ref.path === file);
        // NonEmptyEvidenceRefs: at least one ref per file is guaranteed by the
        // filter above; the tuple satisfies the ≥1-EvidenceRef edge invariant.
        container.addEdge({
          type: 'edge',
          id: `${fileNodeId(file)}->${nodeId}:defines`,
          source: fileNodeId(file),
          target: nodeId,
          kind: 'defines',
          outputInfluencing: true,
          evidenceRefs: [refs[0]!, ...refs.slice(1)],
        });
      }
    }
  }

  return container.result();
}

function nodeKindForRow(row: InventoryRow) {
  if (row.surfaceKind === 'page') return 'UiSurface' as const;
  if (row.surfaceKind === 'endpoint') return 'Route' as const;
  return 'InventoryRow' as const;
}

function fileNodeId(path: string): string {
  return `file:${path}`;
}
