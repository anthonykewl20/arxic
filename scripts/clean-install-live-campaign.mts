/**
 * Clean-install fresh live-provider campaign acceptance (refs #546, refs #402).
 *
 * The packed-distribution proof and the paid-inference proof each exist, but
 * they have never been proven TOGETHER. This runner closes exactly that gap:
 * a packed tarball of the current head, clean-room-installed into an empty
 * directory, whose live provider is configured through the PRODUCT SURFACE
 * (`POST /api/provider-secrets` — the Models & accounts path) rather than a
 * server environment variable or the developer workbench's own SQLite, driving
 * one bounded real campaign to the engine's own outcome.
 *
 * Sad path first (charter §4): with no provider credential configured, the same
 * campaign on the same discovery must refuse or block honestly. Only then is
 * the credential pasted in and the happy path run.
 *
 * The funded credential is read in-process from the operator's live workbench
 * store, POSTed once into the clean install, and never printed, logged or
 * retained. Only its SHA-256 fingerprint prefix appears anywhere.
 */
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const workspaceModule = (path: string) => pathToFileURL(join(root, path)).href;
const CONNECTION = 'glm-coding';
const CREDENTIAL_REF = 'ARXIC_SECRET_GLM_CODING_KEY';
const MODEL = 'glm-4.7';
const BUDGET_USD = 0.025;
const ADMIN_TOKEN = `clean-install-live-${randomUUID().replaceAll('-', '')}`;
const PERSONA = {
  email: 'clean-install-live@example.test',
  password: 'CleanInstallLive9!',
  newPassword: 'CleanInstallLiveReplacement9!',
};

const steps: Array<{ step: string; observed: string }> = [];
const record = (step: string, observed: string) => {
  steps.push({ step, observed });
  console.log(`[${steps.length}] ${step} — ${observed}`);
};

/** Read the funded key from the operator's live store. Value never leaves this scope. */
async function fundedCredential(): Promise<{ value: string; fingerprint: string }> {
  const Database = (
    await import(workspaceModule('apps/web/node_modules/better-sqlite3/lib/index.js'))
  ).default as typeof import('better-sqlite3');
  const stateDirectory = process.env.ARXIC_WEB_STATE_DIR ?? join(homedir(), '.arxic', 'web');
  const live = new Database(join(stateDirectory, 'workbench.sqlite'), { readonly: true });
  try {
    const row = live
      .prepare('SELECT value FROM provider_secrets WHERE ref = ?')
      .get(CREDENTIAL_REF) as { value: string } | undefined;
    if (!row?.value)
      throw new Error(`Funded credential ${CREDENTIAL_REF} not present in the live store`);
    return {
      value: row.value,
      fingerprint: createHash('sha256').update(row.value).digest('hex').slice(0, 12),
    };
  } finally {
    live.close();
  }
}

/** Bounded poll over the product surface; never waits on a predicate becoming passing. */
async function pollRun(api: Api, id: string, timeoutMs = 900_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await api.get(`/runs/${id}`);
    if (run.state !== 'queued' && run.state !== 'running') return run;
    if (Date.now() > deadline) throw new Error(`Run ${id} did not settle within ${timeoutMs}ms`);
    await new Promise((done) => setTimeout(done, 2000));
  }
}

