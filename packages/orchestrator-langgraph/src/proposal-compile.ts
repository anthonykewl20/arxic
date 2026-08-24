import type { Diagnostic, EvidenceRef, EvidenceRefRuntime } from '@arxic/contracts';
import type { SurfaceMap } from '@arxic/crawlee-adapter';
import {
  PlaywrightCompiler,
  buildFormFlowWorkflow,
  type FormFlowField,
} from '@arxic/playwright-compiler';
import type { CompilationResult } from './types';
import type { BoundProposal } from './intent-proposer';
import type { ExplorationPlan, PlanStep } from './exploration';
import type { ProposalConsumerRow } from '@arxic/domain-inventory';
import {
  ARXIC_ORCH_PROPOSAL_OBSERVATION_MISSING,
  ARXIC_ORCH_PROPOSAL_SURFACE_MISSING,
  ARXIC_ORCH_STAGE_BLOCKED,
  orchDiagnostic,
} from './diagnostics';

/**
 * DG-08 compile wiring (#252): proposals drive the DG-09 compiler path.
 *
 * A bound proposal's cited inventory row supplies the entry ROUTE; the stage-5
 * crawl surface supplies the labelled FIELDS and the SUBMIT control; the
 * stage-8 policy-gated exploration supplies the post-action OBSERVATION. The
 * workflow is built by the UNCHANGED DG-09 generic form-flow builder, so every
 * assertion is observation-bound — a canned literal assertion (the #257 defect
 * class) is impossible by construction. No domain literals anywhere: the
 * identity (domain/persona/intent) comes from the PROPOSAL, the geometry from
 * INVENTORY data, the assertions from OBSERVATION.
 */

export type ProposalFormSurface = Readonly<{
  /** The ENTRY route: the crawl-surface page the form lives ON. */
  route: string;
  fields: readonly FormFlowField[];
  submitControlName: string;
}>;

const FIELD_TYPES = new Set(['text', 'email', 'password', 'tel', 'number', 'search', 'url', '']);

function inputRefForLabel(label: string): string {
  const slug = label
    .replace(/[^A-Za-z0-9]+/gu, '.')
    .replace(/^\.+|\.+$/gu, '')
    .toLowerCase();
  return `persona.${slug || 'input'}`;
}

/**
 * Project the crawl surface's form for a proposal-cited route into the
 * form-flow inventory inputs: labelled, fillable controls plus the submit
 * control's accessible name, and the ENTRY route (the page the form lives
 * on). Hidden/unlabelled inputs are not fillable persona inputs. The crawl's
 * conservative `destructive` flag (method !== GET means "breadth discovery did
 * not submit it") does NOT deselect a form here — driving it is a policy
 * decision owned by the stage-8 exploration gate, not by projection.
 *
 * Two generic lookup strategies, both domain-free:
 * 1. EXACT route path — the form lives on the cited route itself (e.g.
 *    file-convention pages whose server action posts back to the same path);
 * 2. FORM ACTION match — the cited route is the POST target and the form
 *    lives on a different page (e.g. a page hosting forms that submit to
 *    separately inventoried POST routes). The entry route is then the page
 *    HOLDING the form; exploration navigates there.
 */
export function formSurfaceForRoute(
  surface: SurfaceMap,
  route: string,
): ProposalFormSurface | undefined {
  const byAction = () => {
    for (const routeSurface of surface.routes) {
      for (const form of routeSurface.forms) {
        let actionPath: string | undefined;
        try {
          actionPath = new URL(form.action).pathname;
        } catch {
          actionPath = form.action;
        }
        if (actionPath !== route) continue;
        const fields = fillableFields(form.controls);
        const submitControlName = submitControl(form.controls);
        if (fields.length > 0 && submitControlName !== undefined) {
          return { route: routeSurface.path, fields, submitControlName };
        }
      }
    }
    return undefined;
  };
  const exact = surface.routes.find((candidate) => candidate.path === route);
  if (exact) {
    for (const form of exact.forms) {
      const fields = fillableFields(form.controls);
      const submitControlName = submitControl(form.controls);
      if (fields.length > 0 && submitControlName !== undefined) {
        return { route, fields, submitControlName };
      }
    }
  }
  return byAction();
}

