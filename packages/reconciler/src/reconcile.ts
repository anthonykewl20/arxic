import type { BundleManifest, Diagnostic, WorkflowTransition } from '@arxic/contracts';
import type { RouteSurface, SurfaceMap } from '@arxic/crawlee-adapter';
import { canonicalJson, codepointCompare } from '@arxic/evidence-graph';
import Graph from 'graphology';
import {
  ARXIC_RECON_CONFLICT,
  ARXIC_RECON_DENOMINATOR_TAMPERED,
  ARXIC_RECON_RUNTIME_ONLY,
  ARXIC_RECON_SOURCE_ONLY,
  ARXIC_RECON_UNSUPPORTED,
  reconDiagnostic,
} from './diagnostics';
import type {
  CoverageRow,
  ReconciliationCandidate,
  ReconciliationOutcome,
  ReconciliationResult,
} from './types';

type MergeNode = Readonly<{ kind: string; evidenceRefs: readonly string[] }>;
type MergeEdge = Readonly<{ kind: string }>;

export class DenominatorTamperedError extends Error {
  readonly diagnostic: Diagnostic;

  constructor(computed: number, frozen: number) {
    const diagnostic = reconDiagnostic(
      ARXIC_RECON_DENOMINATOR_TAMPERED,
      'blocked',
      'coverage.denominator',
      `Frozen denominator ${frozen} does not equal recomputed denominator ${computed}.`,
    );
    super(diagnostic.message);
    this.name = 'DenominatorTamperedError';
    this.diagnostic = diagnostic;
  }
}

export function assertDenominatorFrozen(
  computed: number,
  frozenManifest: number | Pick<BundleManifest, 'coverage'>,
): void {
  const frozen =
    typeof frozenManifest === 'number' ? frozenManifest : frozenManifest.coverage.denominator;
  if (
    !Number.isSafeInteger(computed) ||
    computed < 0 ||
    !Number.isSafeInteger(frozen) ||
    frozen < 0
  ) {
    throw new DenominatorTamperedError(computed, frozen);
  }
  if (computed !== frozen) throw new DenominatorTamperedError(computed, frozen);
}

export async function reconcile(input: {
  candidates: readonly ReconciliationCandidate[];
  surface: SurfaceMap;
}): Promise<ReconciliationResult> {
  const candidates = [...input.candidates].sort(
    (left, right) =>
      codepointCompare(left.id, right.id) ||
      codepointCompare(canonicalJson(left), canonicalJson(right)),
  );
  const duplicateIds = duplicateCandidateIds(candidates);
  const routes = [...input.surface.routes].sort((left, right) =>
    codepointCompare(left.url, right.url),
  );
  const graph = buildMergeGraph(candidates, input.surface);
  const candidateRows = candidates.map((candidate) =>
    candidateRow(candidate, routes, input.surface, graph, duplicateIds.has(candidate.id)),
  );
  const assertedRoutes = new Set(
    candidates
      .filter((candidate) => !duplicateIds.has(candidate.id))
      .flatMap(expectedRoutes)
      .flatMap((route) =>
        routes
          .filter((surfaceRoute) => surfaceSupportsRoute(surfaceRoute, route))
          .map((match) => match.url),
      ),
  );
  const runtimeRows = routes.filter((route) => !assertedRoutes.has(route.url)).map(runtimeOnlyRow);
  const orderedCandidates = candidates.map(normalizeCandidateWorkflow).sort((left, right) => {
    const leftScore = candidateRows.find((row) => row.candidateId === left.id)?.accountability ?? 0;
    const rightScore =
      candidateRows.find((row) => row.candidateId === right.id)?.accountability ?? 0;
    return rightScore - leftScore || codepointCompare(left.id, right.id);
  });
  const rows = [...candidateRows, ...runtimeRows].sort((left, right) =>
    codepointCompare(left.candidateId, right.candidateId),
  );
  const diagnostics = rows
    .flatMap((row) => row.diagnostics)
    .sort((left, right) =>
      codepointCompare(`${left.code}\0${left.subject}`, `${right.code}\0${right.subject}`),
    );
  const denominator = candidates.length;
  const withSource = candidateRows.filter((row) => row.staticEvidence > 0).length;
  const sourceSupported = candidateRows.filter(
    (row) => row.staticEvidence > 0 && row.runtimeEvidence > 0,
  ).length;
  return {
    denominator,
    rows,
    orderedCandidates,
    diagnostics,
    summary: {
      candidateAccountability:
        denominator === 0
          ? 0
          : round(
              candidateRows.reduce((total, row) => total + row.accountability, 0) / denominator,
            ),
      verifiedTransitionCoverage: 0,
      sourceEvidenceOverlap: withSource === 0 ? 0 : round(sourceSupported / withSource),
      runtimeEvidenceOverlap: routes.length === 0 ? 0 : round(assertedRoutes.size / routes.length),
      uncovered: candidateRows.filter(
        (row) => row.outcome === 'hypothesized' || row.outcome === 'observed',
      ).length,
      blocked: candidateRows.filter((row) => row.outcome === 'blocked').length,
      contradicted: candidateRows.filter((row) => row.outcome === 'contradicted').length,
    },
  };
}

