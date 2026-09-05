import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { subscriptionEnvironment, agentInvocation } from './model-agent-bridge.mjs';

const validId = /^[a-zA-Z0-9][a-zA-Z0-9._:/[\]-]{0,119}$/u;
const project = (ids) =>
  [...new Set(ids.filter((id) => typeof id === 'string' && validId.test(id)))].map((id) => ({
    id,
  }));

/** Metadata-only native handshake. Never sends an inference prompt or reads token caches. */
export async function discoverNativeModels(provider, inherited = process.env) {
  const cwd = await mkdtemp(join(tmpdir(), 'arxic-model-catalog-'));
  const agent = provider === 'opencode-go' ? 'opencode' : provider;
  const env = subscriptionEnvironment(agent, inherited);
  const command = env[`ARXIC_${agent.toUpperCase()}_COMMAND`] || agent;
  try {
    if (agent === 'opencode' || agent === 'openclaw') {
      const args =
        agent === 'opencode'
          ? [
              'models',
              ...(provider === 'opencode-go' ? ['opencode-go'] : []),
              '--refresh',
              '--pure',
            ]
          : [
              'models',
              'list',
              '--all',
              ...(env.ARXIC_MODEL_CATALOG_PROVIDER
                ? ['--provider', env.ARXIC_MODEL_CATALOG_PROVIDER]
                : []),
              '--agent',
              env.ARXIC_MODEL_GATEWAY_AGENT || 'arxic',
              '--json',
            ];
      const { stdout } = await promisify(execFile)(command, args, {
        cwd,
        env,
        timeout: 25_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return project(
        agent === 'opencode'
          ? stdout.split(/\r?\n/u).map((line) => line.trim())
          : JSON.parse(stdout).models.map((row) => row.key),
      );
    }
    if (!['codex', 'claude'].includes(agent))
      throw new Error('Native catalog discovery is not configured');
    return await new Promise((resolve, reject) => {
      const args =
        agent === 'codex'
          ? ['app-server']
          : agentInvocation('claude', '', '', []).args.slice(0, -2);
      const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });
      let settled = false;
      let buffer = '';
      let bytes = 0;
      const ids = [];
      const cursors = new Set();
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        if (error) reject(new Error('Native model catalog discovery failed'));
        else resolve(project(ids));
      };
      const timer = setTimeout(() => finish(true), 25_000);
      const send = (value) => child.stdin.write(JSON.stringify(value) + '\n');
      child.on('error', () => finish(true));
      child.stdin.on('error', () => finish(true));
      child.on('close', () => finish(true));
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 4 * 1024 * 1024) return finish(true);
        buffer += chunk;
        let end;
        while (!settled && (end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const message = JSON.parse(line);
            if (
              agent === 'claude' &&
              message.type === 'control_response' &&
              message.response?.request_id === 'catalog'
            ) {
              if (
                message.response.subtype !== 'success' ||
                !Array.isArray(message.response.response?.models)
              )
                return finish(true);
              ids.push(...message.response.response.models.map((row) => row.value));
              finish(false);
            } else if (agent === 'codex' && message.id === 1) {
              if (message.error) return finish(true);
              send({ method: 'initialized', params: {} });
              send({ id: 2, method: 'model/list', params: { limit: 100 } });
            } else if (agent === 'codex' && message.id === 2) {
              if (message.error || !Array.isArray(message.result?.data)) return finish(true);
              ids.push(...message.result.data.map((row) => row.model));
              const cursor = message.result.nextCursor;
              if (!cursor) return finish(false);
              if (cursors.has(cursor) || cursors.size >= 100) return finish(true);
              cursors.add(cursor);
              send({ id: 2, method: 'model/list', params: { limit: 100, cursor } });
            }
          } catch {
            finish(true);
          }
        }
      });
      send(
        agent === 'codex'
          ? {
              id: 1,
              method: 'initialize',
              params: { clientInfo: { name: 'arxic-model-catalog', version: '1' } },
            }
          : { type: 'control_request', request_id: 'catalog', request: { subtype: 'initialize' } },
      );
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(JSON.stringify(await discoverNativeModels(process.argv[2])));
  } catch {
    process.stderr.write(
      'Native model catalog discovery failed. Check the installed CLI and account connection.\n',
    );
    process.exitCode = 1;
  }
}
