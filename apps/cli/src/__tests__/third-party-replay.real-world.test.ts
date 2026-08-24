import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlaywrightCompiler } from '../../../../packages/playwright-compiler/src';
import { serializeScreenshotPrivacyPolicy } from '@arxic/playwright-screenshot-privacy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/parse';
import { PlaywrightVerifier } from '@arxic/verifier';
import {
  loginObservations,
  loginWorkflow,
  referenceAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { bootThirdPartyTarget, type ThirdPartyTarget } from './third-party-target';

/**
 * #288 G-3 — integration over the real boundary: the endpoint-less target
 * (real reference-auth-app behind the G-0 loopback proxy) driven by the real
 * verifier in real Chromium, with the declared per-pass-login persona.
 */
describe('third-party replay verification (#288 G-3)', () => {
  let target: ThirdPartyTarget | undefined;

  beforeAll(async () => {
    target = await bootThirdPartyTarget({ nonce: 'arxic-288-g3' });
  }, 300_000);

  afterAll(async () => {
    await target?.stop();
  });

  it('verifies two classified passes through per-pass login when the declaration is present (C-1/AC-2)', async () => {
    const running = target!;
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-288-g3-out-'));
    const artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-288-g3-artifacts-'));
    const workflow = loginWorkflow(referenceAuthApp, {
      id: 'authentication.login.arxic-288-g3',
      title: 'Third-party replay persona login (G-3)',
      dualEvidence: true,
    });
    const bundle = await new PlaywrightCompiler({
      outputDirectory,
      origin: running.targetOrigin,
    }).compile(workflow, loginObservations(referenceAuthApp, running.targetOrigin, 'arxic-288-g3'));
    const serialized = serializeScreenshotPrivacyPolicy({
      schemaVersion: 1,
      id: 'arxic-288-g3-mask',
      authority: {
        kind: 'repository-policy',
        reference: 'arxic.yaml:policy.screenshots',
        recordedAt: new Date().toISOString(),
      },
      capture: {
        mode: 'masked-page',
        fullPage: true,
        masks: [{ kind: 'role', role: 'main', exact: true }],
      },
    });
    const verifier = new PlaywrightVerifier({
      outputDirectory,
      origin: running.targetOrigin,
      artifactsDir: artifactsDirectory,
      persona: running.persona,
      replayPersona: {
        mode: 'per-pass-login',
        login: {
          route: '/login',
          fields: [
            { label: 'Email', inputRef: 'persona.email' },
            { label: 'Password', inputRef: 'persona.password' },
          ],
          submit: { label: 'Login' },
        },
      },
      screenshotPrivacyPolicy: serialized.policy,
    });

    const verification = await verifier.verify(bundle, bundle.workflow.verification);

    expect(verification.outcome).toBe('verified');
    expect(verification.runs).toEqual([{ passed: true }, { passed: true }]);
    // Zero arxic-protocol round trips succeeded: every attempt was 404-blocked
    // by the proxy — and with the declaration, none is even attempted.
    expect(running.blockedRequests()).toEqual([]);
    // Credential hygiene (Invariants): persona values never surface.
    const rendered = JSON.stringify(verification);
    expect(rendered).not.toContain(running.persona.email);
    expect(rendered).not.toContain(running.persona.password);
  }, 300_000);

  it('refuses fail-closed with NOT-DECLARED and zero passes when the declaration is absent (C-2/AC-3/SP-1)', async () => {
    const running = target!;
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-288-g3-nodecl-out-'));
    const artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-288-g3-nodecl-artifacts-'));
    const workflow = loginWorkflow(referenceAuthApp, {
      id: 'authentication.login.arxic-288-g3-nodecl',
      title: 'Undeclared endpoint-less target (G-3)',
      dualEvidence: true,
    });
    const bundle = await new PlaywrightCompiler({
      outputDirectory,
      origin: running.targetOrigin,
    }).compile(
      workflow,
      loginObservations(referenceAuthApp, running.targetOrigin, 'arxic-288-g3-nodecl'),
    );
    const serialized = serializeScreenshotPrivacyPolicy({
      schemaVersion: 1,
      id: 'arxic-288-g3-nodecl-mask',
      authority: {
        kind: 'repository-policy',
        reference: 'arxic.yaml:policy.screenshots',
        recordedAt: new Date().toISOString(),
      },
      capture: {
        mode: 'masked-page',
        fullPage: true,
        masks: [{ kind: 'role', role: 'main', exact: true }],
      },
    });
    const verifier = new PlaywrightVerifier({
      outputDirectory,
      origin: running.targetOrigin,
      artifactsDir: artifactsDirectory,
      persona: running.persona,
      screenshotPrivacyPolicy: serialized.policy,
    });

    const verification = await verifier.verify(bundle, bundle.workflow.verification);

    // Pre-pass reset against the endpoint-less target blocks with the
    // endpoint diagnostic and ZERO runs — exactly the G-0 Phase-B wall; the
    // #288 stage-7 refusal (NOT-DECLARED) fires one pipeline stage earlier
    // and is proven in the E2E gate.
    expect(verification.outcome).toBe('blocked');
    expect(verification.runs).toEqual([]);
    expect(verification.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'ARXIC-VERIFY-BLOCKED-FIXTURE', severity: 'blocked' }),
    );
    // The refused reset attempt is the ONLY arxic-protocol traffic — zero
    // succeeded ("zero arxic-protocol POSTs beyond the refused attempt").
    expect(running.blockedRequests().length).toBeGreaterThanOrEqual(1);
    expect(running.blockedRequests().every((line) => line.endsWith('-> 404'))).toBe(true);
  }, 300_000);

  it('refuses a production-shaped declared target with PROD-REFUSED at config time, before stage 7 (C-3/AC-4/SP-2)', async () => {
    const config = await writeConfig({
      environmentClass: 'production',
      declaration: {
        mode: 'per-pass-login',
        login: {
          route: '/login',
          fields: [
            { label: 'Email', inputRef: 'persona.email' },
            { label: 'Password', inputRef: 'persona.password' },
          ],
          submit: { label: 'Login' },
        },
      },
    });
    const result = await loadConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'ARXIC-VERIFY-FIXTURE-PROD-REFUSED',
          severity: 'blocked',
        }),
      );
      // The default production refusal stays in force too.
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'ARXIC-CONFIG-INVALID',
          subject: 'config.target.environmentClass',
        }),
      );
    }
  });
});

async function writeConfig(options: {
  environmentClass: string;
  declaration: Record<string, unknown>;
}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-288-g3-config-'));
  const path = join(directory, 'arxic.yaml');
  await writeFile(
    path,
    `version: 1
source:
  repository: .
  revision: HEAD
  languages: [typescript]
scope:
  domains: [authentication]
  frameworks: [nextjs]
  browsers: [chromium]
  personas: [registered-user]
target:
  origin: http://127.0.0.1:1
  environmentClass: ${options.environmentClass}
  attestationPath: /.well-known/arxic-test-target.json
  allowedOrigins: [http://127.0.0.1:1]
policy:
  maxUrls: 8
  maxDepth: 1
  maxRuntimeMinutes: 30
  mutation: leased-fixtures-only
  externalNetwork: deny
  requiredVerificationRuns: 2
  screenshots: transition-checkpoints
  trace: retain
  humanApproval: [destructive]
fixtures:
  replayPersona: ${JSON.stringify(options.declaration)}
models:
  provider: configured-adapter
  sourceRetention: disabled
`,
  );
  return path;
}
