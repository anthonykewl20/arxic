import type { EvidenceRefRuntime, EvidenceRefSource } from '@arxic/contracts';
import { validateInterchange } from './interchange';
import { clusterInventory } from './cluster';
import { matchRuntimePath, normalizePath } from './normalize-path';
import {
  INVENTORY_SCHEMA_VERSION,
  type DomainInventory,
  type InventoryInputs,
  type InventoryRow,
  type ObservedForm,
} from './types';

/**
 * Deterministic fusion of the source side (TS/JS via `@arxic/source-ua-adapter`
 * output shape; PHP via the INTERCHANGE format) with the runtime side
 * (`@arxic/crawlee-adapter` SurfaceMap shape) into ONE deduplicated
 * denominator. No LLM anywhere. Every input surface lands in exactly one row;
 * everything that cannot be enumerated becomes an explicit gap row.
 */

const ROUTE_RULE = /^route:(?<method>[A-Z]+) (?<path>.+)$/u;
const EXTENSION_LANGUAGE: Record<string, string> = {
  '.php': 'php',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.rs': 'rust',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.dart': 'dart',
  '.scala': 'scala',
  '.cpp': 'cpp',
  '.c': 'c',
};

type RowDraft = InventoryRow;

export function buildInventory(inputs: InventoryInputs & { now?: () => string }): DomainInventory {
  const now = inputs.now ?? (() => new Date().toISOString());
  const rows = new Map<string, RowDraft>();
  const dedupe = {
    sourceRouteEvents: 0,
    interchangeRoutes: 0,
    runtimeSurfaces: 0,
    runtimeForms: 0,
    mergedRows: 0,
  };

  const upsert = (key: string, mutate: (row: RowDraft) => void, create: () => RowDraft): void => {
    const existing = rows.get(key);
    if (existing) {
      dedupe.mergedRows += 1;
      mutate(existing);
      return;
    }
    const row = create();
    rows.set(key, row);
  };

  const baseRow = (overrides: Partial<RowDraft>): RowDraft => ({
    key: '',
    surfaceKind: 'page',
    method: 'GET',
    path: '',
    origin: 'source',
    sourceRefs: [],
    runtimeRefs: [],
    runtimeUrls: [],
    observedForms: [],
    disposition: 'unextracted-with-reason',
    reason: '',
    domain: 'uncategorized',
    verbs: [],
    count: 1,
    ...overrides,
  });

  // ---- 1. TS/JS source side (source-ua-adapter NormalizedSourceIndex shape) ----
  if (inputs.sourceIndex) {
    for (const event of inputs.sourceIndex.events) {
      const ref = event.ref as Partial<EvidenceRefSource> | undefined;
      if (ref?.kind === 'source' && typeof ref.ruleId === 'string') {
        const match = ROUTE_RULE.exec(ref.ruleId);
        if (match?.groups) {
          dedupe.sourceRouteEvents += 1;
          const method = match.groups.method;
          const normalized = normalizePath(match.groups.path);
          const key = `${method} ${normalized.text}`;
          const sourceRef = ref as EvidenceRefSource;
          upsert(
            key,
            (row) => {
              row.sourceRefs.push(sourceRef);
              row.origin = 'source';
            },
            () =>
              baseRow({
                key,
                surfaceKind: method === 'GET' ? 'page' : 'endpoint',
                method,
                path: normalized.text,
                origin: 'source',
                sourceRefs: [sourceRef],
                disposition: 'extracted',
                reason: '',
                language: 'typescript',
              }),
          );
          continue;
        }
      }
      const diagnostic = event.diagnostic as { code?: string } | undefined;
      if (diagnostic?.code) {
        const reason = `source-scan-diagnostic:${diagnostic.code}`;
        upsert(
          `* ${reason}`,
          () => undefined,
          () =>
            baseRow({
              key: `* ${reason}`,
              surfaceKind: 'unknown',
              method: '*',
              path: `<scan-diagnostic:${diagnostic.code}>`,
              origin: 'source',
              disposition: 'unextracted-with-reason',
              reason,
            }),
        );
      }
    }

    // Manifest gap accounting — no silent drops for files the scanner skipped.
    const unsupportedByLanguage = new Map<string, number>();
    for (const file of inputs.sourceIndex.manifest) {
      if (file.reason === 'unsupported-language' && file.category === 'code') {
        const extension = file.path.slice(file.path.lastIndexOf('.'));
        const language = EXTENSION_LANGUAGE[extension] ?? extension.replace('.', '');
        unsupportedByLanguage.set(language, (unsupportedByLanguage.get(language) ?? 0) + 1);
      } else if (file.reason === 'parse-error') {
        const reason = 'source-parse-error';
        upsert(
          `* ${reason}:${file.path}`,
          () => undefined,
          () =>
            baseRow({
              key: `* ${reason}:${file.path}`,
              surfaceKind: 'unknown',
              method: '*',
              path: `<parse-error:${file.path}>`,
              origin: 'source',
              disposition: 'unextracted-with-reason',
              reason,
            }),
        );
      }
    }
    for (const [language, fileCount] of [...unsupportedByLanguage].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const reason = `language-not-covered:${language} (${fileCount} files)`;
      upsert(
        `* <unsupported-language:${language}>`,
        (row) => {
          row.count += 1;
        },
        () =>
          baseRow({
            key: `* <unsupported-language:${language}>`,
            surfaceKind: 'unknown',
            method: '*',
            path: `<unsupported-language:${language}>`,
            origin: 'source',
            disposition: 'unsupported',
            reason,
            count: fileCount,
          }),
      );
    }
  }

  // ---- 2. PHP side (INTERCHANGE format; validated fail-closed) ----
  const interchangePacks: string[] = [];
  for (const candidate of inputs.interchanges ?? []) {
    const validation = validateInterchange(candidate);
    if (!validation.ok) {
      const reason = `interchange-invalid:${validation.diagnostics[0]?.message ?? 'rejected'}`;
      upsert(
        `* ${reason}`,
        () => undefined,
        () =>
          baseRow({
            key: `* ${reason}`,
            surfaceKind: 'unknown',
            method: '*',
            path: `<interchange-invalid>`,
            origin: 'source',
            disposition: 'unextracted-with-reason',
            reason,
          }),
      );
      continue;
    }
    const pack = validation.value;
    interchangePacks.push(pack.packId);
    for (const route of pack.routes) {
      dedupe.interchangeRoutes += 1;
      for (const method of route.methods) {
        const normalized = normalizePath(route.uri);
        const key = `${method} ${normalized.text}`;
        const sourceRef: EvidenceRefSource = {
          kind: 'source',
          repo: pack.provenance.repository,
          commit: pack.provenance.commit,
          path: route.sourcePath,
          startLine: route.startLine,
          endLine: route.endLine,
          blobSha256:
            pack.files.find((file) => file.path === route.sourcePath)?.sha256 ?? '0'.repeat(64),
          extractor: pack.packId,
          ruleId: `route:${method} ${route.uri}`,
        };
        upsert(
          key,
          (row) => {
            row.sourceRefs.push(sourceRef);
            row.origin = 'source';
            if (row.disposition !== 'extracted') {
              row.disposition = 'extracted';
              row.reason = '';
            }
          },
          () =>
            baseRow({
              key,
              surfaceKind: method === 'GET' ? 'page' : 'endpoint',
              method,
              path: normalized.text,
              origin: 'source',
              sourceRefs: [sourceRef],
              disposition: 'extracted',
              reason: '',
              language: pack.language,
              framework: pack.framework,
              ...(route.conditional ? { conditional: true } : {}),
            }),
        );
      }
    }
    for (const gap of pack.gaps) {
      const reason = `interchange-gap:${gap.kind}:${gap.reason}`;
      upsert(
        `* ${reason}:${gap.sourcePath}:${gap.startLine ?? 0}`,
        () => undefined,
        () =>
          baseRow({
            key: `* ${reason}:${gap.sourcePath}:${gap.startLine ?? 0}`,
            surfaceKind: 'unknown',
            method: '*',
            path: `<interchange-gap:${gap.sourcePath}>`,
            origin: 'source',
            disposition: gap.kind === 'unsupported' ? 'unsupported' : 'unextracted-with-reason',
            reason,
            language: pack.language,
          }),
      );
    }
  }

  // ---- 3. Runtime side (crawlee-adapter SurfaceMap shape) ----
  if (inputs.surfaceMap) {
    for (const route of inputs.surfaceMap.routes) {
      dedupe.runtimeSurfaces += 1;
      const runtimeRef = route.evidence as EvidenceRefRuntime | undefined;
      const attach = (row: RowDraft): void => {
        if (runtimeRef) row.runtimeRefs.push(runtimeRef);
        if (!row.runtimeUrls.includes(route.url)) row.runtimeUrls.push(route.url);
        if (row.origin === 'source') row.origin = 'both';
      };
      const matched = findRuntimeMatch(route.path, [...rows.values()]);
      if (matched) {
        attach(matched);
        continue;
      }
      const reason = 'no-source-match';
      upsert(`GET ${route.path}`, attach, () =>
        baseRow({
          key: `GET ${route.path}`,
          surfaceKind: 'page',
          method: 'GET',
          path: route.path,
          origin: 'runtime',
          runtimeRefs: runtimeRef ? [runtimeRef] : [],
          runtimeUrls: [route.url],
          disposition: 'unextracted-with-reason',
          reason,
        }),
      );
    }

    // Destructive (mutating) forms: endpoint surfaces observed but never
    // submitted under the default-deny mutation policy.
    for (const route of inputs.surfaceMap.routes) {
      for (const form of route.forms) {
        if (!form.destructive) continue;
        dedupe.runtimeForms += 1;
        const actionPath = safePath(form.action, inputs.surfaceMap.origin);
        if (actionPath === null) continue;
        const formFact: ObservedForm = {
          action: form.action,
          method: form.method.toUpperCase(),
          destructive: form.destructive,
        };
        const matched = findRuntimeMatch(actionPath, [...rows.values()], form.method.toUpperCase());
        if (matched) {
          if (!matched.observedForms.some((f) => f.action === formFact.action)) {
            matched.observedForms.push(formFact);
          }
          if (matched.origin === 'source') matched.origin = 'both';
          continue;
        }
        const reason = 'destructive-form-not-submitted';
        upsert(
          `${form.method.toUpperCase()} ${actionPath}`,
          (row) => {
            if (!row.observedForms.some((f) => f.action === formFact.action)) {
              row.observedForms.push(formFact);
            }
          },
          () =>
            baseRow({
              key: `${form.method.toUpperCase()} ${actionPath}`,
              surfaceKind: 'endpoint',
              method: form.method.toUpperCase(),
              path: actionPath,
              origin: 'runtime',
              observedForms: [formFact],
              disposition: 'unsafe',
              reason,
            }),
        );
      }
    }

    // Frontier-bound same-origin links: known surfaces the crawl never reached.
    for (const edge of inputs.surfaceMap.navigationEdges) {
      if (
        edge.status !== 'blocked' ||
        edge.reason === 'external-origin' ||
        edge.reason === undefined
      )
        continue;
      const toPath = safePath(edge.to, inputs.surfaceMap.origin);
      if (toPath === null) continue;
      if (findRuntimeMatch(toPath, [...rows.values()])) continue;
      const reason = `crawl-frontier-bound:${edge.reason}`;
      upsert(
        `GET ${toPath}`,
        () => undefined,
        () =>
          baseRow({
            key: `GET ${toPath}`,
            surfaceKind: 'page',
            method: 'GET',
            path: toPath,
            origin: 'runtime',
            disposition: 'unextracted-with-reason',
            reason,
          }),
      );
    }
  }

  const sortedRows = [...rows.values()].sort(rowOrder);
  const clustered = clusterInventory(sortedRows);
  return {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    generatedAt: now(),
    inputs: {
      sourceIndex: inputs.sourceIndex !== undefined,
      interchangePacks,
      ...(inputs.surfaceMap ? { surfaceMapOrigin: inputs.surfaceMap.origin } : {}),
    },
    rows: sortedRows.map((row) => ({ ...row, runtimeUrls: [...row.runtimeUrls].sort() })),
    clusters: clustered,
    stats: {
      totalRows: sortedRows.length,
      byDisposition: countBy(sortedRows, (row) => row.disposition, DISPOSITIONS),
      byOrigin: countBy(sortedRows, (row) => row.origin, ORIGINS),
      dedupe,
    },
  };
}