function fillableFields(
  controls: ReadonlyArray<{ tag: string; type: string; label?: string }>,
): FormFlowField[] {
  const fields: FormFlowField[] = [];
  for (const control of controls) {
    const label = control.label?.trim();
    if (!label) continue; // hidden csrf tokens and unlabelled controls
    if (control.tag === 'button' || control.type === 'submit' || control.type === 'button') {
      continue;
    }
    if (control.tag === 'input' && FIELD_TYPES.has(control.type)) {
      fields.push({ label, inputRef: inputRefForLabel(label) });
    }
  }
  return fields;
}

function submitControl(
  controls: ReadonlyArray<{ tag: string; type: string; label?: string }>,
): string | undefined {
  for (const control of controls) {
    const label = control.label?.trim();
    if (!label) continue;
    if (control.type === 'submit' || (control.tag === 'button' && control.type !== 'button')) {
      return label;
    }
  }
  return undefined;
}

/**
 * The post-action observation captured by the stage-8 exploration (DG-09):
 * the stabilized URL, bounded heading anchors, the opaque runtime evidence
 * id bound into the workflow, and the underlying runtime EvidenceRef (the
 * compiler's evidence gate requires real source + runtime observations —
 * assertions are never compiled from unanchored strings).
 */
export type ProposalObservation = Readonly<{
  url: string;
  headings: readonly string[];
  runtimeEvidenceRef: string;
  runtime?: EvidenceRefRuntime;
}>;

export type ProposalCompileInput = Readonly<{
  proposal: BoundProposal;
  /** The inventory row the proposal cites (entry route + source evidence). */
  row: {
    readonly id: string;
    readonly path: string;
    readonly sourcePath: string;
    readonly evidenceIds: readonly string[];
  };
  evidenceIndex: Readonly<Record<string, EvidenceRef>>;
  surface: SurfaceMap;
  observation: ProposalObservation | undefined;
  scope: Readonly<{ commit: string; environment: string; browser: string }>;
  origin: string;
  outputDirectory: string;
}>;

/**
 * Compile a proposal candidate through the DG-09 path. Honest failure modes:
 * no form surface on the crawl map -> blocked SURFACE-MISSING; no post-action
 * observation -> blocked OBSERVATION-MISSING. Never fabricates an assertion.
 */
/**
 * DG-297 E3 (#297): surface-aware candidate selection. The compile lane used
 * to take `candidates[0]` blindly; when that candidate's cited row has no
 * crawl form surface (the auth-gated-SPA shape — every route the crawler saw
 * beyond the login view), `compileProposalCandidate` blocked the WHOLE run
 * with SURFACE-MISSING while later candidates' surfaces would have resolved.
 * Selection order: the first candidate whose proposal AND cited row resolve
 * AND whose row's route has a form surface in the crawl map. When NO
 * candidate resolves, the FIRST resolvable (proposal, row) pair is returned
 * so compileProposalCandidate reports SURFACE-MISSING for candidates[0]'s
 * route honestly — never a silent skip, never an invented pair.
 */
export function selectCompilableCandidate(
  candidates: ReadonlyArray<
    Readonly<{ id: string; title?: string; evidenceRefs?: readonly string[] }>
  >,
  proposals: readonly BoundProposal[],
  rows: readonly ProposalConsumerRow[],
  surface: SurfaceMap,
): { candidate: { id: string }; proposal: BoundProposal; row: ProposalConsumerRow } | undefined {
  const resolve = (candidate: { id: string }) => {
    const proposal = proposals.find((item) => item.id === candidate.id);
    if (!proposal) return undefined;
    const row = proposal.inventoryRowIds
      .map((id) => rows.find((candidateRow) => candidateRow.id === id))
      .find((candidateRow): candidateRow is ProposalConsumerRow => candidateRow !== undefined);
    if (!row) return undefined;
    return { candidate, proposal, row };
  };
  const resolvable = candidates
    .map((candidate) => resolve(candidate))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  if (resolvable.length === 0) return undefined;
  return (
    resolvable.find((entry) => formSurfaceForRoute(surface, entry.row.path) !== undefined) ??
    resolvable[0]!
  );
}

/**
 * #299 (F-E2): the form-drive exploration plan for the proposal lane —
 * extracted from the orchestrator's `#withProposalPlan` so the candidate
 * SELECTION is testable beside `selectCompilableCandidate` (the same
 * surface-aware semantics; the plan drives exactly the candidate the
 * compile lane will compile).
 *
 * Honest failure modes (unchanged from the in-orchestrator shape): no
 * proposal run rows, no resolvable candidate, or no crawl form surface for
 * the selected candidate -> `undefined` (no plan; exploration stays empty
 * and compile blocks OBSERVATION-MISSING rather than guessing a form).
 */
