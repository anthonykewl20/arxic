import type { Diagnostic, EvidenceRef, EvidenceRefRuntime } from '@arxic/contracts';
import type { SurfaceMap } from '@arxic/crawlee-adapter';
import {
  PlaywrightCompiler,
  buildFormFlowWorkflow,
  type FormFlowField,
} from '@arxic/playwright-compiler';
import type { CompilationResult } from './types';
import type { BoundProposal } from './intent-proposer';
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
 * Project the crawl surface's form for a route into the form-flow inventory
 * inputs: labelled, fillable controls plus the submit control's accessible
 * name. Hidden/unlabelled inputs are not fillable persona inputs. The crawl's
 * conservative `destructive` flag (method !== GET means "breadth discovery did
 * not submit it") does NOT deselect a form here — driving it is a policy
 * decision owned by the stage-8 exploration gate, not by projection.
 */
export function formSurfaceForRoute(
  surface: SurfaceMap,
  route: string,
): ProposalFormSurface | undefined {
  const routeSurface = surface.routes.find((candidate) => candidate.path === route);
  if (!routeSurface) return undefined;
  for (const form of routeSurface.forms) {
    const fields: FormFlowField[] = [];
    let submitControlName: string | undefined;
    for (const control of form.controls) {
      const label = control.label?.trim();
      if (!label) continue; // hidden csrf tokens and unlabelled controls
      if (control.tag === 'button' || control.type === 'submit' || control.type === 'button') {
        if (control.type === 'submit') submitControlName ??= label;
        continue;
      }
      if (control.tag === 'input' && FIELD_TYPES.has(control.type)) {
        fields.push({ label, inputRef: inputRefForLabel(label) });
      }
    }
    if (fields.length > 0 && submitControlName !== undefined) {
      return { route, fields, submitControlName };
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
