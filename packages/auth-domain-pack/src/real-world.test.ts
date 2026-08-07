import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  FIXTURE_APPS,
  bootFixtureApp,
  loginObservations,
  seedFixture,
  stopApp,
  type RunningApp,
} from '@arxic/real-world-testkit';
import { AuthDomainPackAssembler, authCandidates } from './index';

const root = fileURLToPath(new URL('../../../', import.meta.url));

describe.each(FIXTURE_APPS)('authentication domain pack real-world proof: $name', (app) => {
  let running: RunningApp | undefined;
  let outputDirectory = '';
  let artifactsDirectory = '';

  beforeAll(async () => {
    running = await bootFixtureApp(root, app, `arxic-auth-pack-${app.name}`);
    outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-auth-pack-output-'));
    artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-auth-pack-artifacts-'));
    await seedFixture(running.origin, `auth-pack-${app.name}`, app.persona);
  }, 300_000);

  afterAll(async () => {
    await stopApp(running?.child);
    await Promise.all(
      [running?.runtimeDirectory, outputDirectory, artifactsDirectory]
        .filter((path): path is string => Boolean(path))
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test('derives honest real-Chromium dispositions for either app from observed evidence', async () => {
    if (!running) throw new Error(`Fixture app ${app.name} did not start`);
    const candidates = authCandidates(app.authSurface);
    const pack = await new AuthDomainPackAssembler({
      origin: running.origin,
      outputDirectory,
      artifactsDir: artifactsDirectory,
      persona: app.persona,
    }).assemble(
      candidates,
      loginObservations(app, running.origin, `real-world-auth-domain-pack-${app.name}`),
    );

    expect(pack.coverageMatrix.denominator).toBe(6);
    // Capabilities that require a fixture are honestly fixture-blocked on every app:
    expect(workflow(pack, 'authentication.reset-request')).toMatchObject({
      outcome: 'blocked',
      diagnostics: [{ code: 'ARXIC-AUTH-FIXTURE-UNAVAILABLE' }],
    });
    expect(workflow(pack, 'authentication.reset-complete')).toMatchObject({
      outcome: 'blocked',
      diagnostics: [{ code: 'ARXIC-AUTH-FIXTURE-UNAVAILABLE' }],
    });

    // Expected verified count is derived independently from the observed surface — not
    // from the candidate builder under test — so a builder regression (e.g. login no
    // longer generated) is caught. A capability verifies iff it is supported and needs
    // no fixture: login and logout always verify; password-change only when supported.
    const expectedVerified = 2 + (app.authSurface.passwordChange.supported ? 1 : 0);
    for (const candidate of candidates) {
      const result = workflow(pack, candidate.workflow.id);
      if (candidate.capabilityBlocker) {
        expect(result.outcome).toBe('blocked');
        expect(result.diagnostics[0]?.code).toBe('ARXIC-AUTH-CAPABILITY-UNSUPPORTED');
      } else if (candidate.fixtureBlocker) {
        expect(result.outcome).toBe('blocked');
        expect(result.diagnostics[0]?.code).toBe('ARXIC-AUTH-FIXTURE-UNAVAILABLE');
      } else {
        expect(result.outcome).toBe('verified');
      }
    }
    // The over-fit is gone: a structurally different app no longer yields contradictions
    // that hide missing capabilities — every disposition is verified or honestly blocked.
    expect(pack.manifest).toMatchObject({
      verified: expectedVerified,
      contradicted: 0,
    });
    expect(pack.workflows.every((result) => result.outcome === 'verified' || !result.bundle)).toBe(
      true,
    );

    expect(
      pack.coverageMatrix.rows.filter(({ outcome }) => outcome === 'blocked'),
    ).not.toHaveLength(0);
    const manifest = JSON.parse(
      await readFile(join(outputDirectory, 'domain-manifest.json'), 'utf8'),
    ) as { domain?: string; workflowCount?: number };
    const matrix = JSON.parse(
      await readFile(join(outputDirectory, 'coverage-matrix.json'), 'utf8'),
    ) as { denominator?: number; rows?: unknown[] };
    expect(manifest).toMatchObject({ domain: 'authentication', workflowCount: 6 });
    expect(matrix).toMatchObject({ denominator: 6 });
    expect(matrix.rows).toHaveLength(6);
  }, 300_000);
});

function workflow(pack: Awaited<ReturnType<AuthDomainPackAssembler['assemble']>>, id: string) {
  const result = pack.workflows.find((item) => item.id === id);
  if (!result) throw new Error(`Missing workflow ${id}`);
  return result;
}
