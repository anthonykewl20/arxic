import type { EvidenceRefRuntime, EvidenceRefSource } from '@arxic/contracts';
import type { RouteInventoryInterchange } from './interchange';

/**
 * DG-02 spike types. One row per deduplicated surface in the deterministic
 * denominator (issue #246 / ADR-008 Decision 2). NO LLM participates anywhere
 * in building this inventory.
 */

export const INVENTORY_SCHEMA_VERSION = 1;

/** The binding disposition enum — every row carries exactly one. */
export type InventoryDisposition =
  'extracted' | 'unsupported' | 'unsafe' | 'unextracted-with-reason';

export type SurfaceKind = 'page' | 'endpoint' | 'unknown';

export type RowOrigin = 'source' | 'runtime' | 'both';

export type NormalizedSegment = {
  raw: string;
  param: boolean;
  optional: boolean;
};

export type NormalizedPath = {
  /** Canonical text, e.g. `/api/albums/:param/songs` (optional tail kept as `:param?`). */
  text: string;
  segments: NormalizedSegment[];
};

/** A runtime-observed form fact attached to the row it targets. */
export type ObservedForm = {
  action: string;
  method: string;
  destructive: boolean;
};

export type InventoryRow = {
  /** Canonical fusion key: `METHOD normalized-path`. Unique across the inventory. */
  key: string;
  surfaceKind: SurfaceKind;
  method: string;
  /** Normalized path (source rows) or concrete path (runtime-only rows). */
  path: string;
  origin: RowOrigin;
  /** Line-anchored source evidence; mandatory non-empty for `extracted` rows. */
  sourceRefs: EvidenceRefSource[];
  /** Runtime observations (volatile fields stripped by canonical serialization). */
  runtimeRefs: EvidenceRefRuntime[];
  /** Concrete runtime URLs observed for this surface, deduped + sorted. */
  runtimeUrls: string[];
  observedForms: ObservedForm[];
  disposition: InventoryDisposition;
  /** REQUIRED (non-empty) for every disposition except `extracted`. */
  reason: string;
  /** Deterministic cluster label from resource/noun + verb heuristics. */
  domain: string;
  verbs: string[];
  language?: string;
  framework?: string;
  /** Interchange routes registered inside an `if (...)` block. */
  conditional?: boolean;
  /** File-count mass for aggregated gap rows (informational; 1 for normal rows). */
  count: number;
};

export type DomainCluster = {
  domain: string;
  rowKeys: string[];
  verbs: string[];
  methods: string[];
  dispositions: Record<InventoryDisposition, number>;
};

export type InventoryInputs = {
  /** Output of `@arxic/source-ua-adapter` `collect()` (read-only consumption). */
  sourceIndex?: {
    revision: { repository: string; commit: string | null; dirty: boolean };
    manifest: Array<{
      path: string;
      blobSha256: string;
      sizeBytes: number;
      language: string;
      category: string;
      status: string;
      reason?: string;
    }>;
    events: Array<{ ref?: unknown; diagnostic?: unknown }>;
    toolVersions: Record<string, string>;
    generatedAt: string;
  };
  /** PHP-side route inventories in the documented INTERCHANGE format. */
  interchanges?: Array<RouteInventoryInterchange>;
  /** Output of `@arxic/crawlee-adapter` `collect()` (read-only consumption). */
  surfaceMap?: {
    schemaVersion: number;
    truthState: 'observed';
    origin: string;
    routes: Array<{
      truthState: 'observed';
      url: string;
      path: string;
      depth: number;
      title: string;
      forms: Array<{
        action: string;
        method: string;
        destructive: boolean;
        controls?: Array<Record<string, unknown>>;
      }>;
      controls: Array<Record<string, unknown>>;
      links: Array<{ href: string; text: string; external: boolean }>;
      evidence?: EvidenceRefRuntime;
    }>;
    navigationEdges: Array<{
      from: string;
      to: string;
      depth: number;
      status: 'observed' | 'blocked';
      reason?: 'external-origin' | 'max-depth' | 'max-urls';
    }>;
    diagnostics: Array<Record<string, unknown>>;
  };
};

export type InventoryStats = {
  totalRows: number;
  byDisposition: Record<InventoryDisposition, number>;
  byOrigin: Record<RowOrigin, number>;
  dedupe: {
    sourceRouteEvents: number;
    interchangeRoutes: number;
    runtimeSurfaces: number;
    runtimeForms: number;
    mergedRows: number;
  };
};

export type DomainInventory = {
  schemaVersion: typeof INVENTORY_SCHEMA_VERSION;
  generatedAt: string;
  inputs: {
    sourceIndex: boolean;
    interchangePacks: string[];
    surfaceMapOrigin?: string;
  };
  rows: InventoryRow[];
  clusters: DomainCluster[];
  stats: InventoryStats;
};
