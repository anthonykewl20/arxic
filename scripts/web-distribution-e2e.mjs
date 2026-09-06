import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Public installed-command seam. Package preparation stays outside this assertion. */
const installedBin = await realpath(process.argv[2]);
const installedCwd = await realpath(process.argv[3]);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(
  relative(repository, installedBin).startsWith(`..${sep}`),
  'Use an installed binary outside the repository',
);
const env = {
  ...process.env,
  ARXIC_WEB_ROOTS: JSON.stringify([installedCwd]),
  ARXIC_WEB_PORT: '0',
};
for (const key of Object.keys(env)) {
  if (key.startsWith('ARXIC_') && !['ARXIC_WEB_ROOTS', 'ARXIC_WEB_PORT'].includes(key))
    delete env[key];
}
delete env.NODE_PATH;
const result = spawnSync(process.execPath, [installedBin, 'web'], {
  cwd: installedCwd,
  env,
  encoding: 'utf8',
  timeout: 15_000,
  maxBuffer: 2 * 1024 * 1024,
});
assert.equal(result.error, undefined, 'Missing-token refusal must terminate promptly');
assert.notEqual(result.status, 0, 'Missing administrator token must refuse server startup');
assert.match(
  result.stdout + result.stderr,
  /ARXIC_ADMIN_TOKEN must have at least 32 characters/u,
  'The installed web command must reach the server credential gate',
);
console.log('Installed web command: missing administrator token refused');

// A missing packaged asset directory must refuse startup, even with valid credentials.
const { rename, rm } = await import('node:fs/promises');
const { join } = await import('node:path');
const assets = join(dirname(installedBin), 'web-assets');
let moved = false;
try {
  try {
    await rename(assets, `${assets}.test-backup`);
    moved = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const missing = spawnSync(process.execPath, [installedBin, 'web'], {
    cwd: installedCwd,
    env: {
      ...env,
      ARXIC_ADMIN_TOKEN: 'packed-web-proof-token-at-least-32-characters',
      ARXIC_WEB_STATE_DIR: join(installedCwd, 'missing-assets-state'),
    },
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(missing.error, undefined, 'Missing assets must refuse startup promptly');
  assert.notEqual(missing.status, 0);
  assert.match(missing.stdout + missing.stderr, /Packaged web assets are missing or invalid/u);
  assert.doesNotMatch(missing.stdout, /Arxic workbench:/u);
  console.log('Installed web command: missing packaged assets refused before readiness');
} finally {
  if (moved) await rename(`${assets}.test-backup`, assets);
  await rm(join(installedCwd, 'missing-assets-state'), { recursive: true, force: true });
}

const { readFile, writeFile } = await import('node:fs/promises');
const token = 'packed-web-proof-token-at-least-32-characters';
const stateDirectory = join(installedCwd, 'packed-web-state');
const validEnv = { ...env, ARXIC_ADMIN_TOKEN: token, ARXIC_WEB_STATE_DIR: stateDirectory };
function assertRefused(overrides, expected) {
  const result = spawnSync(process.execPath, [installedBin, 'web'], {
    cwd: installedCwd,
    env: { ...validEnv, ...overrides },
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, 'Invalid configuration must terminate promptly');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, expected);
  assert.doesNotMatch(result.stdout, /Arxic workbench:/u);
}
assertRefused({ ARXIC_WEB_ROOTS: 'not-json' }, /ARXIC_WEB_ROOTS must be/u);
assertRefused({ ARXIC_WEB_ROOTS: '["."]' }, /ARXIC_WEB_ROOTS must be/u);
assertRefused({ ARXIC_WEB_PORT: '-1' }, /Invalid ARXIC_WEB_PORT/u);
assertRefused({ ARXIC_WEB_HOST: '0.0.0.0' }, /explicit HTTPS public origin/u);
assertRefused(
  { ARXIC_WEB_PUBLIC_ORIGIN: 'https://example.test/path' },
  /Public origin must not contain/u,
);
for (const file of [join(assets, 'app.js'), join(dirname(installedBin), 'web-job.js')]) {
  const bytes = await readFile(file);
  try {
    await writeFile(file, Buffer.concat([bytes, Buffer.from('\n// corruption probe\n')]));
    assertRefused({}, /Packaged web assets are missing or invalid/u);
  } finally {
    await writeFile(file, bytes);
  }
}
console.log('Installed web command: invalid configuration and corrupt asset/job refused');

const { startInstalledWeb } = await import('./installed-web-runtime.mjs');
let app;
try {
  app = await startInstalledWeb({ binary: installedBin, env: validEnv });
  const html = await (await fetch(app.origin)).text();
  assert.doesNotMatch(html, /__ASSET_VERSION__/u);
  for (const asset of ['app.js', 'app.css']) {
    const reference = html.match(new RegExp(`/${asset.replace('.', '\\.')}\\?v=[a-f0-9]{16}`, 'u'));
    assert.ok(reference, `HTML must reference versioned ${asset}`);
    const response = await fetch(app.origin + reference[0]);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /immutable/u);
    assert.ok((await response.arrayBuffer()).byteLength > 100);
  }
  assert.equal((await fetch(app.origin + '/api/state')).status, 401);
  async function login() {
    const response = await fetch(app.origin + '/api/session', {
      method: 'POST',
      headers: { origin: app.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  const cookie = await login();
  const policy = { enabled: false, maxAgeDays: 17, keepLatest: 7 };
  const saved = await fetch(app.origin + '/api/retention', {
    method: 'POST',
    headers: { cookie, origin: app.origin, 'content-type': 'application/json' },
    body: JSON.stringify(policy),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).policy, policy);
  await app.close();
  app = await startInstalledWeb({ binary: installedBin, env: validEnv });
  assert.equal((await fetch(app.origin + '/api/state', { headers: { cookie } })).status, 401);
  const renewed = await login();
  const restored = await fetch(app.origin + '/api/retention', { headers: { cookie: renewed } });
  assert.equal(restored.status, 200);
  assert.deepEqual((await restored.json()).policy, policy);
  console.log(
    'Installed web command: serves packaged assets; restart retains policy and requires new session',
  );
} finally {
  await app?.close();
  await rm(stateDirectory, { recursive: true, force: true });
}