function candidateRow(
  candidate: ReconciliationCandidate,
  routes: readonly RouteSurface[],
  surface: SurfaceMap,
  graph: Graph<MergeNode, MergeEdge>,
  duplicateId: boolean,
): CoverageRow {
  const expected = expectedRoutes(candidate);
  const matched = routes.filter((route) =>
    graph.hasEdge(`candidate:${candidate.id}->runtime:${route.url}`),
  );
  const staticRefs = staticEvidenceRefs(candidate);
  const runtimeRefs = matched.flatMap((route) => (route.evidence ? [runtimeRefId(route)] : []));
  const conflicts = conflictReasons(candidate, expected, matched, routes);
  const blocker = matchingBlocker(expected, matched, surface.diagnostics);
  let outcome: ReconciliationOutcome;
  let diagnostic: Diagnostic | undefined;
  if (duplicateId) {
    outcome = 'blocked';
    diagnostic = reconDiagnostic(
      ARXIC_RECON_UNSUPPORTED,
      'blocked',
      candidate.id,
      `Duplicate candidate id ${candidate.id} cannot be reconciled safely.`,
      staticRefs,
    );
  } else if (candidate.evidenceRefs.length === 0 && !candidate.workflow) {
    outcome = 'blocked';
    diagnostic = reconDiagnostic(
      ARXIC_RECON_UNSUPPORTED,
      'blocked',
      candidate.id,
      'Candidate has no static evidence or supported workflow structure.',
    );
  } else if (conflicts.length > 0) {
    outcome = 'contradicted';
    diagnostic = reconDiagnostic(
      ARXIC_RECON_CONFLICT,
      'contradicted',
      candidate.id,
      conflicts.join(' '),
      [...staticRefs, ...runtimeRefs],
    );
  } else if (blocker) {
    outcome = 'blocked';
    diagnostic = reconDiagnostic(
      ARXIC_RECON_UNSUPPORTED,
      'blocked',
      candidate.id,
      blocker.message,
      [...staticRefs, ...runtimeRefs],
    );
  } else if (matched.length === 0) {
    outcome = 'hypothesized';
    diagnostic = reconDiagnostic(
      ARXIC_RECON_SOURCE_ONLY,
      'hypothesized',
      candidate.id,
      'Candidate is asserted by source evidence but was not observed at runtime.',
      staticRefs,
    );
  } else {
    outcome = 'observed';
  }
  const requiredTransitions =
    candidate.workflow?.transitions.filter((transition) => transition.required !== false).length ??
    0;
  const overlap = matched.length > 0 && staticRefs.length > 0 ? 1 : 0;
  const accountability = round(
    (requiredTransitions > 0 ? 0.5 : 0) + overlap * 0.4 + (staticRefs.length > 0 ? 0.1 : 0),
  );
  const workflow = candidate.workflow;
  const primaryRoute = expected[0];
  return {
    candidateId: candidate.id,
    staticEvidence: staticRefs.length,
    runtimeEvidence: runtimeRefs.length,
    outcome,
    kind: 'candidate',
    ...(workflow
      ? {
          revision: workflow.scope.commit,
          domain: workflow.domain,
          feature: featureOf(candidate),
          persona: workflow.persona,
          role: roleOf(workflow.persona),
          preconditions: workflow.preconditions.map((item) => item.fixture).sort(codepointCompare),
          pathKind: pathKind(candidate),
          featureFlags: [...(workflow.scope.featureFlags ?? [])].sort(codepointCompare),
          browser: workflow.scope.browser,
        }
      : {}),
    ...(matched[0]?.evidence ? { build: matched[0].evidence.appBuildDigest } : {}),
    ...(primaryRoute ? { route: primaryRoute } : {}),
    staticStatus: 'asserted',
    runtimeReachability: blocker ? 'blocked' : matched.length > 0 ? 'observed' : 'unobserved',
    verificationStatus: outcome,
    ...(outcome === 'blocked' && diagnostic ? { blockerReason: diagnostic.message } : {}),
    accountability,
    diagnostics: diagnostic ? [diagnostic] : [],
  };
}

