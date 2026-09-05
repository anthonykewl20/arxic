import type { EvidenceRef } from '@arxic/contracts';
import type { SurfaceMap } from '@arxic/crawlee-adapter';
import { validateWorkflow } from '@arxic/contracts';
import { readFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFormFlowWorkflow } from '@arxic/playwright-compiler';
import {
  compileProposalCandidate,
  composeProposalFormDrivePlan,
  formSurfaceForRoute,
  selectCompilableCandidate,
  type ProposalObservation,
} from '../proposal-compile';
import type { BoundProposal } from '../intent-proposer';

/**
 * DG-08 wiring: proposals -> DG-09 compiler path. A proposal candidate whose
 * domain is NOT authentication compiles through the generic form-flow builder
 * with observation-bound assertions — no canned literal assertions anywhere.
 */

const origin = 'http://127.0.0.1:39191';
const widgetOrigin = 'http://127.0.0.1:39192';

function surfaceMap(): SurfaceMap {
  return {
    schemaVersion: 1 as const,
    truthState: 'observed' as const,
    origin,
    routes: [
      {
        truthState: 'observed' as const,
        url: `${origin}/newsletter`,
        path: '/newsletter',
        depth: 0,
        title: 'Newsletter',
        forms: [
          {
            action: '/newsletter',
            method: 'post',
            destructive: false,
            controls: [
              { tag: 'input', type: 'email', label: 'Email', required: true },
              { tag: 'button', type: 'submit', label: 'Subscribe', required: false },
            ],
          },
        ],
        controls: [],
        links: [],
      },
    ],
    navigationEdges: [],
    diagnostics: [],
  };
}

function proposal(): BoundProposal {
  return {
    id: 'prop:0123456789abcdef',
    domain: 'marketing',
    intent: 'subscribe to the newsletter',
    action: 'perform POST /newsletter at /newsletter',
    fromState: 'before',
    toState: 'after',
    persona: 'visitor',
    inventoryRowIds: ['inv:page:GET:111111111111'],
    evidenceRefIds: ['src:app-newsletter-page-tsx:1-12'],
    rationale: 'grounded in app/newsletter/page.tsx',
    fixtureKinds: ['persona'],
    truthState: 'hypothesized',
  };
}

function row() {
  return {
    id: 'inv:page:GET:111111111111',
    surface: 'page' as const,
    method: 'GET',
    path: '/newsletter',
    sourcePath: 'app/newsletter/page.tsx',
    domainHint: 'newsletter',
    evidenceIds: ['src:app-newsletter-page-tsx:1-12'],
  };
}

const evidenceIndex: Record<string, EvidenceRef> = {
  'src:app-newsletter-page-tsx:1-12': {
    kind: 'source',
    repo: 'file:///fixture',
    commit: 'a'.repeat(40),
    path: 'app/newsletter/page.tsx',
    startLine: 1,
    endLine: 12,
    blobSha256: '1'.repeat(64),
    extractor: 'source-ua-adapter/nextjs-file-conventions@0.0.0',
  },
};

const observation: ProposalObservation = {
  url: `${origin}/newsletter/thanks`,
  headings: ['Subscribed'],
  runtimeEvidenceRef: 'run:observation-abc123def456',
  runtime: {
    kind: 'runtime',
    runId: 'dg08-compile-test',
    appBuildDigest: 'b'.repeat(64),
    browser: 'chromium',
    browserVersion: '1.62.1',
    url: `${origin}/newsletter/thanks`,
    timestamp: '2026-08-17T00:00:00.000Z',
    accessibilitySnapshotSha256: 'abc123def456' + '0'.repeat(52),
  },
};

