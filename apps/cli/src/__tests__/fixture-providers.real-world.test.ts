import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { expect, it } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { runCli } from '../cli';
import { VALID_CONFIG } from './fixtures';

it('refuses unknown fixture adapters before contacting a running reference app', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'fixture-provider-validation');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-fixture-provider-validation-'));
  let requests = 0;
  const proxy = createServer(async (request, response) => {
    requests++;
    const upstream = await fetch(`${target.origin}${request.url ?? '/'}`);
    response.statusCode = upstream.status;
    response.end(await upstream.text());
  });
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
  try {
    const page = await fetch(origin);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Login');
    requests = 0;
    for (const field of ['inbox', 'otp', 'personaProvisioner']) {
      const supplied = 'unsupported-provider-private-canary';
      const path = join(directory, `${field}.yaml`);
      await writeFile(
        path,
        stringify({
          ...VALID_CONFIG,
          source: {
            ...VALID_CONFIG.source,
            repository: join(root, 'test-fixtures/vulnerable-auth-app'),
          },
          target: { ...VALID_CONFIG.target, origin, allowedOrigins: [origin] },
          fixtures: { ...VALID_CONFIG.fixtures, [field]: supplied },
        }),
      );
      const messages: string[] = [];
      const output = { write: (message: string) => messages.push(message) };
      const result = await runCli(['run', '--config', path, '--out', join(directory, 'runs')], {
        cwd: root,
        stdout: output,
        stderr: output,
      });
      expect(result).toEqual({ exitCode: 2 });
      expect(messages.join('\n')).toContain(`config.fixtures.${field}`);
      expect(messages.join('\n')).not.toContain(supplied);
      expect(requests).toBe(0);
    }
  } finally {
    proxy.closeAllConnections();
    await new Promise<void>((done) => proxy.close(() => done()));
    await stopApp(target.child);
    await rm(target.runtimeDirectory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