function runtimeOnlyRow(route: RouteSurface): CoverageRow {
  const runtimeRef = route.evidence ? [runtimeRefId(route)] : [];
  return {
    candidateId: `runtime:${route.path}`,
    staticEvidence: 0,
    runtimeEvidence: runtimeRef.length,
    outcome: 'observed',
    kind: 'runtime-only',
    ...(route.evidence
      ? {
          build: route.evidence.appBuildDigest,
          browser: route.evidence.browser,
        }
      : {}),
    route: route.path,
    pathKind: 'unspecified',
    staticStatus: 'absent',
    runtimeReachability: 'observed',
    verificationStatus: 'observed',
    accountability: 0,
    diagnostics: [
      reconDiagnostic(
        ARXIC_RECON_RUNTIME_ONLY,
        'observed',
        route.path,
        'Runtime route was observed without a source-backed candidate.',
        runtimeRef,
      ),
    ],
  };
}

function conflictReasons(
  candidate: ReconciliationCandidate,
  expected: readonly string[],
  matched: readonly RouteSurface[],
  allRoutes: readonly RouteSurface[],
): string[] {
  const reasons: string[] = [];
  if (
    expected.length > 0 &&
    allRoutes.length > 0 &&
    matched.length === 0 &&
    expected.some((path) => allRoutes.some((route) => routeStructureDisagrees(path, route.path)))
  ) {
    reasons.push(
      `Expected route ${expected.join(', ')} is absent from the observed runtime routes.`,
    );
  }
  if (matched.length === 0) return reasons;
  const requiredControls = candidate.workflow?.transitions.flatMap(inputNames) ?? [];
  const controls = matched.flatMap((route) => [
    ...route.controls,
    ...route.forms.flatMap((form) => form.controls),
  ]);
  for (const name of [...new Set(requiredControls)].sort(codepointCompare)) {
    if (!controls.some((control) => control.name?.toLowerCase() === name.toLowerCase())) {
      reasons.push(`Static transition requires control ${name}, but runtime shows it absent.`);
    }
  }
  const claimsCsrf = canonicalJson(candidate).toLowerCase().includes('csrf');
  if (
    claimsCsrf &&
    !controls.some((control) =>
      `${control.name ?? ''} ${control.label ?? ''}`.toLowerCase().includes('csrf'),
    )
  ) {
    reasons.push(
      'Static evidence asserts CSRF protection, but runtime forms expose no CSRF control.',
    );
  }
  return reasons;
}

