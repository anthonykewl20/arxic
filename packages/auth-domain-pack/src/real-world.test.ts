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

  test('assembles independent real Chromium auth results and explicit fixture blockers', async () => {
    if (!running) throw new Error(`Fixture app ${app.name} did not start`);
    const pack = await new AuthDomainPackAssembler({
      origin: running.origin,
      outputDirectory,
      artifactsDir: artifactsDirectory,
      persona: app.persona,
    }).assemble(
      authCandidates(),
      loginObservations(app, running.origin, `real-world-auth-domain-pack-${app.name}`),
    );

    expect(pack.coverageMatrix.denominator).toBe(6);
    expect(workflow(pack, 'authentication.reset-request')).toMatchObject({
      outcome: 'blocked',
      diagnostics: [{ code: 'ARXIC-AUTH-FIXTURE-UNAVAILABLE' }],
    });
    expect(workflow(pack, 'authentication.reset-complete')).toMatchObject({
      outcome: 'blocked',
      diagnostics: [{ code: 'ARXIC-AUTH-FIXTURE-UNAVAILABLE' }],
    });
    expect(workflow(pack, 'authentication.totp')).toMatchObject({
      outcome: 'blocked',
      diagnostics: [{ code: 'ARXIC-AUTH-FIXTURE-UNAVAILABLE' }],
    });

    if (app.name === 'reference-auth-app') {
      expect(workflow(pack, 'authentication.login').outcome).toBe('verified');
      expect(workflow(pack, 'authentication.logout').outcome).toBe('verified');
      expect(workflow(pack, 'authentication.password-change').outcome).toBe('verified');
      expect(pack.manifest).toMatchObject({ verified: 3, blocked: 3, contradicted: 0 });
      expect(
        pack.workflows.every((result) => result.outcome === 'verified' || !result.bundle),
      ).toBe(true);
    } else {
      expect(workflow(pack, 'authentication.login').outcome).toBe('contradicted');
      expect(workflow(pack, 'authentication.logout').outcome).toBe('contradicted');
      expect(workflow(pack, 'authentication.password-change').outcome).toBe('contradicted');
      expect(pack.manifest.verified ?? 0).toBe(0);
    }

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
