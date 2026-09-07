import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  bootFixtureApp,
  stopApp,
  referenceAuthApp,
  seedFixture,
} from '../../../../packages/real-world-testkit/src';
import { Workbench } from '../workbench';

it('blocks missing credentials in every environment, then captures authenticated Next.js in all three browsers, both themes and all native densities', async () => {
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
      deviceScaleFactors: [1, 2, 3],
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
      visualEnvironments: Array.from({ length: 18 }, () => ({ outcome: 'blocked', captures: 0 })),
    });
    vi.stubEnv('ARXIC_SECRET_VISUAL_EMAIL', persona.email);
    vi.stubEnv('ARXIC_SECRET_VISUAL_PASSWORD', persona.password);
    const run = wb.enqueue(project.id, 'visual');
    await wb.idle();
    const result = wb.store.run(run.id)!.result!;
    const directory = join(state, 'runs', run.id);
    const files = await readdir(directory);
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
    const safeSummary = {
      summary: result.summary,
      environments: result.visualEnvironments,
      captures: result.captures?.map((c) => ({ environment: c.environment, status: c.status })),
    };
    if (evidence)
      await writeFile(join(evidence, 'safe-summary.json'), JSON.stringify(safeSummary, null, 2));
    expect(result.outcome, JSON.stringify(safeSummary)).toBe('observed');
    expect(result.captures).toHaveLength(18);
    expect(result.visualEnvironments).toHaveLength(18);
    expect(result.findings).toEqual([]);
    for (const capture of result.captures!)
      expect(capture).toMatchObject({ authenticated: true, status: 'needs-baseline' });
    for (const capture of result.captures!) {
      const image = await sharp(join(directory, capture.file)).metadata();
      const density = capture.environment?.deviceScaleFactor ?? 1;
      expect([image.width, image.height]).toEqual([800 * density, 600 * density]);
    }
    expect(files.some((file) => /webm|zip|storage|session/iu.test(file))).toBe(false);
    const timeline = await readFile(join(directory, 'timeline.json'), 'utf8');
    expect(timeline).toContain('sign-in-form');
    for (const secret of [persona.email, persona.password]) expect(timeline).not.toContain(secret);
    const actions = JSON.parse(timeline) as Array<{ action: string }>;
    expect(actions.filter((step) => step.action === 'sign-in-form')).toHaveLength(3);
    expect(actions.filter((step) => step.action === 'reuse-browser-sign-in')).toHaveLength(15);
    vi.stubEnv('ARXIC_SECRET_VISUAL_PASSWORD', 'incorrect-for-the-next-run');
    const invalid = wb.enqueue(project.id, 'visual');
    await wb.idle();
    const invalidResult = wb.store.run(invalid.id)!.result!;
    expect(invalidResult.outcome).toBe('blocked');
    expect(invalidResult.captures).toHaveLength(0);
    expect(invalidResult.visualEnvironments).toHaveLength(18);
    expect(
      invalidResult.visualEnvironments!.every(
        (cell) => cell.outcome === 'blocked' && cell.captures === 0,
      ),
    ).toBe(true);
    if (evidence) {
      const invalidDirectory = join(evidence, 'next-run-refusal');
      await mkdir(invalidDirectory, { recursive: true });
      for (const file of ['timeline.json', 'timeline.sanitization.json'])
        await writeFile(
          join(invalidDirectory, file),
          await readFile(join(state, 'runs', invalid.id, file)),
        );
      await writeFile(
        join(invalidDirectory, 'safe-summary.json'),
        JSON.stringify(
          { outcome: invalidResult.outcome, environments: invalidResult.visualEnvironments },
          null,
          2,
        ),
      );
    }
  } finally {
    vi.unstubAllEnvs();
    await wb.close();
    await stopApp(target.child);
    await rm(state, { recursive: true, force: true });
    await rm(target.runtimeDirectory, { recursive: true, force: true });
  }
}, 180_000);
