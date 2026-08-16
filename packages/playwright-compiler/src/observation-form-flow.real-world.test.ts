// DG-09 real-world proof (#253 acceptance): the compiler consumes
// observation-bound assertions. The chain runs with REAL engines end to end:
// real Chromium exploration capture of the redirect-login app (302 →
// /dashboard — the #257 defect class neither fixture app exercises) →
// observation-derived assertions → generic form-flow workflow built purely
// from inventory data → the UNCHANGED PlaywrightCompiler + compile-policy
// gates. A second, NON-AUTH form flow (newsletter subscribe) proves the
// executor is domain-general.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { freePort } from '@arxic/real-world-testkit';
import { PlaywrightCompiler } from './compiler';
import { buildFormFlowWorkflow } from './form-flow';
import { capturePostActionObservation } from './observation-capture';
import {
  redirectAppReady,
  resetAndSeedRedirectApp,
  startRedirectLoginApp,
  stopRedirectLoginApp,
  type RedirectLoginAppOptions,
} from './test-support/redirect-login-app';
import type { EvidenceRef } from '@arxic/contracts';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const PERSONA = {
  email: 'dg09-compiler@example.test',
  password: 'Dg09CompilerProof9!',
};

function sourceEvidence(path: string, range: readonly [number, number]): EvidenceRef {
  return {
    kind: 'source',
    repo: 'https://github.com/anthonykewl20/arxic',
    commit: COMMIT,
    path,
    startLine: range[0],
    endLine: range[1],
    blobSha256: 'a'.repeat(64),
    extractor: 'dg09-observation-form-flow',
  };
}

function entryRuntimeObservation(origin: string, route: string): EvidenceRef {
  return {
    kind: 'runtime',
    runId: 'run-dg09-entry',
    appBuildDigest: 'b'.repeat(64),
    browser: 'chromium',
    browserVersion: '1.62.1',
    url: `${origin}${route}`,
    timestamp: new Date().toISOString(),
  };
}

