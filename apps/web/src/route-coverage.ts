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

// ---------------------------------------------------------------------------
// Declared business rules per route (refs #402) + intent-ledger fusion
// ---------------------------------------------------------------------------

/** Declared business-rule classes with documented deterministic recognition. */
export type DeclaredRuleKind = 'rule:validation' | 'rule:authorization';
export type RouteDeclaredRules = {
  method: string;
  path: string;
  rules: Array<{ kind: DeclaredRuleKind; evidence: Evidence[] }>;
  /** True when no rule class matched — an omission signal, never proof. */
  omission: boolean;
};

const validationRulePattern = /\b(?:required|pattern|minlength|maxlength)\b/iu;
const authorizationRulePattern =
  /session|logged[ -]?in|logged[ -]?out|authenticated|unauthorized|permission|\brole\b|csrf|rate[ -]?limit|lockout|locked/iu;

/**
 * Deterministic declared-rule inventory per route: validation rules from
 * control declarations (required/pattern/length-bound attribute names the
 * adapter records — type=email/number VALUES are not captured today,
 * disclosed) and authorization rules from condition/state/action declarations
 * whose text names sessions, sign-in/out, csrf, rate limiting, lockout, roles
 * or permissions. Same route-file association as routeStateCoverage
 * (sourceRefs files plus same-directory siblings, never nested surfaces).
 */
export function declaredRouteRules(
  inventory: DomainInventory,
  frontend: FrontendInventory,
): RouteDeclaredRules[] {
  const rowsByPath = new Map<string, FrontendRow[]>();
  for (const row of frontend.rows) {
    const list = rowsByPath.get(row.source.path) ?? [];
    list.push(row);
    rowsByPath.set(row.source.path, list);
  }
  const result: RouteDeclaredRules[] = [];
  for (const row of inventory.rows) {
    const refs = row.sourceRefs.filter((ref) => ref.path);
    if (!refs.length || row.method === '*') continue;
    const refPaths = [...new Set(refs.map(({ path }) => path))];
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
    const classes: Array<{ kind: DeclaredRuleKind; evidence: Evidence[] }> = [];
    const validation = associated
      .filter(
        (candidate) => candidate.kind === 'control' && validationRulePattern.test(candidate.label),
      )
      .map(evidenceOfRow)
      .sort(
        (left, right) => left.path.localeCompare(right.path) || left.startLine - right.startLine,
      );
    if (validation.length) classes.push({ kind: 'rule:validation', evidence: validation });
    const authorization = associated
      .filter(
        (candidate) =>
          (candidate.kind === 'condition' ||
            candidate.kind === 'state' ||
            candidate.kind === 'action') &&
          authorizationRulePattern.test(candidate.label),
      )
      .map(evidenceOfRow)
      .sort(
        (left, right) => left.path.localeCompare(right.path) || left.startLine - right.startLine,
      );
    if (authorization.length) classes.push({ kind: 'rule:authorization', evidence: authorization });
    result.push({
      method: row.method,
      path: row.path,
      rules: classes.sort((left, right) => left.kind.localeCompare(right.kind)),
      omission: classes.length === 0,
    });
  }
  return result.sort(
    (left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method),
  );
}

/** A ledger row projected to the fields the fusion needs (structural, no package import). */
export type LedgerFusionRow = {
  surface: { method: string; path: string };
  truthState: string;
  replayStatus: string;
  intents: readonly { truthState: string; replayStatus: string }[];
};
export type SurfaceIntentSummary = {
  rows: number;
  intents: number;
  bestTruthState: string;
  replayStatus: string;
};

/** Documented rankings: verified > observed > hypothesized > contradicted > blocked;
 * replay passed > attempted (failed/blocked) > not-attempted. */
const truthRanking = ['blocked', 'contradicted', 'hypothesized', 'observed', 'verified'];
const replayRanking = [
  'not-attempted',
  'attempted:blocked',
  'attempted:failed',
  'attempted:passed',
];
const bestOf = (ranking: readonly string[], left: string, right: string): string =>
  ranking.indexOf(right) > ranking.indexOf(left) ? right : left;

/**
 * Intent-ledger fusion (refs #402): unions every run's ledger rows per ledger
 * surface key `METHOD path` so routes without any grounded AI proposal are
 * exposed next to their source/runtime omissions. Pure over the row shape the
 * persisted ledgers already carry.
 */
export function unionIntentCoverage(
  rows: readonly LedgerFusionRow[],
): Map<string, SurfaceIntentSummary> {
  const union = new Map<string, SurfaceIntentSummary>();
  for (const row of rows) {
    const key = `${row.surface.method} ${row.surface.path}`;
    const current = union.get(key) ?? {
      rows: 0,
      intents: 0,
      bestTruthState: 'blocked',
      replayStatus: 'not-attempted',
    };
    let bestTruthState = current.bestTruthState;
    let replayStatus = current.replayStatus;
    for (const truthState of [row.truthState, ...row.intents.map(({ truthState: value }) => value)])
      bestTruthState = bestOf(truthRanking, bestTruthState, truthState);
    for (const status of [row.replayStatus, ...row.intents.map(({ replayStatus: value }) => value)])
      replayStatus = bestOf(replayRanking, replayStatus, status);
    union.set(key, {
      rows: current.rows + 1,
      intents: current.intents + row.intents.length,
      bestTruthState,
      replayStatus,
    });
  }
  return union;
}

/** One route × state dimension in the state-checkpoint coverage matrix. */
export type StateCheckpointCell = {
  name: RuntimeStateDimensionName;
  /** The route's source declares the state (#509). */
  declared: boolean;
  /** A declared state checkpoint covers it for this route. */
  checkpoint: boolean;
};
export type StateCheckpointCoverage = {
  method: string;
  path: string;
  dimensions: StateCheckpointCell[];
};

/**
 * State-checkpoint coverage (refs #402): per route × state dimension, whether
 * the source declares the state and whether an operator-declared state
 * checkpoint covers it. Declared-without-checkpoint cells are the capturable
 * omissions — exactly the states #518 may never observe by plain navigation.
 */
export function stateCheckpointCoverage(
  inventory: DomainInventory,
  frontend: FrontendInventory,
  stateCaptures: ReadonlyArray<{ path: string; state: string }>,
): StateCheckpointCoverage[] {
  const dimensionOf: Record<string, RuntimeStateDimensionName> = {
    loading: 'state:loading',
    error: 'state:error',
    empty: 'state:empty',
  };
  const covered = new Set(
    stateCaptures.flatMap((capture) => {
      const dimension = dimensionOf[capture.state];
      return dimension ? [`${capture.path}#${dimension}`] : [];
    }),
  );
  return routeStateCoverage(inventory, frontend)
    .filter((route) => route.dimensions.some(({ name }) => name.startsWith('state:')))
    .map((route) => ({
      method: route.method,
      path: route.path,
      dimensions: (['state:loading', 'state:error', 'state:empty'] as const).map((name) => ({
        name,
        declared:
          route.dimensions.find((dimension) => dimension.name === name)?.status === 'referenced',
        checkpoint: covered.has(`${route.path}#${name}`),
      })),
    }))
    .filter((route) => route.dimensions.some((cell) => cell.declared || cell.checkpoint));
}
