import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  referenceAuthApp,
  seedFixture,
} from '../../../../packages/real-world-testkit/src';
import { Workbench } from '../workbench';

it('blocks missing credentials in every environment, then captures authenticated Next.js in all three browsers and both themes', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, referenceAuthApp, 'web-auth-capture');
  const state = await mkdtemp(join(tmpdir(), 'web-auth-capture-state-'));
  const wb = await Workbench.open(state, [root]);
  try {
    const persona = { email: 'visual-audit@example.test', password: 'VisualAuditOnly9!' };
    await seedFixture(target.origin, 'visual-audit', persona);
    vi.stubEnv('ARXIC_SECRET_VISUAL_EMAIL', '');
    vi.stubEnv('ARXIC_SECRET_VISUAL_PASSWORD', '');
    const project = await wb.saveProject({
      name: 'Authenticated reference',
      folder: join(root, 'test-fixtures/reference-auth-app'),
      origin: target.origin,
      captureConsent: true,
      paths: ['/'],
      viewports: [{ width: 800, height: 600 }],
      browsers: ['chromium', 'firefox', 'webkit'],
      colorSchemes: ['light', 'dark'],
      masks: ['[data-testid="session-state"]'],
      login: {
        loginPath: '/login',
        emailRef: 'ARXIC_SECRET_VISUAL_EMAIL',
        passwordRef: 'ARXIC_SECRET_VISUAL_PASSWORD',
        emailLabel: 'Email',
        passwordLabel: 'Password',
        submitLabel: 'Login',
      },
    });
    const missing = wb.enqueue(project.id, 'visual');
    await wb.idle();
    expect(wb.store.run(missing.id)?.result).toMatchObject({
      outcome: 'blocked',
      visualEnvironments: Array.from({ length: 6 }, () => ({ outcome: 'blocked', captures: 0 })),
    });
    vi.stubEnv('ARXIC_SECRET_VISUAL_EMAIL', persona.email);
    vi.stubEnv('ARXIC_SECRET_VISUAL_PASSWORD', persona.password);
    const run = wb.enqueue(project.id, 'visual');
    await wb.idle();
    const result = wb.store.run(run.id)!.result!;
    expect(result.outcome).toBe('observed');
    expect(result.captures).toHaveLength(6);
    expect(result.visualEnvironments).toHaveLength(6);
    expect(result.findings).toEqual([]);
    for (const capture of result.captures!)
      expect(capture).toMatchObject({ authenticated: true, status: 'needs-baseline' });
    const directory = join(state, 'runs', run.id);
    const files = await readdir(directory);
    expect(files.some((file) => /webm|zip|storage|session/iu.test(file))).toBe(false);
    const timeline = await readFile(join(directory, 'timeline.json'), 'utf8');
    expect(timeline).toContain('sign-in-form');
    for (const secret of [persona.email, persona.password]) expect(timeline).not.toContain(secret);
    const evidence = process.env.ARXIC_MATRIX_AUTH_EVIDENCE_DIR;
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await writeFile(
        join(evidence, 'proof-source.json'),
        JSON.stringify({
          sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
          dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
        }),
      );
      for (const file of files)
        await writeFile(join(evidence, file), await readFile(join(directory, file)));
    }
  } finally {
    vi.unstubAllEnvs();
    await wb.close();
    await stopApp(target.child);
    await rm(state, { recursive: true, force: true });
    await rm(target.runtimeDirectory, { recursive: true, force: true });
  }
}, 180_000);
