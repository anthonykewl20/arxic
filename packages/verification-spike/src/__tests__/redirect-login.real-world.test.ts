// DG-03 PROOF 4a — redirect-after-login verifies END-TO-END with
// observation-derived assertions, against a REAL app whose post-login redirect
// is /dashboard (the #257 defect class; both Arxic fixture apps redirect to '/',
// so they cannot exercise it — see the spike report).
//
// Chain under proof (real engines only):
//   real Chromium exploration capture → derived `url:/dashboard` assertion →
//   IntentSpec binding via the REAL @arxic/intent (characterization vs
//   acceptance) → REAL PlaywrightCompiler → REAL PlaywrightVerifier (two clean
//   Chromium replays) → truth-state policy resolution.
//
// Sad twins in the same suite: the CANNED `url:/` literal must come out
// `contradicted` on this app (the defect is real), and the observed-only
// binding must cap at `observed` even when the deterministic replay verified.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvidenceRef, Workflow } from '@arxic/contracts';
import {
  enforceIntentProvenancePolicy,
  everyRequiredAssertionAcceptance,
  normalizeIntentSpec,
} from '@arxic/intent';
import { PlaywrightCompiler } from '@arxic/playwright-compiler';
import { serializeScreenshotPrivacyPolicy } from '@arxic/playwright-screenshot-privacy';
import { freePort } from '@arxic/real-world-testkit';
import { PlaywrightVerifier, resetAndSeedFixtures } from '@arxic/verifier';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { deriveAssertionsFromObservation } from '../derive-assertions';
import { observationDerivedIntentSpec, runtimeEvidenceIdFor } from '../intent-binding';
import { capturePostActionObservation } from '../observation';
import { startRedirectLoginApp, stopRedirectLoginApp } from '../test-app/redirect-login-app';
import { resolveReplayTruthState } from '../truth-policy';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const PERSONA = {
  email: 'dg03-redirect@example.test',
  password: 'Dg03RedirectSpike9!',
};

function spikeDomainRule(expectedValuePrefix: 'url' | 'other') {
  const identity = {
    domainPackId: '@arxic/verification-spike',
    ruleId: `dg03.redirect-login.post-login-target.${expectedValuePrefix}`,
    ruleVersion: '0.1.1',
  };
  return {
    kind: 'domain-rule' as const,
    ...identity,
    digest: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
  };
}

function redirectLoginWorkflow(id: string, assertionIntents: readonly string[]): Workflow {
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id,
    version: 1,
    title: 'DG-03 redirect login proof',
    domain: 'authentication',
    persona: 'registered-user',
    status: 'observed',
    confidence: 1,
    scope: { commit: COMMIT, environment: 'local-test', browser: 'chromium' },
    preconditions: [{ fixture: 'user.exists' }],
    states: [{ id: 'login-page' }, { id: 'dashboard' }],
    transitions: [
      {
        from: 'login-page',
        to: 'dashboard',
        action: {
          intent: 'Submit login credentials',
          inputRefs: { email: 'persona.email', password: 'persona.password' },
        },
        assertions: assertionIntents.map((intent) => ({ intent })),
        evidenceRefs: ['src:dg03-redirect-login', 'run:dg03-redirect-login'],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      screenshotCheckpoints: ['dashboard'],
      forbidNetworkErrors: true,
      trace: 'retain',
    },
    evidenceRefs: ['src:dg03-redirect-login', 'run:dg03-redirect-login'],
  };
}

function compileObservations(origin: string): EvidenceRef[] {
  return [
    {
      kind: 'source',
      repo: 'https://github.com/anthonykewl20/arxic',
      commit: COMMIT,
      path: 'packages/verification-spike/src/test-app/redirect-login-app.ts',
      startLine: 1,
      endLine: 60,
      blobSha256: 'a'.repeat(64),
      extractor: 'dg03-spike-source',
    },
    {
      kind: 'runtime',
      runId: 'run-dg03-redirect-login',
      appBuildDigest: 'b'.repeat(64),
      browser: 'chromium',
      browserVersion: '1.62.1',
      url: `${origin}/login`,
      timestamp: new Date().toISOString(),
    },
  ];
}

