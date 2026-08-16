// DG-09 real-world proof (#253 acceptance + #258 regression):
//  1. the exact campaign failure case — a redirect-after-login app (302 →
//     /dashboard) — verifies END-TO-END through observation-bound assertions:
//     capture → derive → generic form-flow workflow → real PlaywrightCompiler
//     → real PlaywrightVerifier (two clean Chromium replays) → verified;
//  2. the canned url:/ twin (the campaign's canned candidate) now classifies
//     HONESTLY as contradicted with the failure evidence retained and the
//     artifact gate reported alongside (#258: previously masked blocked behind
//     ARXIC-VERIFY-ARTIFACT-MISSING with the failure text purged);
//  3. a generic NON-AUTH form flow (newsletter subscribe) verifies through the
//     same unchanged executor — domain generality.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializeScreenshotPrivacyPolicy } from '@arxic/playwright-screenshot-privacy';
import { freePort } from '@arxic/real-world-testkit';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { EvidenceRef, Workflow } from '@arxic/contracts';
import { PlaywrightVerifier } from './verifier';
import {
  ARXIC_VERIFY_APP_DEFECT,
  ARXIC_VERIFY_ARTIFACT_MISSING,
  ARXIC_VERIFY_RUN_FAILURE,
} from './diagnostics';
import {
  PlaywrightCompiler,
  buildFormFlowWorkflow,
  resetAndSeedRedirectApp,
  startRedirectLoginApp,
  stopRedirectLoginApp,
  redirectAppReady,
  type RedirectLoginAppOptions,
} from '@arxic/playwright-compiler';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const PERSONA = {
  email: 'dg09-verifier@example.test',
  password: 'Dg09VerifierProof9!',
};
const APP_SOURCE = 'packages/playwright-compiler/src/test-support/redirect-login-app.ts';

