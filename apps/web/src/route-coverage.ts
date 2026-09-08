// Type-only imports: this module is consumed by the browser bundle, so no
// node-dependent value imports may appear here (the consumer projection used
// by campaigns lives in campaigns.ts, server-side).
import type { DomainInventory } from '@arxic/domain-inventory';
import type { FrontendInventory, FrontendRow } from '@arxic/source-ua-adapter';

/**
 * Route omission coverage (refs #402): associates the discovery inventory's
 * route rows with frontend declarations and exposes, per route, which
 * conditional-state markers (loading/error/empty) the route's OWN source
 * references, whether any test declaration covers its files, and whether any
 * documentation requirement does. Source-tier only: an absent marker is an
 * omission signal to investigate, never proof of absent behavior.
 */
export type RouteCoverageDimensionName =
  'state:loading' | 'state:error' | 'state:empty' | 'tests' | 'docs';
export type RouteCoverageDimension = {
  name: RouteCoverageDimensionName;
  status: 'referenced' | 'absent';
  evidence: Array<{ path: string; startLine: number; endLine: number; label: string }>;
};
export type RouteCoverage = {
  method: string;
  path: string;
  files: string[];
  dimensions: RouteCoverageDimension[];
};

/** Documented label patterns over condition/state declaration text. */
const statePatterns: ReadonlyArray<[RouteCoverageDimensionName, RegExp]> = [
  [
    'state:loading',
    /(?:^|[^a-z])(?:loading|isloading|pending|skeleton|spinner)(?:[^a-z]|$)|aria-busy/iu,
  ],
  ['state:error', /(?:^|[^a-z])(?:error|failed|failure|invalid)(?:[^a-z]|$)|aria-invalid/iu],
  ['state:empty', /(?:^|[^a-z])(?:empty|no results|nothing)(?:[^a-z]|$)/iu],
];

const dimensionOrder: readonly RouteCoverageDimensionName[] = [
  'state:loading',
  'state:error',
  'state:empty',
  'tests',
  'docs',
];

/** A file owning a route's page/route surface per framework conventions. */
const routeSurfaceFile = /^(.*\/)?(?:page|route)\.(?:tsx?|jsx?|mts|mjs|ts|js)$/u;

/** Same-path colocated test pairing: <file>.test.<ext> or <dir>/__tests__/<file>.test.<ext>. */
const testPairOf = (file: string): RegExp => {
  const slash = file.lastIndexOf('/');
  const dir = slash >= 0 ? file.slice(0, slash + 1) : '';
  const base = slash >= 0 ? file.slice(slash + 1) : file;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^(?:${dir}|${dir}__tests__/)${escaped}\\.test\\.[a-z]+$`, 'u');
};

export function routeStateCoverage(
  inventory: DomainInventory,
  frontend: FrontendInventory,
): RouteCoverage[] {
  const rowsByPath = new Map<string, FrontendRow[]>();
  for (const row of frontend.rows) {
    const list = rowsByPath.get(row.source.path) ?? [];
    list.push(row);
    rowsByPath.set(row.source.path, list);
  }
  const coverage: RouteCoverage[] = [];
  for (const row of inventory.rows) {
    // Runtime-only rows and scan diagnostics carry no source files to associate.
    const refs = row.sourceRefs.filter((ref) => ref.path);
    if (!refs.length || row.method === '*') continue;
    const refPaths = [...new Set(refs.map(({ path }) => path))];
    // A page/route surface file associates its SAME-DIRECTORY siblings
    // (actions.ts and friends). Not nested directories: the root page's
    // directory is the whole app tree, and every nested file belongs to its
    // own route.
    const files = new Set(refPaths);
    for (const path of refPaths)
      if (routeSurfaceFile.test(path)) {
        const dir = path.includes('/') ? `${path.slice(0, path.lastIndexOf('/'))}/` : '';
        if (dir)
          for (const candidate of rowsByPath.keys())
            if (
              candidate.startsWith(dir) &&
              !candidate.slice(dir.length).includes('/') &&
              !routeSurfaceFile.test(candidate)
            )
              files.add(candidate);
      }
    const associated = [...files].flatMap((path) => rowsByPath.get(path) ?? []);
    const dimensions = dimensionOrder.map((name): RouteCoverageDimension => {
      let evidence: RouteCoverageDimension['evidence'];
      if (name.startsWith('state:')) {
        const pattern = statePatterns.find(([candidate]) => candidate === name)?.[1];
        evidence = (
          pattern
            ? associated.filter(
                (candidate) =>
                  (candidate.kind === 'condition' || candidate.kind === 'state') &&
                  pattern.test(candidate.label),
              )
            : []
        ).map(({ source, label }) => ({
          path: source.path,
          startLine: source.startLine,
          endLine: source.endLine,
          label,
        }));
      } else if (name === 'tests') {
        // Test declarations count when they live in an associated file or pair
        // colocated with one (page.tsx ↔ page.test.tsx / __tests__/page.test.ts).
        const pairs = [...files].map(testPairOf);
        evidence = frontend.rows
          .filter(
            (candidate) =>
              candidate.kind === 'test' &&
              (files.has(candidate.source.path) ||
                pairs.some((pair) => pair.test(candidate.source.path))),
          )
          .map(({ source, label }) => ({
            path: source.path,
            startLine: source.startLine,
            endLine: source.endLine,
            label,
          }));
      } else {
        // Documentation requirements count when they sit in an associated file
        // or name the route path in their declaration text.
        evidence = frontend.rows
          .filter(
            (candidate) =>
              candidate.kind === 'requirement' &&
              (files.has(candidate.source.path) || candidate.label.includes(row.path)),
          )
          .map(({ source, label }) => ({
            path: source.path,
            startLine: source.startLine,
            endLine: source.endLine,
            label,
          }));
      }
      evidence.sort(
        (left, right) => left.path.localeCompare(right.path) || left.startLine - right.startLine,
      );
      return { name, status: evidence.length ? 'referenced' : 'absent', evidence };
    });
    coverage.push({
      method: row.method,
      path: row.path,
      files: [...files].sort(),
      dimensions,
    });
  }
  return coverage.sort(
    (left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method),
  );
}