describe.sequential('DG-09 compiler observation-bound form flows (real Chromium)', () => {
  let origin = '';
  let server: Awaited<ReturnType<typeof startRedirectLoginApp>>['server'] | undefined;
  let outputDirectory = '';

  beforeAll(async () => {
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    const dbDirectory = await mkdtemp(join(tmpdir(), 'dg09-compiler-db-'));
    const options: RedirectLoginAppOptions = {
      port,
      dbPath: join(dbDirectory, 'app.db'),
      origin,
    };
    ({ server } = await startRedirectLoginApp(options));
    await redirectAppReady(origin);
    await resetAndSeedRedirectApp(origin, PERSONA);
    outputDirectory = await mkdtemp(join(tmpdir(), 'dg09-compiler-output-'));
  }, 120_000);

  afterAll(async () => {
    if (server) await stopRedirectLoginApp(server);
    if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
  });

  test('captures the login post-action observation in real Chromium (redirect → /dashboard)', async () => {
    const capture = await capturePostActionObservation({
      runId: 'run-dg09-login-observation',
      origin,
      appBuildDigest: 'b'.repeat(64),
      steps: [
        { intent: 'open login page', kind: 'navigate', url: `${origin}/login` },
        {
          intent: 'fill email',
          kind: 'fill',
          locator: {
            semantic: { kind: 'label', text: 'Email' },
            execution: { kind: 'label', text: 'Email' },
          },
          value: PERSONA.email,
          url: `${origin}/login`,
        },
        {
          intent: 'fill password',
          kind: 'fill',
          locator: {
            semantic: { kind: 'label', text: 'Password' },
            execution: { kind: 'label', text: 'Password' },
          },
          value: PERSONA.password,
        },
        {
          intent: 'submit login',
          kind: 'click',
          locator: {
            semantic: { kind: 'role', role: 'button', name: 'Log in' },
            execution: { kind: 'role', role: 'button', name: 'Log in' },
          },
        },
      ],
    });
    expect(capture.ok, JSON.stringify((capture as { diagnostics?: unknown }).diagnostics)).toBe(
      true,
    );
    if (!capture.ok) return;
    expect(capture.observation.url).toBe(`${origin}/dashboard`);
    expect(capture.observation.headings).toContain('Dashboard');
    expect(capture.observation.evidence.accessibilitySnapshotSha256).toMatch(/^[0-9a-f]{64}$/);
  }, 180_000);

  test('builds and compiles the login form flow with observation-bound assertions (campaign case)', async () => {
    const built = buildFormFlowWorkflow({
      identity: {
        id: 'authentication.login.observation-bound',
        title: 'Log in',
        domain: 'authentication',
        persona: 'registered-user',
      },
      route: '/login',
      fields: [
        { label: 'Email', inputRef: 'persona.email' },
        { label: 'Password', inputRef: 'persona.password' },
      ],
      submitControlName: 'Log in',
      observation: {
        url: `${origin}/dashboard`,
        headings: ['Dashboard'],
        runtimeEvidenceRef: 'run:post-action-observation',
      },
      scope: { commit: COMMIT, environment: 'local-test', browser: 'chromium' },
      sourceEvidence: {
        ref: 'src:dg09-login-handler',
        path: 'packages/playwright-compiler/src/test-support/redirect-login-app.ts',
        range: [180, 220],
      },
      personaFacts: [{ fixture: 'user.exists' }],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const bundle = await new PlaywrightCompiler({ outputDirectory, origin }).compile(
      built.workflow,
      [
        sourceEvidence(
          'packages/playwright-compiler/src/test-support/redirect-login-app.ts',
          [180, 220],
        ),
        entryRuntimeObservation(origin, '/login'),
      ],
    );

    const spec = await readFile(join(outputDirectory, 'tests/workflow.spec.ts'), 'utf8');
    // Observation-bound assertions, not canned literals: the derived
    // url:/dashboard replaces the campaign's canned url:/ (the anchored regex
    // targets /dashboard specifically and tolerates query/fragment only).
    expect(spec).toContain('\\/dashboard(?:[?#].*)?$/);');
    expect(spec).toContain('await expect(page.getByText("Dashboard")).toBeVisible();');
    expect(spec).not.toMatch(/url:\//u);
    // Entry navigation uses the observed entry route.
    expect(spec).toContain(`page.goto(${JSON.stringify(`${origin}/login`)})`);
    // Evidence index carries the post-action observation ref.
    expect(Object.keys(bundle.evidenceIndex)).toContain('run:post-action-observation');
  }, 120_000);

  test('compiles the generic NON-AUTH newsletter form flow from inventory data (domain generality)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dg09-newsletter-output-'));
    try {
      const built = buildFormFlowWorkflow({
        identity: {
          id: 'marketing.newsletter.subscribe',
          title: 'Newsletter subscribe',
          domain: 'marketing',
          persona: 'visitor',
        },
        route: '/newsletter',
        fields: [{ label: 'Email', inputRef: 'visitor.email' }],
        submitControlName: 'Subscribe',
        observation: {
          url: `${origin}/newsletter/thanks`,
          headings: ['Subscribed'],
          runtimeEvidenceRef: 'run:post-action-observation-newsletter',
        },
        scope: { commit: COMMIT, environment: 'local-test', browser: 'chromium' },
        sourceEvidence: {
          ref: 'src:dg09-newsletter-handler',
          path: 'packages/playwright-compiler/src/test-support/redirect-login-app.ts',
          range: [230, 270],
        },
      });
      expect(built.ok).toBe(true);
      if (!built.ok) return;

      await new PlaywrightCompiler({ outputDirectory: directory, origin }).compile(built.workflow, [
        sourceEvidence(
          'packages/playwright-compiler/src/test-support/redirect-login-app.ts',
          [230, 270],
        ),
        entryRuntimeObservation(origin, '/newsletter'),
      ]);

      const spec = await readFile(join(directory, 'tests/workflow.spec.ts'), 'utf8');
      expect(spec).toContain(`page.goto(${JSON.stringify(`${origin}/newsletter`)})`);
      expect(spec).toContain('getByLabel("Email")');
      expect(spec).toContain('\\/newsletter\\/thanks(?:[?#].*)?$/);');
      expect(spec).toContain('await expect(page.getByText("Subscribed")).toBeVisible();');
      // No auth semantics anywhere: the flow never touches session state.
      expect(spec).not.toContain('Log in');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
