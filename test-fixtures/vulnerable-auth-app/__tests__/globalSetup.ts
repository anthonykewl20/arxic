import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const delay = (milliseconds: number): Promise<void> => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function assertMailpit(api: string): Promise<void> {
  try {
    const response = await fetch(`${api}/api/v1/info`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.log(`[real-mailpit] reachable: ${api} (${response.status})`);
  } catch (error: unknown) {
    throw new Error(`Mailpit is not reachable at ${api}; start the real Mailpit fixture before testing`, { cause: error });
  }
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => server.once('exit', () => resolveExit())),
    delay(5_000),
  ]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const mailpitApi = process.env.ARXIC_MAILPIT_API || 'http://localhost:8025';
  await assertMailpit(mailpitApi);
  const port = process.env.PORT || '4011';
  const baseUrl = `http://localhost:${port}`;
  process.env.ARXIC_TEST_BASE_URL = baseUrl;
  process.env.ARXIC_TARGET_ORIGIN = baseUrl;
  process.env.ARXIC_DB_PATH ||= resolve('.vitest-auth.db');
  const server = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'src/server.ts'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[tsx] ${chunk.toString()}`));
  server.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[tsx] ${chunk.toString()}`));
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Express fixture exited before readiness (code ${server.exitCode})`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        console.log(`[real-express] ready: ${baseUrl} (${response.status})`);
        return () => stopServer(server);
      }
    } catch { /* readiness polling */ }
    await delay(250);
  }
  await stopServer(server);
  throw new Error(`Express fixture did not become ready at ${baseUrl} within 20 seconds`);
}
