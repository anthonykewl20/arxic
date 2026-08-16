import { sha256 } from '@arxic/contracts';
import type { Diagnostic, EvidenceRef, EvidenceRefSource } from '@arxic/contracts';
import type { InventoryRow as ConsumerRowShape } from '@arxic/intent-proposal-spike';
import type { DomainInventory, InventoryDisposition } from './types';

/**
 * CANONICAL SCHEMA RECONCILIATION (DG-06, binding #250 contract comment).
 *
 * Two shapes existed after the research spikes:
 *
 * | Concern   | DG-04 consumer (stand-in)                    | DG-02 canonical rows               |
 * |-----------|----------------------------------------------|------------------------------------|
 * | identity  | stable string `id`                           | `key` (`METHOD normalized-path`)   |
 * | surface   | `surface: 'route' | 'page'`                  | `surfaceKind: 'page'|'endpoint'|…` |
 * | domain    | `domainHint` (advisory)                      | `domain` (advisory cluster label)  |
 * | evidence  | `evidenceIds: string[]`                      | `sourceRefs: EvidenceRefSource[]`  |
 * | disposition | absent                                     | `disposition` + mandatory `reason` |
 *
 * DECISION: the DG-02 row is CANONICAL. ADR-008 Decision 2 makes the
 * disposition enum a product requirement (no silent drops) and Decision 6
 * makes structured, line-anchored `EvidenceRef`s mandatory for grounding;
 * string evidence ids cannot carry line anchors, and a consumer shape without
 * dispositions cannot express the honest denominator. The DG-04 CONSUMER
 * shape (id/surface/domainHint/evidenceIds) is a PROJECTION for the proposal
 * batcher, produced by this adapter — never a second source of truth.
 *
 * Id grammar settlement (DG-02 §7 dissent): the stand-in grammar
 * `inv:<surface>:<METHOD>:<sanitized path>:<sha8>:<line>` inherits
 * separator-collision ambiguity (sanitize maps distinct paths onto one id
 * component). The reconciled grammar is collision-RESISTANT
 * (validator-deduped):
 *
 *   inv:<surface>:<METHOD>:<sha256(fusion key) first 12 hex>
 *
 * The fusion key is unique across the inventory (validator-enforced), and a
 * 48-bit truncated sha256 over unique inputs makes an accidental id collision
 * impractical — not impossible — so the ids are additionally checked for
 * uniqueness in their unit suite (a set-size assertion); the id is
 * content-derived and line-independent, so re-scans of the same tree (and
 * refactors that only move lines) reproduce identical ids — proposals can
 * cite them verbatim across runs.
 *
 * The type below is DG-04's actual `InventoryRow` (type-only import): the
 * Equal<> lockstep assertion in `__tests__/consumer-adapter.test.ts` fails
 * this package's typecheck if either side drifts.
 */
export type ProposalConsumerRow = ConsumerRowShape;

export type ProposalConsumerInventory = {
  readonly kind: 'arxic-domain-inventory-v1';
  readonly standIn: false;
  readonly rows: readonly ProposalConsumerRow[];
  readonly source: { tool: string; commit: string | null; repository: string };
  /** Every evidence id cited by a row, resolvable through `evidenceIndex`. */
  readonly evidenceIndex: Readonly<Record<string, EvidenceRef>>;
  /**
   * The non-extracted denominator slice, kept visible so a consumer cannot
   * mistake "0 proposal inputs" for "0 surfaces" (ADR-008 Decision 2).
   */
  readonly omitted: {
    total: number;
    byDisposition: Record<InventoryDisposition, number>;
  };
  readonly diagnostics: readonly Diagnostic[];
};

/**
 * Evidence id grammar, IDENTICAL to stage-4 inference / the DG-04 consumer
 * (`src:<sanitized path>:<start>-<end>`): proposals cite these ids verbatim,
 * so the grammar is part of the consumer contract and must not drift.
 */
export function sourceEvidenceId(ref: EvidenceRefSource): string {
  return `src:${sanitize(ref.path)}:${String(ref.startLine)}-${String(ref.endLine)}`;
}

/** Mirrors stage-4 `sanitize` (inference.ts) for id components. */
function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._#-]/gu, '-') || 'unknown';
}

export function consumerRowId(row: {
  surface: 'route' | 'page';
  method: string;
  key: string;
}): string {
  const digest = sha256(row.key).slice(0, 12);
  return `inv:${row.surface}:${row.method}:${digest}`;
}

/** Index every source EvidenceRef in the inventory under the id grammar above. */
export function buildConsumerEvidenceIndex(
  inventory: DomainInventory,
): Record<string, EvidenceRef> {
  const index: Record<string, EvidenceRef> = {};
  for (const row of inventory.rows) {
    for (const ref of row.sourceRefs) {
      index[sourceEvidenceId(ref)] ??= ref;
    }
  }
  return index;
}

/**
 * Surface projection (consumer semantics preserved): the DG-04 consumer's
 * `surface` distinguishes file-convention UI surfaces (`page`) from program
 * routes (`route`) by the EXTRACTOR that produced the evidence — mirrored
 * here verbatim from its exporter. The canonical `surfaceKind` (page =
 * GET-servable, endpoint = non-GET) remains the inventory's own truth; this
 * projection exists solely so proposal batching semantics do not change under
 * the consumer's feet when it switches to the real inventory.
 */
function consumerSurface(row: { sourceRefs: readonly { extractor: string }[] }): 'page' | 'route' {
  return row.sourceRefs.some((ref) => ref.extractor.includes('nextjs-file-conventions'))
    ? 'page'
    : 'route';
}

/**
 * Project canonical rows into the DG-04 consumer shape. Only `extracted`
 * rows become proposal inputs (every consumer row then carries ≥1 resolvable
 * evidence id, per the DG-04 header contract); non-extracted mass is returned
 * in `omitted` — visible, never dropped.
 */
export function toProposalConsumerInventory(inventory: DomainInventory): ProposalConsumerInventory {
  const rows: ProposalConsumerRow[] = [];
  const evidenceIndex: Record<string, EvidenceRef> = {};
  const omitted: ProposalConsumerInventory['omitted'] = {
    total: 0,
    byDisposition: {
      extracted: 0,
      unsupported: 0,
      unsafe: 0,
      'unextracted-with-reason': 0,
    },
  };

  for (const row of inventory.rows) {
    omitted.byDisposition[row.disposition] += 1;
    if (row.disposition !== 'extracted') {
      omitted.total += 1;
      continue;
    }
    const surface = consumerSurface(row);
    const evidenceIds = [...new Set(row.sourceRefs.map(sourceEvidenceId))].sort();
    for (const ref of row.sourceRefs) evidenceIndex[sourceEvidenceId(ref)] ??= ref;
    const firstRef = row.sourceRefs[0]!;
    rows.push({
      id: consumerRowId({ surface, method: row.method, key: row.key }),
      surface,
      method: row.method,
      path: row.path,
      sourcePath: firstRef.path,
      domainHint: row.domain,
      evidenceIds,
    });
  }

  rows.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const repository =
    inventory.rows.find((row) => row.sourceRefs[0])?.sourceRefs[0]?.repo ?? 'unknown';
  const commit = inventory.rows.find((row) => row.sourceRefs[0])?.sourceRefs[0]?.commit ?? null;

  return {
    kind: 'arxic-domain-inventory-v1',
    standIn: false,
    rows,
    source: { tool: '@arxic/domain-inventory', commit, repository },
    evidenceIndex,
    omitted,
    diagnostics: [...(inventory.diagnostics ?? [])],
  };
}