export function composeProposalFormDrivePlan(input: {
  candidates: ReadonlyArray<Readonly<{ id: string }>>;
  proposals: readonly BoundProposal[];
  rows: readonly ProposalConsumerRow[];
  surface: SurfaceMap;
  origin: string;
  /** Transient in-memory fill values (caller-supplied; default: none — the plan degrades to navigate-only). */
  values?: Readonly<Record<string, string>>;
  fallbackFixtureKind?: string;
}): ExplorationPlan | undefined {
  // #299 (F-E2): surface-aware selection — the SAME semantics as the
  // compile lane (selectCompilableCandidate), so the plan drives exactly
  // the candidate stage 9 will compile. Blindly taking candidates[0] was
  // the F-E2 defect: a formless candidate 0 composed NO plan ('nothing to
  // observe') while a form-surfaced candidate existed further down the
  // list (directus-dg12-run2: 2 of 81 candidates cited the surfaced
  // /admin routes). When the selection falls back to a formless candidate
  // (none resolves a form), the honest no-plan shape stands.
  const selection = selectCompilableCandidate(
    input.candidates,
    input.proposals,
    input.rows,
    input.surface,
  );
  if (!selection) return undefined;
  const { proposal, row } = selection;
  const form = formSurfaceForRoute(input.surface, row.path);
  if (!form) return undefined;
  const values = input.values ?? {};
  const steps: PlanStep[] = [
    {
      // Navigate to the form's ENTRY route (the crawl page the form lives
      // ON — e.g. a page hosting forms that POST to separately inventoried
      // routes), not the cited route itself.
      intent: `observe route ${form.route}`,
      action: 'navigation',
      actionClass: 'read-only',
      url: new URL(form.route, input.origin).href,
      required: true,
      kind: 'navigate',
    },
  ];
  const fills = form.fields.filter((field) => values[field.inputRef] !== undefined);
  if (fills.length === form.fields.length && fills.length > 0) {
    // DG-08: scope every control to the unique inventoried FORM (pages may
    // host several forms with identically labelled fields).
    const formScope = {
      fieldLabel: form.fields[0]!.label,
      submitName: form.submitControlName,
    };
    for (const field of fills) {
      steps.push({
        intent: `fill ${field.label}`,
        action: 'fill',
        actionClass: 'read-only',
        required: true,
        kind: 'fill',
        locator: {
          semantic: { kind: 'label', text: field.label },
          execution: { kind: 'label', text: field.label },
        },
        formScope,
        // Transient in-memory value (never journaled; redaction policy holds).
        value: values[field.inputRef]!,
      });
    }
    steps.push({
      intent: `submit ${proposal.intent} via ${form.submitControlName}`,
      action: 'form-submit',
      actionClass: 'reversible-mutation',
      required: true,
      kind: 'click',
      locator: {
        semantic: { kind: 'role', role: 'button', name: form.submitControlName },
        execution: { kind: 'role', role: 'button', name: form.submitControlName },
      },
      formScope,
      ...(proposal.fixtureKinds && proposal.fixtureKinds.length === 1
        ? { fixtureKind: proposal.fixtureKinds[0] }
        : input.fallbackFixtureKind
          ? { fixtureKind: input.fallbackFixtureKind }
          : {}),
    });
  }
  return { steps };
}

