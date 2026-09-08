// Type-only imports: this module is consumed by the browser bundle, so no
// node-dependent value imports may appear here (the consumer projection used
// by campaigns lives in campaigns.ts, server-side).
import type { DomainInventory } from '@arxic/domain-inventory';
import type { FrontendInventory, FrontendRow } from '@arxic/source-ua-adapter';
import type { Project } from './types';

/**
 * Route omission coverage (refs #402): associates the discovery inventory's
 * route rows with frontend declarations and exposes, per route, which
 * conditional-state markers (loading/error/empty) the route's OWN source
 * references, which interactive actions it declares, whether any test
 * declaration covers its files, and whether any documentation requirement
 * does. Source-tier only: an absent marker is an omission signal to
 * investigate, never proof of absent behavior.
 */
export type RouteCoverageDimensionName =
  'state:loading' | 'state:error' | 'state:empty' | 'actions' | 'tests' | 'docs';
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

/**
 * Configuration omission exposure (refs #402): fuses what the operator
 * configured (declared feature flags, the persona's login route or seed
 * dependency) with what discovery actually found. Runtime VALUES stay
 * unobserved — these are configuration-vs-source misalignments, never runtime
 * behavior claims.
 */
export type ConfigurationOmission = {
  key: string;
  status: 'aligned' | 'referenced' | 'declared-unreferenced' | 'referenced-undeclared' | 'missing';
  evidence: RouteCoverageDimension['evidence'];
};

type Evidence = RouteCoverageDimension['evidence'][number];

/** The runtime-observable state dimensions (subset of the coverage dimensions). */
export type RuntimeStateDimensionName = 'state:loading' | 'state:error' | 'state:empty';

/**
 * Documented label patterns over condition/state declaration text — the ONE
 * vocabulary shared by the source tier (declaration labels) and the runtime
 * observer (rendered markers), so mapped cells always compare like with like.
 */
const statePatterns: ReadonlyArray<[RuntimeStateDimensionName, RegExp]> = [
  [
    'state:loading',
    /(?:^|[^a-z])(?:loading|isloading|pending|skeleton|spinner)(?:[^a-z]|$)|aria-busy/iu,
  ],
  ['state:error', /(?:^|[^a-z])(?:error|failed|failure|invalid)(?:[^a-z]|$)|aria-invalid/iu],
  ['state:empty', /(?:^|[^a-z])(?:empty|no results|nothing)(?:[^a-z]|$)/iu],
];

const runtimeDimensionOrder: readonly RuntimeStateDimensionName[] = [
  'state:loading',
  'state:error',
  'state:empty',
];

/** Classifies marker text (source declaration or rendered page) into dimensions. */
export function classifyStateText(text: string): RuntimeStateDimensionName[] {
  return runtimeDimensionOrder.filter((name) =>
    statePatterns.find(([candidate]) => candidate === name)?.[1].test(text),
  );
}

/** One route's runtime-observed rendered state markers (strings: persisted JSON). */
export type RuntimeStateObservation = {
  path: string;
  states: readonly string[];
};

/** The four-way source↔runtime mapping for one route × state dimension. */
export type RuntimeStateMapping = {
  method: string;
  path: string;
  dimensions: Array<{
    name: RuntimeStateDimensionName;
    mapping:
      | 'declared-and-observed'
      | 'declared-unobserved'
      | 'observed-undeclared'
      | 'unobserved-undeclared';
  }>;
};

/**
 * Fuses the source-declared state dimensions with runtime-observed rendered
 * markers (refs #402). `declared-unobserved` never means "the state does not
 * exist" — plain navigation cannot provoke every conditional; it means the
 * crawl never saw it render. `observed-undeclared` is the dynamic-state class:
 * something rendered that no source declaration accounts for.
 */
