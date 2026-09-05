import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Workbench } from '../workbench';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

it('blocks a guided job with an unavailable secret reference and persists only reference names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arxic-web-execution-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const wb = await Workbench.open(join(root, 'state'), [root]);
  cleanups.push(() => wb.close());
  vi.stubEnv('ARXIC_SECRET_TEST_PASSWORD', '');
  vi.stubEnv('ARXIC_SECRET_TEST_EMAIL', 'test-account@example.test');
  const project = await wb.saveProject({
    name: 'Guided missing credential',
    folder: root,
    origin: 'http://127.0.0.1:1',
    execution: {
      model: 'test-provider',
      frameworks: ['nextjs'],
      domains: ['authentication'],
      persona: {
        mode: 'seed-api',
        emailRef: 'ARXIC_SECRET_TEST_EMAIL',
        passwordRef: 'ARXIC_SECRET_TEST_PASSWORD',
      },
    },
  });
  const run = wb.enqueue(project.id, 'agent');
  await wb.idle();
  expect(wb.store.run(run.id)).toMatchObject({
    state: 'blocked',
    result: { outcome: 'blocked', summary: expect.stringContaining('secret reference') },
  });
  expect(JSON.stringify(wb.state())).not.toContain('test-account@example.test');
  for (const entry of await readdir(join(root, 'state'), {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    expect(
      (await readFile(join(entry.parentPath, entry.name))).includes(
        Buffer.from('test-account@example.test'),
      ),
      entry.name,
    ).toBe(false);
  }
});

it.each([
  ['raw model credential', { modelSecretRef: 'raw-secret-value' }],
  ['administrator credential', { modelSecretRef: 'ARXIC_ADMIN_TOKEN' }],
  ['production target', { environmentClass: 'production' }],
  ['unbounded runtime', { maxRuntimeMinutes: 31 }],
  ['unbounded crawl', { maxUrls: 501 }],
  ['missing framework', { frameworks: [] }],
  ['unknown policy bypass', { requiredVerificationRuns: 0 }],
  [
    'anonymous persona with credentials',
    { persona: { mode: 'anonymous', emailRef: 'ARXIC_SECRET_TEST_EMAIL' } },
  ],
  [
    'cross-origin login',
    {
      persona: {
        mode: 'per-pass-login',
        emailRef: 'ARXIC_SECRET_TEST_EMAIL',
        passwordRef: 'ARXIC_SECRET_TEST_PASSWORD',
        loginPath: 'https://outside.example/login',
      },
    },
  ],
])('refuses %s before persisting a guided project', async (_name, override) => {
  const root = await mkdtemp(join(tmpdir(), 'arxic-web-execution-policy-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const wb = await Workbench.open(join(root, 'state'), [root]);
  cleanups.push(() => wb.close());
  await expect(
    wb.saveProject({
      name: 'Refused policy',
      folder: root,
      origin: 'http://127.0.0.1:1',
      execution: {
        model: 'test-provider',
        frameworks: ['nextjs'],
        domains: ['authentication'],
        ...override,
      },
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(wb.state().projects).toHaveLength(0);
});