export async function compileProposalCandidate(
  input: ProposalCompileInput,
): Promise<CompilationResult> {
  const form = formSurfaceForRoute(input.surface, input.row.path);
  if (!form) {
    return {
      compiled: false,
      plan: 'No inventoried form surface for the proposed route; no spec generated',
      diagnostics: [
        orchDiagnostic(
          ARXIC_ORCH_PROPOSAL_SURFACE_MISSING,
          'blocked',
          `route:${input.row.path}`,
          'The crawl surface has no labelled form with a submit control for the proposed route',
        ),
      ],
    };
  }
  if (!input.observation) {
    return {
      compiled: false,
      plan: 'No post-action observation was captured; no spec generated',
      diagnostics: [
        orchDiagnostic(
          ARXIC_ORCH_PROPOSAL_OBSERVATION_MISSING,
          'blocked',
          `proposal:${input.proposal.id}`,
          'The exploration did not capture a stabilized post-action observation for the proposal; refusing to fabricate assertions',
        ),
      ],
    };
  }
  const sourceRefId = input.row.evidenceIds.find((id) => input.evidenceIndex[id]);
  const sourceRef = sourceRefId ? input.evidenceIndex[sourceRefId] : undefined;
  const sourceEvidence =
    sourceRef && sourceRef.kind === 'source'
      ? {
          ref: sourceRefId!,
          path: sourceRef.path,
          range: [sourceRef.startLine, sourceRef.endLine] as readonly [number, number],
        }
      : {
          ref: input.proposal.evidenceRefIds[0] ?? `src:${input.row.sourcePath}`,
          path: input.row.sourcePath,
          range: [1, 1] as readonly [number, number],
        };
  const built = buildFormFlowWorkflow({
    identity: {
      id: input.proposal.id,
      title: input.proposal.intent,
      domain: input.proposal.domain,
      persona: input.proposal.persona,
    },
    route: form.route,
    fields: [...form.fields],
    submitControlName: form.submitControlName,
    observation: {
      url: input.observation.url,
      headings: [...input.observation.headings],
      runtimeEvidenceRef: input.observation.runtimeEvidenceRef,
    },
    scope: input.scope,
    sourceEvidence,
    ...(input.proposal.fixtureKinds && input.proposal.fixtureKinds.length > 0
      ? { personaFacts: input.proposal.fixtureKinds.map((fixture) => ({ fixture })) }
      : {}),
  });
  if (!built.ok) {
    return {
      compiled: false,
      plan: 'The form-flow builder rejected the proposal inputs; no spec generated',
      diagnostics: [...built.diagnostics],
    };
  }
  try {
    const observations: EvidenceRef[] = [
      ...(sourceRef ? [sourceRef] : []),
      ...(input.observation.runtime ? [input.observation.runtime] : []),
    ];
    const bundle = await new PlaywrightCompiler({
      outputDirectory: input.outputDirectory,
      origin: input.origin,
    }).compile(built.workflow, observations);
    return { compiled: true, plan: bundle.plan, workflow: built.workflow, stagedBundle: bundle };
  } catch (error) {
    const diagnostic: Diagnostic =
      error instanceof Error && 'diagnostic' in error && isDiagnostic(error.diagnostic)
        ? (error as { diagnostic: Diagnostic }).diagnostic
        : orchDiagnostic(
            ARXIC_ORCH_STAGE_BLOCKED,
            'blocked',
            input.proposal.id,
            'The workflow compiler failed before producing a safe diagnostic',
          );
    return {
      compiled: false,
      plan: `Compilation blocked (${diagnostic.code})`,
      diagnostics: [diagnostic],
      workflow: built.workflow,
    };
  }
}

function isDiagnostic(value: unknown): value is Diagnostic {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Diagnostic).code === 'string' &&
    typeof (value as Diagnostic).severity === 'string'
  );
}

/**
 * Extract the post-action observation from a stage-8 exploration result: the
 * stabilized URL plus bounded heading anchors from the FINAL successful
 * observation's accessibility snapshot, with its runtime evidence id.
 */
export function postActionObservationFrom(exploration: {
  evidenceRefs: readonly EvidenceRef[];
  postAction?: Readonly<{ url: string; headings: readonly string[] }>;
}): ProposalObservation | undefined {
  if (!exploration.postAction) return undefined;
  const runtime = exploration.postAction;
  const evidence =
    exploration.evidenceRefs.find((ref) => ref.kind === 'runtime' && ref.url === runtime.url) ??
    exploration.evidenceRefs.find((ref) => ref.kind === 'runtime');
  const runtimeRef = evidence && evidence.kind === 'runtime' ? evidence : undefined;
  const runtimeEvidenceRef = runtimeRef
    ? `run:observation-${(runtimeRef.accessibilitySnapshotSha256 ?? '').slice(0, 12) || runtimeRef.url.replace(/[^A-Za-z0-9._#-]/gu, '-')}`
    : 'run:observation-unreferenced';
  return {
    url: runtime.url,
    headings: [...runtime.headings],
    runtimeEvidenceRef,
    ...(runtimeRef ? { runtime: runtimeRef } : {}),
  };
}
