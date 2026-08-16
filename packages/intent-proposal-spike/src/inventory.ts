import type { Diagnostic, EvidenceRef } from '@arxic/contracts';
import type { NormalizedSourceIndex } from '@arxic/source-ua-adapter';

/**
 * DG-04 PROVISIONAL STAND-IN for the DG-02 Domain Inventory (#246).
 *
 * The real Domain Inventory is a deterministic fusion of per-language-pack
 * source enumeration with the runtime crawl surface (ADR-008 Decision 2). It
 * does not exist yet. This exporter produces the MINIMAL deterministic subset
 * DG-04's proposer needs, derived read-only from `@arxic/source-ua-adapter`
 * output shapes (`NormalizedSourceIndex`):
 *
 * CONSUMER CONTRACT (feeds DG-02 / DG-06 — keep in sync when the real stage
 * replaces this):
 *
 * 1. `exportInventory(index)` maps every `ruleId: 'route:<METHOD> <path>'`
 *    source finding of the scan to exactly one inventory row; rows are deduped
 *    by (surface, method, path, sourcePath) and merge their evidence ids.
 * 2. Row ids are STABLE and content-derived:
 *    `inv:<surface>:<METHOD>:<sanitized path>:<blobSha256[0..8]>:<startLine>`
 *    so a re-scan of the same tree reproduces identical ids (proposals cite
 *    them verbatim; a stable grammar keeps citations checkable).
 * 3. Every row carries >=1 evidence id resolvable through `buildEvidenceIndex`
 *    (same `src:<path>:<start>-<end>` grammar as stage-4 inference
 *    `evidenceId()`, packages/orchestrator-langgraph/src/inference.ts:43-49).
 * 4. `domainHint` is a DETERMINISTIC advisory heuristic (first word-like route
 *    path segment, else the file stem; Next.js App Router pages resolve to
 *    their first URL segment, root page -> 'home'). It is used only for batch
 *    grouping; the MODEL chooses actual domains. Real domain clustering is
 *    DG-02's job (ADR-008 risk "Domain clustering quality").
 * 5. Paths are AS EXTRACTED: Express findings may be controller-relative
 *    (e.g. `GET /:id`) because prefix mounting (`router.use(prefix, ctrl)`) is
 *    not emitted by the current extractor. Full-path reconstruction is a DG-02
 *    requirement; this stand-in documents the gap instead of hiding it.
 * 6. Scan diagnostics pass through untouched — unsupported languages stay
 *    visible (ADR-008 Decision 5), so the denominator stays honest.
 */

export type InventorySurface = 'route' | 'page';

export type InventoryRow = {
  readonly id: string;
  readonly surface: InventorySurface;
  readonly method: string;
  readonly path: string;
  readonly sourcePath: string;
  readonly domainHint: string;
  readonly evidenceIds: readonly string[];
};

export type DomainInventory = {
  readonly kind: 'arxic-domain-inventory-standin-v1';
  readonly standIn: true;
  readonly rows: readonly InventoryRow[];
  readonly source: { tool: string; commit: string | null; repository: string };
  readonly diagnostics: readonly Diagnostic[];
};

const ROUTE_RULE = /^route:([A-Z]+) (.+)$/u;

/** Mirrors stage-4's `sanitize` (inference.ts:275-277) for id components. */
function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._#-]/gu, '-') || 'unknown';
}

/**
 * Evidence id grammar identical to stage-4 `evidenceId()` for source refs
 * (packages/orchestrator-langgraph/src/inference.ts:43-49). Re-implemented
 * here because the orchestrator package does not export it and DG-04 must not
 * edit it.
 */
export function sourceEvidenceId(ref: Extract<EvidenceRef, { kind: 'source' }>): string {
  return `src:${sanitize(ref.path)}:${String(ref.startLine)}-${String(ref.endLine)}`;
}

export function buildEvidenceIndex(index: NormalizedSourceIndex): Record<string, EvidenceRef> {
  const result: Record<string, EvidenceRef> = {};
  for (const event of index.events) {
    if ('ref' in event && event.ref.kind === 'source') {
      result[sourceEvidenceId(event.ref)] = event.ref;
    }
  }
  return result;
}

function domainHintFor(
  path: string,
  sourcePath: string,
  method: string,
  surface: InventorySurface,
): string {
  const firstSegment = path.split('/').find((segment) => segment.length > 0);
  if (firstSegment && /^[a-z][a-z0-9-]*$/iu.test(firstSegment) && firstSegment !== 'api') {
    return firstSegment.toLowerCase();
  }
  if (surface === 'page' && (path === '/' || path === '')) return 'home';
  const stem = sourcePath.split('/').pop() ?? sourcePath;
  const base = stem.replace(/\.(?:tsx?|jsx?|mjs|cjs|vue|php|py|rb|go|java)$/u, '');
  const collapsed = base
    .replace(/[^A-Za-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
  return collapsed || `${method.toLowerCase()}-root`;
}

type RowKey = string;

function rowKey(
  surface: InventorySurface,
  method: string,
  path: string,
  sourcePath: string,
): RowKey {
  return [surface, method, path, sourcePath].join('\0');
}

function rowId(
  surface: InventorySurface,
  method: string,
  path: string,
  blobSha256: string,
  startLine: number,
): string {
  const sanitizedPath = path.replace(/[^A-Za-z0-9._#/$~{}-]/gu, '-') || 'root';
  return `inv:${surface}:${method}:${sanitizedPath}:${blobSha256.slice(0, 8)}:${String(startLine)}`;
}

export function exportInventory(index: NormalizedSourceIndex): DomainInventory {
  const byKey = new Map<RowKey, { row: InventoryRow; evidence: Set<string> }>();
  const order: RowKey[] = [];

  for (const event of index.events) {
    if (!('ref' in event) || event.ref.kind !== 'source') continue;
    const ref = event.ref;
    const match = ROUTE_RULE.exec(ref.ruleId ?? '');
    if (!match) continue;
    const [, method, path] = match;
    const surface: InventorySurface = ref.extractor.includes('nextjs-file-conventions')
      ? 'page'
      : 'route';
    const evidenceId = sourceEvidenceId(ref);
    const key = rowKey(surface, method, path, ref.path);
    if (!byKey.has(key)) {
      byKey.set(key, {
        row: {
          id: rowId(surface, method, path, ref.blobSha256, ref.startLine),
          surface,
          method,
          path,
          sourcePath: ref.path,
          domainHint: domainHintFor(path, ref.path, method, surface),
          evidenceIds: [],
        },
        evidence: new Set<string>(),
      });
      order.push(key);
    }
    byKey.get(key)?.evidence.add(evidenceId);
  }

  const rows = order
    .map((key) => {
      const entry = byKey.get(key);
      if (!entry) throw new Error('inventory ordering invariant violated');
      return { ...entry.row, evidenceIds: [...entry.evidence].sort() } satisfies InventoryRow;
    })
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  return {
    kind: 'arxic-domain-inventory-standin-v1',
    standIn: true,
    rows,
    source: {
      tool: 'source-ua-adapter',
      commit: index.revision.commit,
      repository: index.revision.repository,
    },
    diagnostics: index.events.flatMap((event) => ('diagnostic' in event ? [event.diagnostic] : [])),
  };
}
