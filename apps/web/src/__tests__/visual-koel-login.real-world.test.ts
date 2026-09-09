import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { Workbench } from '../workbench';

const exec = promisify(execFile);

/**
 * Real-world browser login proof against the local rehearsal koel (refs #402,
 * #538): the third-party clone and rehearsal image are LOCAL-ONLY (never
 * committed), so CI skips this suite unless ARXIC_KOEL_LOGIN_REQUIRED=1 makes
 * missing prerequisites a hard failure. The app boots in docker on an
 * ephemeral port with a per-run fresh sqlite — the shared corpus database is
 * never mounted and never written.
 */
const THIRD_PARTY_ROOT =
  process.env.ARXIC_VISUAL_THIRD_PARTY ?? '/home/soultransit/devtony/thirdparty-dg';
const KOEL_ROOT = join(THIRD_PARTY_ROOT, 'koel');
const KOEL_IMAGE = 'koel-php83:rehearsal';
// koel's upstream first-admin seed constants (public OSS defaults, not Arxic
// secrets); they flow through the engine's ARXIC_SECRET_* server variables.
const KOEL_ADMIN_EMAIL = 'admin@koel.dev';
const KOEL_ADMIN_PASSWORD = 'KoelIsCool';

async function missingPrerequisite(): Promise<string | null> {
  try {
    await exec('docker', ['image', 'inspect', KOEL_IMAGE], { timeout: 30_000 });
  } catch {
    return `docker image ${KOEL_IMAGE} is unavailable`;
  }
  for (const required of [
    KOEL_ROOT,
    join(KOEL_ROOT, '.env'),
    join(KOEL_ROOT, 'vendor'),
    join(KOEL_ROOT, 'public/build/manifest.json'),
  ])
    try {
      await access(required);
    } catch {
      return `koel rehearsal clone is incomplete: ${required} missing`;
    }
  return null;
}