function sourceObservation(range: readonly [number, number]): EvidenceRef {
  return {
    kind: 'source',
    repo: 'https://github.com/anthonykewl20/arxic',
    commit: COMMIT,
    path: APP_SOURCE,
    startLine: range[0],
    endLine: range[1],
    blobSha256: 'a'.repeat(64),
    extractor: 'dg09-redirect-verification',
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

/** The campaign's CANNED candidate: a login workflow whose post-login
 * assertion is the literal `url:/` — structurally wrong on this app. */
function cannedLoginWorkflow(origin: string): Workflow {
  const built = buildFormFlowWorkflow({
    identity: {
      id: 'authentication.login.canned-literal',
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
      url: `${origin}/`,
      headings: [],
      runtimeEvidenceRef: 'run:post-action-observation',
    },
    scope: { commit: COMMIT, environment: 'local-test', browser: 'chromium' },
    sourceEvidence: { ref: 'src:dg09-login-handler', path: APP_SOURCE, range: [180, 220] },
  });
  if (!built.ok) throw new Error('canned workflow build failed');
  return built.workflow;
}

function verifierFor(
  origin: string,
  outputDirectory: string,
  artifactsDirectory: string,
  heading: string,
) {
  return new PlaywrightVerifier({
    outputDirectory,
    origin,
    artifactsDir: artifactsDirectory,
    persona: PERSONA,
    screenshotPrivacyPolicy: serializeScreenshotPrivacyPolicy({
      schemaVersion: 1,
      id: `dg09-${heading.toLowerCase()}-heading`,
      authority: {
        kind: 'repository-policy',
        reference: 'docs/evidence/DG-09/README.md',
        recordedAt: '2026-08-17T12:00:00.000Z',
      },
      capture: {
        mode: 'approved-region',
        region: { kind: 'role', role: 'heading', name: heading, exact: true },
        masks: [],
      },
    }).policy,
    resetAndSeed: async () => {
      await resetAndSeedRedirectApp(origin, PERSONA);
    },
  });
}

describe.sequential(
  'DG-09 verifier: redirect-after-login verifies end-to-end; canned literal contradicts honestly (#258)',
  () => {
    let origin = '';
    let server: Awaited<ReturnType<typeof startRedirectLoginApp>>['server'] | undefined;
    let outputDirectory = '';
    let artifactsDirectory = '';

    beforeAll(async () => {
      const port = await freePort();
      origin = `http://127.0.0.1:${port}`;
      const dbDirectory = await mkdtemp(join(tmpdir(), 'dg09-verifier-db-'));
      const options: RedirectLoginAppOptions = {
        port,
        dbPath: join(dbDirectory, 'app.db'),
        origin,
      };
      ({ server } = await startRedirectLoginApp(options));
      await redirectAppReady(origin);
      outputDirectory = await mkdtemp(join(tmpdir(), 'dg09-verifier-output-'));
      artifactsDirectory = await mkdtemp(join(tmpdir(), 'dg09-verifier-artifacts-'));
      await resetAndSeedRedirectApp(origin, PERSONA);
    }, 120_000);

    afterAll(async () => {
      if (server) await stopRedirectLoginApp(server);
      await Promise.all(
        [outputDirectory, artifactsDirectory]
          .filter((path) => path.length > 0)
          .map((path) => rm(path, { recursive: true, force: true })),
      );
    });

    test('the campaign case verifies: observation-bound url:/dashboard through two clean Chromium replays', async () => {
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
        sourceEvidence: { ref: 'src:dg09-login-handler', path: APP_SOURCE, range: [180, 220] },
      });
      if (!built.ok) throw new Error('observation-bound workflow build failed');

      const bundle = await new PlaywrightCompiler({ outputDirectory, origin }).compile(
        built.workflow,
        [sourceObservation([180, 220]), entryRuntimeObservation(origin, '/login')],
      );
      const result = await verifierFor(
        origin,
        outputDirectory,
        artifactsDirectory,
        'Dashboard',
      ).verify(bundle, {
        requiredRuns: 2,
        forbidNetworkErrors: true,
        screenshotCheckpoints: ['dashboard-page'],
        trace: 'retain',
      });

      expect(result.outcome, JSON.stringify(result.diagnostics)).toBe('verified');
      expect(result.runs).toEqual([{ passed: true }, { passed: true }]);
      expect(result.artifacts.length).toBeGreaterThan(0);
    }, 420_000);

    test('the canned url:/ literal contradicts HONESTLY with retained failure evidence (#258 regression)', async () => {
      const cannedOutput = await mkdtemp(join(tmpdir(), 'dg09-canned-output-'));
      const cannedArtifacts = await mkdtemp(join(tmpdir(), 'dg09-canned-artifacts-'));
      try {
        const bundle = await new PlaywrightCompiler({
          outputDirectory: cannedOutput,
          origin,
        }).compile(cannedLoginWorkflow(origin), [
          sourceObservation([180, 220]),
          entryRuntimeObservation(origin, '/login'),
        ]);
        const result = await verifierFor(origin, cannedOutput, cannedArtifacts, 'Dashboard').verify(
          bundle,
          {
            requiredRuns: 2,
            forbidNetworkErrors: true,
            screenshotCheckpoints: ['home'],
            trace: 'retain',
          },
        );

        // The runs genuinely fail (never a silent pass)…
        expect(result.runs).toEqual([{ passed: false }, { passed: false }]);
        // …and the classification is HONEST: contradicted with the app-defect
        // cause first — not masked blocked behind ARXIC-VERIFY-ARTIFACT-MISSING.
        expect(result.outcome, JSON.stringify(result.diagnostics)).toBe('contradicted');
        expect(result.diagnostics[0]).toMatchObject({ code: ARXIC_VERIFY_APP_DEFECT });
        // The failure evidence is RETAINED (assertion text survives)…
        const runFailure = result.diagnostics.find(({ code }) => code === ARXIC_VERIFY_RUN_FAILURE);
        expect(runFailure).toBeDefined();
        expect(runFailure?.message).toMatch(/toHaveURL/u);
        // …and the artifact-gate failure is reported ALONGSIDE, not instead.
        expect(result.diagnostics.map(({ code }) => code)).toContain(ARXIC_VERIFY_ARTIFACT_MISSING);
        // No privacy regression: persona secrets never reach the diagnostics.
        const rendered = JSON.stringify(result.diagnostics);
        expect(rendered).not.toContain(PERSONA.email);
        expect(rendered).not.toContain(PERSONA.password);
        // Retained-evidence hook (mirrors ARXIC_TRACE_SANITIZATION_EVIDENCE_DIR).
        const retainedEvidence = process.env.ARXIC_DG09_EVIDENCE_DIR;
        if (retainedEvidence) {
          const { mkdir, writeFile } = await import('node:fs/promises');
          await mkdir(retainedEvidence, { recursive: true });
          await writeFile(
            join(retainedEvidence, 'defect-258-regression.json'),
            `${JSON.stringify(
              {
                subject: 'authentication.login.canned-literal',
                engine: 'real Chromium via PlaywrightVerifier (two clean-fixture runs)',
                runs: result.runs,
                outcome: result.outcome,
                diagnosticCodes: result.diagnostics.map(({ code, severity }) => ({
                  code,
                  severity,
                })),
                retainedFailureEvidence: result.diagnostics
                  .filter(({ code }) => code === ARXIC_VERIFY_RUN_FAILURE)
                  .map(({ message }) => message),
              },
              null,
              2,
            )}\n`,
            'utf8',
          );
        }
      } finally {
        await Promise.all(
          [cannedOutput, cannedArtifacts].map((path) => rm(path, { recursive: true, force: true })),
        );
      }
    }, 420_000);

    test('the generic NON-AUTH newsletter form flow verifies end-to-end (domain generality)', async () => {
      const newsletterOutput = await mkdtemp(join(tmpdir(), 'dg09-newsletter-output-'));
      const newsletterArtifacts = await mkdtemp(join(tmpdir(), 'dg09-newsletter-artifacts-'));
      try {
        const built = buildFormFlowWorkflow({
          identity: {
            id: 'marketing.newsletter.subscribe',
            title: 'Newsletter subscribe',
            domain: 'marketing',
            persona: 'visitor',
          },
          route: '/newsletter',
          fields: [{ label: 'Email', inputRef: 'persona.email' }],
          submitControlName: 'Subscribe',
          observation: {
            url: `${origin}/newsletter/thanks`,
            headings: ['Subscribed'],
            runtimeEvidenceRef: 'run:post-action-observation-newsletter',
          },
          scope: { commit: COMMIT, environment: 'local-test', browser: 'chromium' },
          sourceEvidence: {
            ref: 'src:dg09-newsletter-handler',
            path: APP_SOURCE,
            range: [230, 270],
          },
        });
        if (!built.ok) throw new Error('newsletter workflow build failed');

        const bundle = await new PlaywrightCompiler({
          outputDirectory: newsletterOutput,
          origin,
        }).compile(built.workflow, [
          sourceObservation([230, 270]),
          entryRuntimeObservation(origin, '/newsletter'),
        ]);
        const verifier = new PlaywrightVerifier({
          outputDirectory: newsletterOutput,
          origin,
          artifactsDir: newsletterArtifacts,
          persona: PERSONA,
          screenshotPrivacyPolicy: serializeScreenshotPrivacyPolicy({
            schemaVersion: 1,
            id: 'dg09-newsletter-subscribed-heading',
            authority: {
              kind: 'repository-policy',
              reference: 'docs/evidence/DG-09/README.md',
              recordedAt: '2026-08-17T12:00:00.000Z',
            },
            capture: {
              mode: 'approved-region',
              region: { kind: 'role', role: 'heading', name: 'Subscribed', exact: true },
              masks: [],
            },
          }).policy,
          resetAndSeed: async () => {
            // The newsletter flow needs no persona beyond the shared fixture
            // control; reset keeps subscriber state deterministic per run.
            await resetAndSeedRedirectApp(origin, PERSONA);
          },
        });
        const result = await verifier.verify(bundle, {
          requiredRuns: 2,
          forbidNetworkErrors: true,
          screenshotCheckpoints: ['newsletter-thanks-page'],
          trace: 'retain',
        });

        expect(result.outcome, JSON.stringify(result.diagnostics)).toBe('verified');
        expect(result.runs).toEqual([{ passed: true }, { passed: true }]);
      } finally {
        await Promise.all(
          [newsletterOutput, newsletterArtifacts].map((path) =>
            rm(path, { recursive: true, force: true }),
          ),
        );
      }
    }, 420_000);
  },
);