export function runtimeStateMap(
  coverage: RouteCoverage[],
  runtime: RuntimeStateObservation[],
): RuntimeStateMapping[] {
  const known = new Set<string>(runtimeDimensionOrder);
  const observed = new Map(
    runtime.map((observation) => [
      observation.path,
      observation.states.filter((state) => known.has(state)),
    ]),
  );
  const paths = new Set<string>([...coverage.map(({ path }) => path), ...observed.keys()]);
  return [...paths]
    .sort((left, right) => left.localeCompare(right))
    .map((path) => {
      const route = coverage.find((entry) => entry.path === path);
      const states = observed.get(path) ?? [];
      return {
        method: route?.method ?? 'GET',
        path,
        dimensions: runtimeDimensionOrder.map((name) => {
          const declared =
            route?.dimensions.find((dimension) => dimension.name === name)?.status === 'referenced';
          const seen = states.includes(name);
          return {
            name,
            mapping:
              declared && seen
                ? 'declared-and-observed'
                : declared
                  ? 'declared-unobserved'
                  : seen
                    ? 'observed-undeclared'
                    : 'unobserved-undeclared',
          };
        }),
      };
    });
}

const dimensionOrder: readonly RouteCoverageDimensionName[] = [
  'state:loading',
  'state:error',
  'state:empty',
  'actions',
  'tests',
  'docs',
];

/** Member-expression labels that name a feature flag (exact name capture). */
const flagNameOf =
  /^(?:flags|featureFlags|process\.env|import\.meta\.env)\.([A-Za-z][A-Za-z0-9_]*)$/u;

const evidenceOfRow = (row: FrontendRow): Evidence => ({
  path: row.source.path,
  startLine: row.source.startLine,
  endLine: row.source.endLine,
  label: row.label,
});

export function configurationOmissions(
  project: Project,
  inventory: DomainInventory,
  frontend: FrontendInventory,
): ConfigurationOmission[] {
  const execution = project.execution;
  if (!execution) return [];
  const entries: ConfigurationOmission[] = [];
  const referenced = new Map<string, Evidence[]>();
  for (const row of frontend.rows) {
    if (row.kind !== 'feature-flag' && row.kind !== 'configuration') continue;
    const name = flagNameOf.exec(row.label)?.[1];
    if (!name) continue;
    referenced.set(name, [...(referenced.get(name) ?? []), evidenceOfRow(row)]);
  }
  const declared = execution.featureFlags ?? {};
  for (const name of Object.keys(declared).sort())
    entries.push({
      key: `flag:${name}`,
      status: referenced.has(name) ? 'aligned' : 'declared-unreferenced',
      evidence: referenced.get(name) ?? [],
    });
  for (const [name, evidence] of [...referenced.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  ))
    if (!(name in declared))
      entries.push({ key: `flag:${name}`, status: 'referenced-undeclared', evidence });

  const routeEvidence = (path: string): Evidence[] =>
    inventory.rows
      .filter((row) => row.path === path)
      .flatMap((row) =>
        row.sourceRefs.map((ref) => ({
          path: ref.path,
          startLine: ref.startLine,
          endLine: ref.endLine,
          label: `${row.method} ${row.path}`,
        })),
      )
      .sort(
        (left, right) => left.path.localeCompare(right.path) || left.startLine - right.startLine,
      );
  const persona = execution.persona;
  if (persona.mode === 'per-pass-login') {
    const evidence = routeEvidence(persona.loginPath);
    entries.push({
      key: 'persona:login-route',
      status: evidence.length ? 'referenced' : 'missing',
      evidence,
    });
  }
  if (persona.mode === 'seed-api') {
    // Seed endpoints are API routes, which the consumer inventory does not
    // carry as page rows; the discovered frontend declarations do.
    const evidence = frontend.rows
      .filter((row) => /(?:^|\/)seed(?:\/route)?\.[a-z]+$/iu.test(row.source.path))
      .map(evidenceOfRow);
    entries.push({
      key: 'persona:seed-endpoint',
      status: evidence.length ? 'referenced' : 'missing',
      evidence,
    });
  }
  return entries.sort((left, right) => left.key.localeCompare(right.key));
}

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
      } else if (name === 'actions') {
        // Interactive action declarations (event/form-action attributes) in
        // the route's associated files; none means nothing to drive.
        evidence = associated
          .filter((candidate) => candidate.kind === 'action')
          .map(({ source, label }) => ({
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