async function bootKoel(): Promise<{ origin: string; stop: () => Promise<void> }> {
  const data = await mkdtemp(join(tmpdir(), 'koel-login-538-data-'));
  await writeFile(join(data, 'koel.sqlite'), '');
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  const dockerBase = [
    'run',
    '--rm',
    '-u',
    `${uid}:${gid}`,
    '-e',
    'HOME=/tmp',
    '-v',
    `${KOEL_ROOT}:/var/www/koel`,
    '-v',
    `${data}:/data`,
    '-w',
    '/var/www/koel',
    KOEL_IMAGE,
  ];
  // koel:init migrates the fresh sqlite and seeds the first admin; its final
  // scheduler step fails inside the container, so only the admin outcome is
  // asserted here and the credential proof below decides boot success.
  await exec(
    'docker',
    [...dockerBase, 'php', 'artisan', 'koel:init', '--no-interaction', '--no-assets'],
    { timeout: 240_000 },
  ).catch((error: { stdout?: string }) => {
    if (!error.stdout?.includes('Creating default admin account'))
      throw new Error(`koel:init did not seed the first admin account: ${error.stdout ?? error}`);
  });
  const container = `koel-login-538-${randomUUID().slice(0, 8)}`;
  await exec(
    'docker',
    [
      'run',
      '-d',
      '--name',
      container,
      '-u',
      `${uid}:${gid}`,
      '-e',
      'HOME=/tmp',
      '-p',
      '127.0.0.1::8123',
      '-v',
      `${KOEL_ROOT}:/var/www/koel`,
      '-v',
      `${data}:/data`,
      '-w',
      '/var/www/koel',
      KOEL_IMAGE,
      'php',
      'artisan',
      'serve',
      '--host=0.0.0.0',
      '--port=8123',
    ],
    { timeout: 60_000 },
  );
  const stop = async () => {
    await exec('docker', ['stop', '-t', '5', container], { timeout: 30_000 }).catch(() => {});
    await exec('docker', ['rm', '-f', container], { timeout: 30_000 }).catch(() => {});
    await rm(data, { recursive: true, force: true });
  };
  try {
    const portListing = (await exec('docker', ['port', container, '8123/tcp'], { timeout: 30_000 }))
      .stdout;
    const port = portListing.trim().split('\n')[0]!.replace(/^.*:/u, '');
    const origin = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        const health = await fetch(`${origin}/`);
        if (health.ok) break;
      } catch {
        /* container still starting */
      }
      if (Date.now() > deadline) throw new Error('koel rehearsal never became healthy');
      await new Promise((wait) => setTimeout(wait, 1_000));
    }
    const login = await fetch(`${origin}/api/me`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: KOEL_ADMIN_EMAIL, password: KOEL_ADMIN_PASSWORD }),
    });
    expect(await login.json()).toMatchObject({ token: expect.any(String) });
    return { origin, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

it('classifies a wrong koel password as a blocked sign-in, then captures the real authenticated koel shell with an identity mask', async (ctx) => {
  const missing = await missingPrerequisite();
  if (missing) {
    if (process.env.ARXIC_KOEL_LOGIN_REQUIRED === '1') throw new Error(missing);
    ctx.skip();
    return;
  }
  const root = resolve(import.meta.dirname, '../../../..');
  const koel = await bootKoel();
  const state = await mkdtemp(join(tmpdir(), 'koel-login-538-state-'));
  const wb = await Workbench.open(state, [root]);
  try {
    // Sad path first (refs #502 semantics): a real engine attempt with a
    // wrong password must classify the run blocked with the retained
    // observed failure, exactly one bounded sign-in attempt, and no secret
    // material in the retained evidence.
    process.env.ARXIC_SECRET_KOEL_EMAIL = KOEL_ADMIN_EMAIL;
    process.env.ARXIC_SECRET_KOEL_PASSWORD = 'definitely-not-the-password';
    const project = await wb.saveProject({
      name: 'Koel authenticated shell',
      folder: join(root, 'test-fixtures/reference-auth-app'),
      origin: koel.origin,
      captureConsent: true,
      paths: ['/'],
      viewports: [{ width: 800, height: 600 }],
      masks: ['[data-testid="profile-dropdown-trigger"]'],
      login: {
        loginPath: '/',
        emailRef: 'ARXIC_SECRET_KOEL_EMAIL',
        passwordRef: 'ARXIC_SECRET_KOEL_PASSWORD',
        emailLabel: 'Email',
        passwordLabel: 'Password',
        submitLabel: 'Log In',
        // koel's login form is placeholder-only: no <label> elements and an
        // email input of type text, so the operator declares the live
        // placeholders alongside the labels.
        emailPlaceholder: 'Your email address',
        passwordPlaceholder: 'Your password',
      },
    });
    const sad = wb.enqueue(project.id, 'visual');
    await wb.idle();
    const sadResult = wb.store.run(sad.id)?.result;
    expect(sadResult).toMatchObject({
      outcome: 'blocked',
      findings: [{ path: '/', kind: 'login-failed', count: 1 }],
    });
    expect(sadResult?.summary).toContain('Sign-in failed');
    const sadDirectory = join(state, 'runs', sad.id);
    const sadTimeline = await readFile(join(sadDirectory, 'timeline.json'), 'utf8');
    expect(sadTimeline.match(/"action":"sign-in-form"/gu)).toHaveLength(1);
    expect(sadTimeline).toContain('"result":"failed"');
    for (const secret of [KOEL_ADMIN_PASSWORD, 'definitely-not-the-password'])
      expect(sadTimeline).not.toContain(secret);

    // Happy path: real engine sign-in into the hash-routed SPA, then an
    // authenticated visual capture of the koel shell with the current-user
    // identity mask applied.
    process.env.ARXIC_SECRET_KOEL_PASSWORD = KOEL_ADMIN_PASSWORD;
    const run = wb.enqueue(project.id, 'visual');
    await wb.idle();
    const result = wb.store.run(run.id)!.result!;
    expect(result.outcome).toBe('observed');
    expect(result.captures).toHaveLength(1);
    expect(result.captures![0]).toMatchObject({ authenticated: true, status: 'needs-baseline' });
    const directory = join(state, 'runs', run.id);
    const privacy = JSON.parse(
      await readFile(join(directory, 'checkpoint-1.png.privacy.json'), 'utf8'),
    );
    expect(privacy).toMatchObject({
      authenticated: true,
      additionalMasks: ['[data-testid="profile-dropdown-trigger"]'],
      rawTraceRetained: false,
    });
    // AC-2: the resolution method against the live DOM is recorded — koel
    // has no labels, so the engine must report the placeholder/type path,
    // not claim label success.
    const timeline = await readFile(join(directory, 'timeline.json'), 'utf8');
    expect(timeline).toContain('sign-in-form');
    expect(timeline).toMatch(/fields by (placeholder|type)\/(placeholder|type)/u);
    expect(timeline).not.toMatch(/fields by label\/label/u);
    // No credential material anywhere in the retained run evidence.
    for (const file of await readdir(directory)) {
      if (!file.endsWith('.json')) continue;
      const bytes = await readFile(join(directory, file), 'utf8');
      for (const secret of [KOEL_ADMIN_EMAIL, KOEL_ADMIN_PASSWORD, 'definitely-not-the-password'])
        expect(bytes).not.toContain(secret);
    }
    expect((await readdir(directory)).some((file) => /webm|zip|storage|session/iu.test(file))).toBe(
      false,
    );
    const evidence = process.env.ARXIC_KOEL_LOGIN_EVIDENCE_DIR;
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      for (const file of await readdir(directory))
        await writeFile(join(evidence, file), await readFile(join(directory, file)));
      const blocked = join(evidence, 'blocked-run');
      await mkdir(blocked, { recursive: true });
      for (const file of await readdir(sadDirectory))
        await writeFile(join(blocked, file), await readFile(join(sadDirectory, file)));
    }
  } finally {
    await wb.close();
    await rm(state, { recursive: true, force: true });
    await koel.stop();
  }
}, 420_000);