function matchingBlocker(
  expected: readonly string[],
  matched: readonly RouteSurface[],
  diagnostics: readonly Diagnostic[],
): Diagnostic | undefined {
  const urls = new Set([
    ...matched.flatMap((route) =>
      expected.some((path) => routeMatches(path, route.path)) ? [route.url] : [],
    ),
    ...matched.flatMap((route) =>
      route.forms.flatMap((form) => {
        try {
          const path = new URL(form.action, route.url).pathname;
          return expected.some((item) => routeMatches(item, path))
            ? [new URL(form.action, route.url).href]
            : [];
        } catch {
          return [];
        }
      }),
    ),
  ]);
  return diagnostics.find((diagnostic) => {
    if (diagnostic.severity !== 'blocked') return false;
    if (urls.has(diagnostic.subject)) return true;
    try {
      const path = new URL(diagnostic.subject).pathname;
      return expected.some((route) => routeMatches(route, path));
    } catch {
      return expected.includes(diagnostic.subject);
    }
  });
}

function buildMergeGraph(candidates: readonly ReconciliationCandidate[], surface: SurfaceMap) {
  const graph = new Graph<MergeNode, MergeEdge>({ type: 'directed', multi: true });
  const duplicateIds = duplicateCandidateIds(candidates);
  for (const candidate of candidates) {
    if (duplicateIds.has(candidate.id)) continue;
    const candidateId = `candidate:${candidate.id}`;
    graph.addNode(candidateId, { kind: 'Candidate', evidenceRefs: staticEvidenceRefs(candidate) });
    for (const [index, transition] of (candidate.workflow?.transitions ?? []).entries()) {
      const transitionId = `${candidateId}:transition:${index}`;
      graph.addNode(transitionId, {
        kind: 'Transition',
        evidenceRefs: [...transition.evidenceRefs].sort(codepointCompare),
      });
      graph.addDirectedEdgeWithKey(`${candidateId}->${transitionId}`, candidateId, transitionId, {
        kind: 'asserts',
      });
    }
  }
  for (const route of [...surface.routes].sort((left, right) =>
    codepointCompare(left.url, right.url),
  )) {
    const routeId = `runtime:${route.url}`;
    graph.addNode(routeId, {
      kind: 'RuntimeSurface',
      evidenceRefs: route.evidence ? [runtimeRefId(route)] : [],
    });
    route.forms.forEach((form, formIndex) => {
      const formId = `${routeId}:form:${formIndex}`;
      graph.addNode(formId, { kind: 'Form', evidenceRefs: [] });
      graph.addDirectedEdgeWithKey(`${routeId}->${formId}`, routeId, formId, { kind: 'exposes' });
      form.controls.forEach((control, controlIndex) => {
        const controlId = `${formId}:control:${controlIndex}`;
        graph.addNode(controlId, { kind: 'Control', evidenceRefs: [] });
        graph.addDirectedEdgeWithKey(`${formId}->${controlId}`, formId, controlId, {
          kind: 'contains',
        });
      });
    });
    route.controls.forEach((_control, controlIndex) => {
      const controlId = `${routeId}:control:${controlIndex}`;
      graph.addNode(controlId, { kind: 'Control', evidenceRefs: [] });
      graph.addDirectedEdgeWithKey(`${routeId}->${controlId}`, routeId, controlId, {
        kind: 'contains',
      });
    });
  }
  for (const candidate of candidates) {
    if (duplicateIds.has(candidate.id)) continue;
    for (const expected of expectedRoutes(candidate)) {
      for (const route of surface.routes.filter((item) => surfaceSupportsRoute(item, expected))) {
        const edgeId = `candidate:${candidate.id}->runtime:${route.url}`;
        if (!graph.hasEdge(edgeId)) {
          graph.addDirectedEdgeWithKey(
            edgeId,
            `candidate:${candidate.id}`,
            `runtime:${route.url}`,
            { kind: 'overlaps' },
          );
        }
      }
    }
  }
  return graph;
}

function duplicateCandidateIds(candidates: readonly ReconciliationCandidate[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) duplicates.add(candidate.id);
    seen.add(candidate.id);
  }
  return duplicates;
}