describe.sequential(
  'DG-03 proof 4a: observation-derived assertions verify a redirect-after-login flow end-to-end',
  () => {
    let origin = '';
    let server: Awaited<ReturnType<typeof startRedirectLoginApp>>['server'] | undefined;
    let outputDirectory = '';
    let artifactsDirectory = '';
    let derivedAssertionIntents: string[] = [];
    let capturedRuntimeEvidenceId = '';

    beforeAll(async () => {
      const port = await freePort();
      origin = `http://127.0.0.1:${port}`;
      const dbDirectory = await mkdtemp(join(tmpdir(), 'dg03-redirect-db-'));
      const started = await startRedirectLoginApp({
        port,
        dbPath: join(dbDirectory, 'app.db'),
        origin,
      });
      server = started.server;
      outputDirectory = await mkdtemp(join(tmpdir(), 'dg03-verifier-output-'));
      artifactsDirectory = await mkdtemp(join(tmpdir(), 'dg03-verifier-artifacts-'));
      await resetAndSeedFixtures(origin, PERSONA);
    }, 120_000);

    afterAll(async () => {
      if (server) await stopRedirectLoginApp(server);
      await Promise.all(
        [outputDirectory, artifactsDirectory]
          .filter((path) => path.length > 0)
          .map((path) => rm(path, { recursive: true, force: true })),
      );
    });

    test('stage-8 exploration captures the post-action URL and DOM state in real Chromium', async () => {
      const capture = await capturePostActionObservation({
        runId: 'run-dg03-redirect-login',
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
      // The post-login redirect target, captured from the live app — NOT a canned literal.
      expect(capture.observation.url).toBe(`${origin}/dashboard`);
      expect(capture.observation.headings).toContain('Dashboard');
      expect(capture.observation.evidence.accessibilitySnapshotSha256).toMatch(/^[0-9a-f]{64}$/);
      capturedRuntimeEvidenceId = runtimeEvidenceIdFor(capture.observation.evidence);
      const retainedEvidence = process.env.ARXIC_DG03_EVIDENCE_DIR;
      if (retainedEvidence) {
        await mkdir(retainedEvidence, { recursive: true });
        await writeFile(
          join(retainedEvidence, 'observation-capture.json'),
          `${JSON.stringify(
            {
              subject: 'dg03.redirect-login.observation-capture',
              engine: 'real Chromium via PlaywrightExplorationDriver (stage-8 seam)',
              postActionUrl: capture.observation.url,
              domSnapshotSha256: capture.observation.domSnapshotSha256,
              headings: capture.observation.headings,
              runtimeEvidenceId: capturedRuntimeEvidenceId,
              browserVersion: capture.observation.evidence.browserVersion,
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
      }
      const derived = deriveAssertionsFromObservation({
        url: capture.observation.url,
        headings: capture.observation.headings,
      });
      expect(derived.ok).toBe(true);
      if (!derived.ok) return;
      derivedAssertionIntents = derived.assertions.map(({ intent }) => intent);
      expect(derivedAssertionIntents[0]).toBe('url:/dashboard');
      expect(derivedAssertionIntents).toContain('text:Dashboard');
    }, 180_000);

    test('derived assertions bind into IntentSpec: characterization without an oracle, acceptance with one', async () => {
      expect(derivedAssertionIntents.length).toBeGreaterThan(0);
      const derived = deriveAssertionsFromObservation({
        url: `${origin}/dashboard`,
        headings: ['Dashboard'],
      });
      if (!derived.ok) throw new Error('expected derived assertions');
      const base = {
        specIdentity: {
          id: 'dg03-redirect-login',
          domain: 'authentication',
          persona: 'registered-user',
          intent: 'Log in and land on the dashboard',
        },
        lineage: {
          commit: COMMIT,
          appBuildDigest: 'b'.repeat(64),
          fixtureSeedDigest: createHash('sha256').update(PERSONA.email).digest('hex'),
          featureFlagsDigest: createHash('sha256').update('none').digest('hex'),
          policyDigest: createHash('sha256').update('local-test').digest('hex'),
        },
        sourceEvidence: ['src:dg03-redirect-login'],
        proposals: [
          {
            id: 'dg03-redirect-login:0',
            intent: 'Submit login credentials',
            action: 'Submit login credentials',
            fromState: 'login-page',
            toState: 'dashboard',
            evidenceRefs: {
              source: ['src:dg03-redirect-login'],
              runtime: [capturedRuntimeEvidenceId],
            },
          },
        ],
        derived: derived.assertions,
        runtimeEvidenceId: capturedRuntimeEvidenceId,
      };

      const characterization = normalizeIntentSpec(
        observationDerivedIntentSpec({ ...base, oracle: { kind: 'observed-only' } }),
      );
      expect(characterization.ok).toBe(true);
      if (characterization.ok) {
        expect(
          characterization.spec.assertions.every(({ kind }) => kind === 'characterization'),
        ).toBe(true);
      }

      const acceptance = normalizeIntentSpec(
        observationDerivedIntentSpec({ ...base, oracle: spikeDomainRule('url') }),
      );
      expect(acceptance.ok).toBe(true);
      const workflow = redirectLoginWorkflow(
        'dg03.redirect-login.observation-derived',
        derivedAssertionIntents,
      );
      if (!acceptance.ok) return;
      expect(enforceIntentProvenancePolicy(workflow, acceptance.spec)).toEqual({ ok: true });
      expect(everyRequiredAssertionAcceptance(workflow, acceptance.spec)).toBe(true);
      if (characterization.ok) {
        expect(everyRequiredAssertionAcceptance(workflow, characterization.spec)).toBe(false);
      }
    });

    test('the derived url:/dashboard assertion verifies end-to-end (compile + two clean Chromium replays)', async () => {
      expect(derivedAssertionIntents[0]).toBe('url:/dashboard');
      const bundle = await new PlaywrightCompiler({
        outputDirectory,
        origin,
      }).compile(
        redirectLoginWorkflow('dg03.redirect-login.observation-derived', derivedAssertionIntents),
        compileObservations(origin),
      );
      const verifier = new PlaywrightVerifier({
        outputDirectory,
        origin,
        artifactsDir: artifactsDirectory,
        persona: PERSONA,
        screenshotPrivacyPolicy: serializeScreenshotPrivacyPolicy({
          schemaVersion: 1,
          id: 'dg03-redirect-dashboard-heading',
          authority: {
            kind: 'repository-policy',
            reference: 'docs/evidence/DG-03/README.md',
            recordedAt: '2026-08-16T12:00:00.000Z',
          },
          capture: {
            mode: 'approved-region',
            region: { kind: 'role', role: 'heading', name: 'Dashboard', exact: true },
            masks: [],
          },
        }).policy,
        resetAndSeed: async () => {
          await resetAndSeedFixtures(origin, PERSONA);
        },
      });
      const result = await verifier.verify(bundle, {
        requiredRuns: 2,
        forbidNetworkErrors: true,
        screenshotCheckpoints: ['dashboard'],
        trace: 'retain',
      });
      expect(result.outcome, JSON.stringify(result.diagnostics)).toBe('verified');
      expect(result.runs).toEqual([{ passed: true }, { passed: true }]);
      expect(result.artifacts.length).toBeGreaterThan(0);
    }, 420_000);

    test('the canned url:/ literal fails on this app — and the failure classification is masked blocked (reproduces #257 + #258)', async () => {
      // The canned post-login assertion `url:/` is FALSE on this app (it redirects
      // to /dashboard) — the #257 defect class. The honest classification would be
      // `contradicted`; what the CURRENT verifier actually reports is `blocked`
      // with ARXIC-VERIFY-ARTIFACT-MISSING, because the failed assertion means the
      // checkpoint screenshot is never taken, the screenshot-privacy inventory gate
      // then fails, failure-evidence retention is purged, and the artifact gate
      // outranks the run classification — exactly the masking recorded as #258.
      // The run outcomes below still prove the canned literal fails; the
      // observation-derived assertion is what fixes #257 by construction.
      const cannedOutput = await mkdtemp(join(tmpdir(), 'dg03-canned-output-'));
      const cannedArtifacts = await mkdtemp(join(tmpdir(), 'dg03-canned-artifacts-'));
      try {
        const bundle = await new PlaywrightCompiler({
          outputDirectory: cannedOutput,
          origin,
        }).compile(
          redirectLoginWorkflow('dg03.redirect-login.canned-literal', ['url:/']),
          compileObservations(origin),
        );
        const result = await new PlaywrightVerifier({
          outputDirectory: cannedOutput,
          origin,
          artifactsDir: cannedArtifacts,
          persona: PERSONA,
          screenshotPrivacyPolicy: serializeScreenshotPrivacyPolicy({
            schemaVersion: 1,
            id: 'dg03-redirect-canned-heading',
            authority: {
              kind: 'repository-policy',
              reference: 'docs/evidence/DG-03/README.md',
              recordedAt: '2026-08-16T12:00:00.000Z',
            },
            capture: {
              mode: 'approved-region',
              region: { kind: 'role', role: 'heading', name: 'Dashboard', exact: true },
              masks: [],
            },
          }).policy,
          resetAndSeed: async () => {
            await resetAndSeedFixtures(origin, PERSONA);
          },
        }).verify(bundle, {
          requiredRuns: 2,
          forbidNetworkErrors: true,
          screenshotCheckpoints: ['dashboard'],
          trace: 'retain',
        });
        // The canned literal genuinely fails in every clean run (never a silent pass).
        expect(result.runs).toEqual([{ passed: false }, { passed: false }]);
        expect(result.outcome).not.toBe('verified');
        // The current verifier masks the contradiction behind the artifact gate (#258).
        expect(result.outcome).toBe('blocked');
        expect(result.diagnostics.map(({ code }) => code)).toContain(
          'ARXIC-VERIFY-ARTIFACT-MISSING',
        );
      } finally {
        await Promise.all(
          [cannedOutput, cannedArtifacts].map((path) => rm(path, { recursive: true, force: true })),
        );
      }
    }, 420_000);

    test('the truth-state policy caps the observed-only binding at observed even after a verified replay', async () => {
      const capped = resolveReplayTruthState({
        surface: 'replayable-browser',
        oracleKinds: ['observed-only'],
        replayOutcome: 'verified',
      });
      expect(capped.truthState).toBe('observed');
      expect(capped.capped).toBe(true);

      const accepted = resolveReplayTruthState({
        surface: 'replayable-browser',
        oracleKinds: ['domain-rule'],
        replayOutcome: 'verified',
      });
      expect(accepted.truthState).toBe('verified');
      expect(accepted.capped).toBe(false);
    });
  },
);
