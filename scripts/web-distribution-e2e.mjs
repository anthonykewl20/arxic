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