function normalizeCandidateWorkflow(candidate: ReconciliationCandidate): ReconciliationCandidate {
  if (candidate.workflow?.status !== 'verified') return candidate;
  return {
    ...candidate,
    workflow: { ...candidate.workflow, status: 'hypothesized' },
  };
}

function expectedRoutes(candidate: ReconciliationCandidate): string[] {
  const values = [candidate.id, candidate.title, ...candidate.evidenceRefs];
  if (candidate.workflow) {
    values.push(
      candidate.workflow.id,
      candidate.workflow.title,
      ...candidate.workflow.states.map((state) => state.id),
      ...candidate.workflow.transitions.flatMap((transition) => [
        transition.from,
        transition.to,
        transition.action.intent,
      ]),
    );
  }
  const routes = values.flatMap((value) => {
    const explicit = value.match(
      /(?:route:|\b(?:GET|POST|PUT|PATCH|DELETE)\s+)(\/[A-Za-z0-9_./:-]*)/gu,
    );
    const direct = value.match(/^\/[A-Za-z0-9_./:-]*$/u);
    return [...(explicit ?? []), ...(direct ?? [])].map((match) => {
      const slash = match.indexOf('/');
      return normalizePath(match.slice(slash));
    });
  });
  return [...new Set(routes)].sort(codepointCompare);
}

function routeMatches(expected: string, actual: string): boolean {
  const expectedParts = normalizePath(expected).split('/');
  const actualParts = normalizePath(actual).split('/');
  return (
    expectedParts.length === actualParts.length &&
    expectedParts.every((part, index) => part.startsWith(':') || part === actualParts[index])
  );
}

function surfaceSupportsRoute(route: RouteSurface, expected: string): boolean {
  if (routeMatches(expected, route.path)) return true;
  return route.forms.some((form) => {
    try {
      return routeMatches(expected, new URL(form.action, route.url).pathname);
    } catch {
      return false;
    }
  });
}

function routeStructureDisagrees(expected: string, actual: string): boolean {
  const expectedSlug = normalizePath(expected).split('/').filter(Boolean).at(-1);
  const actualSlug = normalizePath(actual).split('/').filter(Boolean).at(-1);
  if (!expectedSlug || !actualSlug) return false;
  const aliases = [
    new Set(['login', 'sign-in', 'signin']),
    new Set(['logout', 'sign-out', 'signout']),
    new Set(['forgot', 'forgot-password', 'reset', 'reset-password']),
  ];
  return aliases.some((group) => group.has(expectedSlug) && group.has(actualSlug));
}

function normalizePath(path: string): string {
  const withoutQuery = path.split(/[?#]/u)[0] ?? '/';
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/u, '') : '/';
}

function staticEvidenceRefs(candidate: ReconciliationCandidate): string[] {
  return [
    ...new Set(
      [
        ...candidate.evidenceRefs,
        ...(candidate.workflow?.evidenceRefs ?? []),
        ...(candidate.workflow?.transitions.flatMap((transition) => transition.evidenceRefs) ?? []),
      ].filter((ref) => !ref.startsWith('run:')),
    ),
  ].sort(codepointCompare);
}

function runtimeRefId(route: RouteSurface): string {
  return route.evidence ? `run:${route.evidence.runId}:${route.path}` : `run:surface:${route.path}`;
}

function inputNames(transition: WorkflowTransition): string[] {
  return Object.keys(transition.action.inputRefs ?? {});
}

function featureOf(candidate: ReconciliationCandidate): string {
  return candidate.id.split('.').at(1) ?? candidate.id;
}

function roleOf(persona: string): string {
  return persona.toLowerCase().includes('admin') ? 'admin' : persona;
}

function pathKind(candidate: ReconciliationCandidate): 'happy' | 'sad' | 'admin' | 'unspecified' {
  const value = `${candidate.id} ${candidate.title}`.toLowerCase();
  if (value.includes('admin')) return 'admin';
  if (/invalid|error|reject|negative|denied/u.test(value)) return 'sad';
  if (/success|happy|login|logout|reset|change|mfa/u.test(value)) return 'happy';
  return 'unspecified';
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