it('preserves an operator requirement for three clean replays in the compiled bundle (refs #398)', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-three-replays-'));
  try {
    const input = {
      proposal: proposal(),
      row: row(),
      evidenceIndex,
      surface: surfaceMap(),
      observation,
      scope: { commit: 'a'.repeat(40), environment: 'local-test', browser: 'chromium' },
      origin,
      outputDirectory,
      requiredVerificationRuns: 3,
    };
    const result = await compileProposalCandidate(input);
    expect(result.compiled).toBe(true);
    expect(result.workflow?.verification.requiredRuns).toBe(3);
    expect(result.stagedBundle?.manifest.verification.requiredRuns).toBe(3);
    expect(await readFile(join(outputDirectory, 'tests/workflow.spec.ts'), 'utf8')).toContain(
      `page.goto("${origin}/newsletter")`,
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

describe('DG-297 E3 (#297): surface-aware candidate selection', () => {
  const surface = surfaceMap();

  it('prefers the first candidate whose cited row has a resolvable crawl form surface', () => {
    // candidate 1 cites an API route with NO crawl form (the F-E shape:
    // directus blocked on /addons/:param); candidate 2 cites the newsletter
    // page whose form IS in the map. Today the lane compiles candidates[0]
    // and blocks the whole run — selection must skip to the resolvable one.
    const apiRow = {
      ...row(),
      id: 'inv:route:GET:aa0000000000',
      surface: 'route' as const,
      path: '/addons/:param',
      method: 'GET',
    };
    const first = {
      ...proposal(),
      id: 'prop:0000000000000001',
      inventoryRowIds: [apiRow.id],
    };
    const second = {
      ...proposal(),
      id: 'prop:0000000000000002',
      inventoryRowIds: [row().id],
    };
    const selection = selectCompilableCandidate(
      [
        { id: first.id, evidenceRefs: [] },
        { id: second.id, evidenceRefs: [] },
      ],
      [first, second],
      [apiRow, row()],
      surface,
    );
    expect(selection?.proposal.id).toBe('prop:0000000000000002');
    expect(selection?.row.path).toBe('/newsletter');
  });

  it('falls back to the first candidate (honest SURFACE-MISSING) when NO candidate resolves', () => {
    const empty = { ...surfaceMap(), routes: [{ ...surfaceMap().routes[0]!, forms: [] }] };
    const first = { ...proposal(), id: 'prop:0000000000000001' };
    const second = { ...proposal(), id: 'prop:0000000000000002' };
    const selection = selectCompilableCandidate(
      [
        { id: first.id, evidenceRefs: [] },
        { id: second.id, evidenceRefs: [] },
      ],
      [first, second],
      [row()],
      empty,
    );
    // The honest outcome: candidates[0] flows to compileProposalCandidate,
    // which reports SURFACE-MISSING for its route — never a silent skip.
    expect(selection?.proposal.id).toBe('prop:0000000000000001');
  });

  it('returns undefined when there are no candidates at all', () => {
    expect(selectCompilableCandidate([], [], [], surface)).toBeUndefined();
  });

  it('skips candidates whose proposal or row is unresolvable, without inventing either', () => {
    const orphanCandidate = { id: 'prop:0000000000000003', evidenceRefs: [] }; // no proposal
    const selection = selectCompilableCandidate(
      [orphanCandidate, { id: proposal().id, evidenceRefs: [] }],
      [proposal()],
      [row()],
      surface,
    );
    expect(selection?.proposal.id).toBe(proposal().id);
  });
});

describe('#299 (F-E2): form-drive plan composes for the surface-resolvable candidate', () => {
  const surface = surfaceMap();

  it('skips a formless candidate[0] and drives the first form-surfaced candidate (the F-E2 shape)', () => {
    // directus-dg12-run2 measured: candidates[0] cited /:param (no crawl
    // form) -> no plan -> 'nothing to observe' -> OBSERVATION-MISSING, while
    // 2 of 81 candidates cited the surfaced /admin routes. The plan lane
    // must select exactly like the compile lane.
    const apiRow = {
      ...row(),
      id: 'inv:route:GET:bb0000000000',
      surface: 'route' as const,
      path: '/addons/:param',
      method: 'GET',
    };
    const formless = {
      ...proposal(),
      id: 'prop:0000000000000001',
      intent: 'browse the addon catalog',
      inventoryRowIds: [apiRow.id],
    };
    const surfaced = {
      ...proposal(),
      id: 'prop:0000000000000002',
      inventoryRowIds: [row().id],
    };
    const plan = composeProposalFormDrivePlan({
      candidates: [{ id: formless.id }, { id: surfaced.id }],
      proposals: [formless, surfaced],
      rows: [apiRow, row()],
      surface,
      origin,
      values: { 'persona.email': 'persona@example.test' },
    });
    expect(plan?.steps[0]?.intent).toBe('observe route /newsletter');
    const fills = plan?.steps.filter((step) => step.kind === 'fill');
    expect(fills?.map((step) => step.intent)).toEqual(['fill Email']);
    expect(fills?.[0]?.formScope).toEqual({
      fieldLabel: 'Email',
      submitName: 'Subscribe',
      control: { tag: 'input', type: 'email' },
      submitControl: { tag: 'button', type: 'submit' },
    });
    expect(plan?.steps.at(-1)?.kind).toBe('click');
    expect(plan?.steps.at(-1)?.formScope).toEqual({
      fieldLabel: 'Email',
      submitName: 'Subscribe',
      control: { tag: 'button', type: 'submit' },
      submitControl: { tag: 'button', type: 'submit' },
    });
  });

  it('composes no plan (undefined) when NO candidate resolves a form surface — never guesses', () => {
    const empty = { ...surfaceMap(), routes: [{ ...surfaceMap().routes[0]!, forms: [] }] };
    const only = { ...proposal(), inventoryRowIds: [row().id] };
    expect(
      composeProposalFormDrivePlan({
        candidates: [{ id: only.id }],
        proposals: [only],
        rows: [row()],
        surface: empty,
        origin,
        values: { 'persona.email': 'persona@example.test' },
      }),
    ).toBeUndefined();
  });

  it('keeps the no-plan honest shape when the first candidate is unresolvable to a proposal/row', () => {
    const orphan = { id: 'prop:does-not-match-any-proposal' };
    expect(
      composeProposalFormDrivePlan({
        candidates: [orphan],
        proposals: [proposal()],
        rows: [row()],
        surface,
        origin,
        values: {},
      }),
    ).toBeUndefined();
  });
});

describe('form-surface projection from the crawl map', () => {
  it('maps labelled email-address and password fields to the supplied persona values', () => {
    const koelSurface: SurfaceMap = {
      ...surfaceMap(),
      routes: [
        {
          ...surfaceMap().routes[0]!,
          path: '/',
          forms: [
            {
              action: `${origin}/#/home`,
              method: 'get',
              destructive: false,
              controls: [
                { tag: 'input', type: 'email', label: 'Your email address', required: true },
                { tag: 'input', type: 'password', label: 'Your password', required: true },
                { tag: 'button', type: 'submit', label: 'Log In', required: false },
              ],
            },
          ],
        },
      ],
    };
    const koelRow = { ...row(), path: '/' };
    const koelProposal = { ...proposal(), inventoryRowIds: [koelRow.id] };

    const form = formSurfaceForRoute(koelSurface, '/');
    expect(form?.fields).toEqual([
      {
        label: 'Your email address',
        inputRef: 'persona.email',
        control: { tag: 'input', type: 'email' },
      },
      {
        label: 'Your password',
        inputRef: 'persona.password',
        control: { tag: 'input', type: 'password' },
      },
    ]);
    const plan = composeProposalFormDrivePlan({
      candidates: [{ id: koelProposal.id }],
      proposals: [koelProposal],
      rows: [koelRow],
      surface: koelSurface,
      origin,
      values: { 'persona.email': 'persona@example.test', 'persona.password': 'not-a-real-secret' },
    });
    expect(plan?.steps.map((step) => step.kind)).toEqual(['navigate', 'fill', 'fill', 'click']);
  });

  it('derives labelled fields with persona input refs and the submit control name', () => {
    const form = formSurfaceForRoute(surfaceMap(), '/newsletter');
    expect(form).toBeDefined();
    expect(form?.fields).toEqual([
      {
        label: 'Email',
        inputRef: 'persona.email',
        control: { tag: 'input', type: 'email' },
      },
    ]);
    expect(form?.submitControlName).toBe('Subscribe');
    expect(form?.route).toBe('/newsletter');
  });

  it('returns undefined (honest) for a route with no non-destructive form', () => {
    const empty = { ...surfaceMap(), routes: [{ ...surfaceMap().routes[0]!, forms: [] }] };
    expect(formSurfaceForRoute(empty, '/newsletter')).toBeUndefined();
  });
});

describe('proposal -> DG-09 form-flow compile (no canned assertions)', () => {
  it('compiles a NON-auth proposal through the real compiler with observation-bound assertions', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'dg08-compile-'));
    try {
      const result = await compileProposalCandidate({
        proposal: proposal(),
        row: row(),
        evidenceIndex,
        surface: surfaceMap(),
        observation,
        scope: { commit: 'a'.repeat(40), environment: 'local-test', browser: 'chromium' },
        origin,
        allowedOrigins: [widgetOrigin],
        outputDirectory,
      });
      expect(result.compiled).toBe(true);
      if (!result.compiled || !result.stagedBundle) return;
      const workflow = result.stagedBundle.workflow;
      // The compiled workflow IS the DG-09 form-flow workflow: domain and
      // persona come from the PROPOSAL (model data), assertions from the
      // OBSERVATION — never canned literals.
      expect(workflow.domain).toBe('marketing');
      expect(workflow.persona).toBe('visitor');
      expect(workflow.status).not.toBe('verified');
      expect(validateWorkflow(workflow).ok).toBe(true);
      const transition = workflow.transitions[0]!;
      expect(transition.assertions.map(({ intent }) => intent)).toEqual([
        'url:/newsletter/thanks',
        'text@heading:Subscribed',
      ]);
      expect(transition.evidenceRefs).toContain('run:observation-abc123def456');
      expect(transition.evidenceRefs).toContain('src:app-newsletter-page-tsx:1-12');
      // The generated spec fills from env-var input references, never literals.
      const specPath = result.stagedBundle.artifacts.find(
        ({ kind }) => kind === 'playwright-spec',
      )?.path;
      expect(specPath).toBeDefined();
      const spec = await readFile(resolve(outputDirectory, specPath!), 'utf8');
      expect(spec).toContain('labelOrPlaceholderControl(form, "Email")');
      expect(spec).toContain('ARXIC_INPUT_PERSONA_EMAIL');
      expect(spec).toContain(`submitControl(form, "Subscribe").click()`);
      expect(spec).toContain(`configureApprovedOrigins(["${origin}","${widgetOrigin}"])`);
      expect(spec).not.toMatch(/authenticat/iu);
      expect(spec).not.toContain('Hunter2');
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it('blocks honestly (no compile, no fabricated assertions) when no form surface exists', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'dg08-compile-noform-'));
    try {
      const empty: SurfaceMap = {
        ...surfaceMap(),
        routes: [{ ...surfaceMap().routes[0]!, forms: [] }],
      };
      const result = await compileProposalCandidate({
        proposal: proposal(),
        row: row(),
        evidenceIndex,
        surface: empty,
        observation,
        scope: { commit: 'a'.repeat(40), environment: 'local-test', browser: 'chromium' },
        origin,
        outputDirectory,
      });
      expect(result.compiled).toBe(false);
      expect(
        result.diagnostics?.some(({ code }) => code === 'ARXIC-ORCH-PROPOSAL-SURFACE-MISSING'),
      ).toBe(true);
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  // #322 (F-E13): SURFACE-MISSING is a per-item disposition record
  // (observed severity) — the proposal is excluded from compilation while
  // the run proceeds; it must not poison the sticky outcome.
  it('emits SURFACE-MISSING as an observed disposition, not a block (#322)', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'dg08-compile-surface-obs-'));
    try {
      const empty = {
        ...surfaceMap(),
        routes: [{ ...surfaceMap().routes[0]!, forms: [] }],
      };
      const result = await compileProposalCandidate({
        proposal: proposal(),
        row: row(),
        evidenceIndex,
        surface: empty,
        observation,
        scope: { commit: 'a'.repeat(40), environment: 'local-test', browser: 'chromium' },
        origin,
        outputDirectory,
      });
      expect(result.compiled).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'ARXIC-ORCH-PROPOSAL-SURFACE-MISSING',
          severity: 'observed',
        }),
      );
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it('blocks honestly when the post-action observation is missing', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'dg08-compile-noobs-'));
    try {
      const result = await compileProposalCandidate({
        proposal: proposal(),
        row: row(),
        evidenceIndex,
        surface: surfaceMap(),
        observation: undefined,
        scope: { commit: 'a'.repeat(40), environment: 'local-test', browser: 'chromium' },
        origin,
        outputDirectory,
      });
      expect(result.compiled).toBe(false);
      expect(
        result.diagnostics?.some(({ code }) => code === 'ARXIC-ORCH-PROPOSAL-OBSERVATION-MISSING'),
      ).toBe(true);
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it('never emits a canned url:/ assertion: a redirecting observation binds its own url', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'dg08-compile-redirect-'));
    try {
      const result = await compileProposalCandidate({
        proposal: proposal(),
        row: row(),
        evidenceIndex,
        surface: surfaceMap(),
        observation: {
          // The #257 scenario: the app redirects to a dashboard-ish route —
          // the assertion must bind THE OBSERVED url, never a canned '/'.
          url: `${origin}/dashboard`,
          headings: ['Dashboard'],
          runtimeEvidenceRef: 'run:observation-redirect01',
          runtime: {
            ...observation.runtime!,
            url: `${origin}/dashboard`,
          },
        },
        scope: { commit: 'a'.repeat(40), environment: 'local-test', browser: 'chromium' },
        origin,
        outputDirectory,
      });
      expect(result.compiled).toBe(true);
      if (!result.compiled || !result.stagedBundle) return;
      const assertions = result.stagedBundle.workflow.transitions[0]!.assertions.map(
        ({ intent }) => intent,
      );
      expect(assertions).toEqual(['url:/dashboard', 'text@heading:Dashboard']);
      expect(assertions).not.toContain('url:/');
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});

describe('DG-09 builder parity (wiring does not weaken the builder contract)', () => {
  it('the compile path uses buildFormFlowWorkflow output unchanged', async () => {
    const direct = buildFormFlowWorkflow({
      identity: {
        id: proposal().id,
        title: proposal().intent,
        domain: proposal().domain,
        persona: proposal().persona,
      },
      route: '/newsletter',
      fields: [{ label: 'Email', inputRef: 'persona.email' }],
      submitControlName: 'Subscribe',
      observation: {
        url: observation.url,
        headings: observation.headings,
        runtimeEvidenceRef: observation.runtimeEvidenceRef,
      },
      scope: { commit: 'a'.repeat(40), environment: 'local-test', browser: 'chromium' },
      sourceEvidence: {
        ref: 'src:app-newsletter-page-tsx:1-12',
        path: 'app/newsletter/page.tsx',
        range: [1, 12],
      },
      personaFacts: [{ fixture: 'persona' }],
    });
    expect(direct.ok).toBe(true);
  });
});