function rowOrder(left: InventoryRow, right: InventoryRow): number {
  return codepointCompare(`${left.path}\0${left.method}`, `${right.path}\0${right.method}`);
}

/** Locale-independent ordering (localeCompare varies with the host ICU). */
export function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const DISPOSITIONS = ['extracted', 'unsupported', 'unsafe', 'unextracted-with-reason'] as const;
const ORIGINS = ['source', 'runtime', 'both'] as const;

function countBy<K extends string>(
  rows: InventoryRow[],
  selector: (row: InventoryRow) => K,
  keys: readonly K[],
): Record<K, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const row of rows) {
    const key = selector(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function findRuntimeMatch(
  concretePath: string,
  candidates: InventoryRow[],
  method = 'GET',
): InventoryRow | null {
  let best: InventoryRow | null = null;
  for (const row of candidates) {
    if (row.method !== method) continue;
    if (!row.path.includes(':param')) {
      if (row.path === concretePath) return row;
      continue;
    }
    if (matchRuntimePath(concretePath, normalizePath(row.path))) {
      // Prefer the least-parameterized match (deterministic tie-break: the
      // candidate that matched earlier keeps priority only on equal shape).
      if (best === null || countParams(row.path) < countParams(best.path)) best = row;
    }
  }
  return best;
}

function countParams(path: string): number {
  return (path.match(/:param/gu) ?? []).length;
}

function safePath(url: string, origin: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== new URL(origin).origin) return null;
    return parsed.pathname;
  } catch {
    return null;
  }
}