type Api = {
  get: (path: string) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  send: (path: string, method: string, body?: unknown) => Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/** Cookie-session client against the INSTALLED server — the same surface the dashboard uses. */
async function signIn(origin: string): Promise<Api> {
  // The server requires a same-origin `Origin` header on every non-GET request
  // (server.ts:85-87 — a CSRF guard). A browser sends it automatically; this
  // client is driving the same surface, so it must send it too.
  const opened = await fetch(`${origin}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ token: ADMIN_TOKEN }),
  });
  if (!opened.ok) throw new Error(`Sign-in returned ${opened.status}`);
  const cookie = (opened.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  if (!cookie.startsWith('arxic_session=')) throw new Error('Sign-in did not set a session cookie');
  const send = async (path: string, method: string, body?: unknown) => {
    const response = await fetch(`${origin}/api${path}`, {
      method,
      headers: {
        cookie,
        ...(method === 'GET' || method === 'HEAD' ? {} : { origin }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  return {
    send,
    get: async (path: string) => {
      const { status, body } = await send(path, 'GET');
      if (status !== 200) throw new Error(`GET ${path} returned ${status}`);
      return body;
    },
  };
}

const credential = await fundedCredential();
record(
  'funded credential located in the live store',
  `${CREDENTIAL_REF} fingerprint ${credential.fingerprint}`,
);

const clean = await mkdtemp(join(tmpdir(), 'arxic-clean-install-live-'));
const paths = {
  home: join(clean, 'home'),
  install: join(clean, 'install'),
  tarballs: join(clean, 'tarballs'),
  state: join(clean, 'state'),
};
await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));
const cleanEnv = {
  ...process.env,
  HOME: paths.home,
  USERPROFILE: paths.home,
  npm_config_yes: 'true',
};
// The provider credential must reach the install ONLY through the product
// surface, so it is stripped from the environment the server inherits.
delete cleanEnv[CREDENTIAL_REF];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let server: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let repo: any;
try {
  await exec('npm', ['pack', '--pack-destination', paths.tarballs], {
    cwd: join(root, 'apps', 'cli'),
    env: cleanEnv,
  });
  const tarballs = (await readdir(paths.tarballs)).filter((file) => file.endsWith('.tgz'));
  if (tarballs.length !== 1) throw new Error('npm pack did not create exactly one CLI tarball');
  await exec('npm', ['install', '--no-package-lock', join(paths.tarballs, tarballs[0]!)], {
    cwd: paths.install,
    env: cleanEnv,
  });
  // Stage 5 (bounded-discovery) drives a real browser against the target. The
  // clean room has its own HOME, so the host's browser cache is not visible and
  // the browser must be provisioned inside it — the same step
  // scripts/human-flow-e2e.mjs runs after its clean-room install. Scope declares
  // chromium only, so only chromium is fetched.
  await exec('npx', ['--yes', '--package=playwright@1.62.1', 'playwright', 'install', 'chromium'], {
    cwd: paths.install,
    env: cleanEnv,
  });
  record(
    'packed tarball clean-room installed',
    `${tarballs[0]} into an empty install directory, chromium provisioned in-room`,
  );

  const { bootFixtureApp, referenceAuthApp, seedFixture } = await import(
    workspaceModule('packages/real-world-testkit/src/index.ts')
  );
  app = await bootFixtureApp(root, referenceAuthApp, 'clean-install-live');
  await seedFixture(app.origin, 'clean-install-live', PERSONA);
  repo = await (
    await import(workspaceModule('packages/source-ua-adapter/src/__tests__/test-repo.ts'))
  ).makeRepository('reference-auth-app');
  record('real target booted and persona seeded', `reference-auth-app at ${app.origin}`);

  const { startInstalledWeb } = await import(workspaceModule('scripts/installed-web-runtime.mjs'));
  server = await startInstalledWeb({
    binary: join(paths.install, 'node_modules/arxic/dist/cli.js'),
    env: {
      ...cleanEnv,
      ARXIC_ADMIN_TOKEN: ADMIN_TOKEN,
      ARXIC_WEB_ROOTS: JSON.stringify([repo.root]),
      ARXIC_WEB_STATE_DIR: paths.state,
      ARXIC_WEB_PORT: '0',
      ARXIC_WEB_HOST: '127.0.0.1',
      // Persona secrets are server-env by design (the product's own documented
      // mechanism); the PROVIDER credential deliberately is not.
      ARXIC_SECRET_CLEAN_LIVE_EMAIL: PERSONA.email,
      ARXIC_SECRET_CLEAN_LIVE_PASSWORD: PERSONA.password,
    },
  });
  record('installed server started', `packed arxic web on ${server.origin}, empty per-run sqlite`);

  const api = await signIn(server.origin);
  const project = (
    await api.send('/projects', 'POST', {
      name: 'Clean install live campaign',
      folder: repo.root,
      origin: app.origin,
      execution: {
        model: MODEL,
        modelConnection: CONNECTION,
        modelBudgetUsd: BUDGET_USD,
        frameworks: ['nextjs'],
        domains: ['authentication'],
        persona: {
          mode: 'per-pass-login',
          emailRef: 'ARXIC_SECRET_CLEAN_LIVE_EMAIL',
          passwordRef: 'ARXIC_SECRET_CLEAN_LIVE_PASSWORD',
          loginPath: '/login',
          emailLabel: 'Email',
          passwordLabel: 'Password',
          submitLabel: 'Login',
        },
      },
    })
  ).body;
  if (!project?.id) throw new Error('Project creation did not return an id');
  record(
    'project created through the product surface',
    `connection ${CONNECTION}, model ${MODEL}, budget $${BUDGET_USD}`,
  );

  const discovery = (await api.send(`/projects/${project.id}/runs`, 'POST', { mode: 'discovery' }))
    .body;
  const discovered = await pollRun(api, discovery.id);
  if (discovered.state !== 'completed')
    throw new Error(`Discovery did not complete: ${discovered.state}`);
  const { campaignRows } = await import(workspaceModule('apps/web/src/campaigns.ts'));
  const loginRow = campaignRows(discovered.result.inventory).find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (row: any) => row.method === 'GET' && row.path === '/login' && row.inventoryRowId,
  );
  if (!loginRow?.inventoryRowId) throw new Error('GET /login row missing from discovery');
  record(
    'discovery completed on the installed server',
    `GET /login row ${loginRow.inventoryRowId.slice(0, 8)}…`,
  );

  // --- SAD PATH FIRST: no provider credential configured ---------------------
  const unconfigured = await api.send(`/projects/${project.id}/campaigns`, 'POST', {
    discoveryRunId: discovery.id,
    inventoryRowIds: [loginRow.inventoryRowId],
  });
  let sadPath: { kind: string; detail: string };
  if (unconfigured.status >= 400) {
    sadPath = { kind: 'refused-at-launch', detail: `HTTP ${unconfigured.status}` };
  } else {
    const blockedRun = await pollRun(api, unconfigured.body.runIds[0]);
    if (blockedRun.state === 'completed' && blockedRun.result?.outcome === 'verified')
      throw new Error('Campaign reached verified with NO provider credential configured');
    sadPath = {
      kind: 'blocked-at-execution',
      detail: `${blockedRun.state}/${blockedRun.result?.outcome ?? 'no-outcome'}`,
    };
  }
  record('sad path proven with no credential configured', `${sadPath.kind} (${sadPath.detail})`);

  // --- Configure the LIVE provider through the product surface ---------------
  const configured = await api.send('/provider-secrets', 'POST', {
    connection: CONNECTION,
    value: credential.value,
  });
  if (configured.status !== 201)
    throw new Error(`Provider-secret configuration returned ${configured.status}`);
  record(
    'live provider configured through the product surface',
    `POST /api/provider-secrets connection=${CONNECTION} (value withheld)`,
  );

  // --- Happy path: one bounded real campaign ---------------------------------
  const campaign = (
    await api.send(`/projects/${project.id}/campaigns`, 'POST', {
      discoveryRunId: discovery.id,
      inventoryRowIds: [loginRow.inventoryRowId],
    })
  ).body;
  const run = await pollRun(api, campaign.runIds[0]);
  record('campaign settled', `${run.state} / ${run.result?.outcome ?? 'no-outcome'}`);

  // Retain the engine's own artifacts before the clean room is removed. The
  // first attempt at this runner deleted them on failure and left the stage-5
  // block undiagnosable; a failing run is exactly when they are needed.
  const engineDirectory = join(paths.state, 'runs', run.id, 'engine');
  const engineArtifacts: Record<string, unknown> = {};
  for (const file of ['run.json', 'intents.json', 'diagnostics.json']) {
    try {
      engineArtifacts[file] = JSON.parse(await readFile(join(engineDirectory, file), 'utf8'));
    } catch {
      engineArtifacts[file] = null;
    }
  }

  const redact = (key: string, value: unknown) =>
    typeof value === 'string' &&
    (value === credential.value ||
      value === PERSONA.password ||
      value === PERSONA.newPassword ||
      value === ADMIN_TOKEN)
      ? '<redacted>'
      : value;
  const evidence = join(root, 'docs/evidence/WEB-402-CLEAN-INSTALL-LIVE');
  await mkdir(evidence, { recursive: true });
  const payload = {
    schemaVersion: 1,
    issue: 546,
    capturedAt: new Date().toISOString(),
    sourceCommit: (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim(),
    provider: {
      connection: CONNECTION,
      credentialRef: CREDENTIAL_REF,
      fingerprint: credential.fingerprint,
      configuredThrough: 'POST /api/provider-secrets (product surface)',
      serverEnvironmentCarriedCredential: false,
    },
    model: MODEL,
    modelBudgetUsd: BUDGET_USD,
    installation: { packedTarball: true, cleanRoom: true, inheritedState: false },
    sadPath,
    steps,
    run: { id: run.id, state: run.state },
    result: run.result,
    engineArtifacts,
  };
  const bytes = JSON.stringify(payload, redact, 2);
  if (bytes.includes(credential.value))
    throw new Error('Credential survived redaction — refusing to retain');
  await writeFile(join(evidence, 'campaign-record.json'), bytes, { mode: 0o600 });
  await writeFile(
    join(evidence, 'campaign-record.sanitization.json'),
    JSON.stringify(
      {
        sha256: createHash('sha256').update(bytes).digest('hex'),
        method:
          'exact-value replacement of the provider credential, persona passwords and the administrator token',
        retained: 'campaign record, step observations, engine outcome',
        neverRetained:
          'provider credential value, raw traces, persona passwords, administrator token',
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  record(
    'sanitized evidence retained',
    join('docs/evidence/WEB-402-CLEAN-INSTALL-LIVE', 'campaign-record.json'),
  );

  console.log(
    JSON.stringify(
      {
        outcome: run.result?.outcome ?? null,
        state: run.state,
        sadPath: sadPath.kind,
        fingerprint: credential.fingerprint,
      },
      null,
      2,
    ),
  );
  if (run.result?.outcome !== 'verified')
    throw new Error(`Campaign outcome ${run.result?.outcome ?? 'none'} — acceptance 4 not met`);
} finally {
  await server?.close?.();
  if (app) {
    const { stopApp } = await import(workspaceModule('packages/real-world-testkit/src/index.ts'));
    await stopApp(app.child);
  }
  if (repo?.root) await rm(repo.root, { recursive: true, force: true });
  await rm(clean, { recursive: true, force: true });
}
