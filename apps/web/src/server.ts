import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Workbench } from './workbench';
import { HttpError } from './errors';
import { readFile } from 'node:fs/promises';
import { ARXIC_VERSION, ARXIC_VERSION_LABEL, sha256 } from '@arxic/contracts';

export type WorkbenchOptions = {
  stateDirectory: string;
  roots: string[];
  adminToken: string;
  port?: number;
  host?: string;
  publicOrigin?: string;
};

export async function startWorkbench(options: WorkbenchOptions) {
  if (options.adminToken.length < 32)
    throw new Error('ARXIC_ADMIN_TOKEN must have at least 32 characters');
  const host = options.host ?? '127.0.0.1';
  if (options.publicOrigin && new URL(options.publicOrigin).origin !== options.publicOrigin)
    throw new Error('Public origin must not contain a path, query, credentials, or fragment');
  if (
    !['127.0.0.1', '::1', 'localhost'].includes(host) &&
    !options.publicOrigin?.startsWith('https://')
  ) {
    throw new Error(
      'Remote listening requires an explicit HTTPS public origin and TLS reverse proxy',
    );
  }
  const sessions = new Map<string, number>();
  const workbench = await Workbench.open(options.stateDirectory, options.roots);
  const attempts = new Map<string, { count: number; until: number }>();
  const hash = (value: string) => Buffer.from(sha256(value), 'hex');
  let origin = options.publicOrigin ?? '';
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    void handle(request, response).catch((error: unknown) => {
      if (!response.headersSent)
        json(response, error instanceof HttpError ? error.status : 500, {
          error: error instanceof HttpError ? error.message : 'Request could not be completed',
        });
      else response.end();
    });
  });
  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.headers.host !== new URL(origin).host)
      throw new HttpError(403, 'Unrecognized host');
    const path = new URL(request.url ?? '/', origin).pathname;
    const assets: Record<string, [string, string]> = {
      '/': ['index.html', 'text/html'],
      '/app.js': ['app.js', 'text/javascript'],
      '/html.js': ['html.js', 'text/javascript'],
      '/campaigns.js': ['campaigns.js', 'text/javascript'],
      '/app.css': ['app.css', 'text/css'],
      '/base.css': ['base.css', 'text/css'],
    };
    const asset = assets[path];
    if (asset && ['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
      response.end(await readFile(new URL(`../public/${asset[0]}`, import.meta.url)));
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      if (request.headers.origin !== origin)
        throw new HttpError(403, 'Same-origin request required');
      if (request.headers['content-type']?.split(';')[0] !== 'application/json')
        throw new HttpError(415, 'JSON request required');
    }
    if (path === '/api/session' && request.method === 'POST') {
      const address = request.socket.remoteAddress ?? 'unknown';
      const now = Date.now();
      for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
      const attempt = attempts.get(address) ?? { count: 0, until: now + 60_000 };
      if (attempt.count >= 20 || attempts.size >= 4096)
        throw new HttpError(429, 'Too many sign-in attempts; try again in a minute');
      attempts.set(address, { ...attempt, count: attempt.count + 1 });
      const body = await readJson(request);
      if (
        typeof body.token !== 'string' ||
        !timingSafeEqual(hash(body.token), hash(options.adminToken))
      )
        throw new HttpError(401, 'Invalid administrator token');
      for (const [key, until] of sessions) if (until <= now) sessions.delete(key);
      if (sessions.size >= 128) throw new HttpError(429, 'Too many active sessions');
      const token = randomBytes(32).toString('hex');
      sessions.set(hash(token).toString('hex'), now + 8 * 60 * 60_000);
      response.setHeader(
        'Set-Cookie',
        `arxic_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${origin.startsWith('https:') ? '; Secure' : ''}`,
      );
      return json(response, 200, { ok: true });
    }
    const session =
      request.headers.cookie
        ?.split(';')
        .map((value) => value.trim())
        .find((value) => value.startsWith('arxic_session='))
        ?.slice(14) ?? '';
    const sessionKey = hash(session).toString('hex');
    if ((sessions.get(sessionKey) ?? 0) <= Date.now())
      throw new HttpError(401, 'Sign in to continue');
    if (path === '/api/session' && request.method === 'DELETE') {
      sessions.delete(sessionKey);
      response.setHeader(
        'Set-Cookie',
        `arxic_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${origin.startsWith('https:') ? '; Secure' : ''}`,
      );
      return json(response, 200, { ok: true });
    }
    if (path === '/api/state' && request.method === 'GET')
      return json(response, 200, {
        ...workbench.state(),
        version: ARXIC_VERSION,
        versionLabel: ARXIC_VERSION_LABEL,
      });
    if (path === '/api/projects' && request.method === 'POST')
      return json(response, 201, await workbench.saveProject(await readJson(request)));
    const projectRoute = /^\/api\/projects\/([a-f0-9-]+)$/u.exec(path);
    if (projectRoute && request.method === 'PUT')
      return json(
        response,
        200,
        await workbench.saveProject(await readJson(request), projectRoute[1]),
      );
    const runRoute = /^\/api\/projects\/([a-f0-9-]+)\/runs$/u.exec(path);
    if (runRoute && request.method === 'POST')
      return json(response, 202, workbench.enqueue(runRoute[1], (await readJson(request)).mode));
    const campaignCreate = /^\/api\/projects\/([a-f0-9-]+)\/campaigns$/u.exec(path);
    if (campaignCreate && request.method === 'POST')
      return json(
        response,
        202,
        await workbench.enqueueCampaign(campaignCreate[1], await readJson(request)),
      );
    const campaignDetail = /^\/api\/campaigns\/([a-f0-9-]+)$/u.exec(path);
    if (campaignDetail && request.method === 'GET')
      return json(response, 200, workbench.campaign(campaignDetail[1]));
    const campaignCancel = /^\/api\/campaigns\/([a-f0-9-]+)\/cancel$/u.exec(path);
    if (campaignCancel && request.method === 'POST') {
      await workbench.cancelCampaign(campaignCancel[1]);
      return json(response, 200, { ok: true });
    }
    const cancelRoute = /^\/api\/runs\/([a-f0-9-]+)\/cancel$/u.exec(path);
    if (cancelRoute && request.method === 'POST') {
      await workbench.cancel(cancelRoute[1]);
      return json(response, 200, { ok: true });
    }
    const detailRoute = /^\/api\/runs\/([a-f0-9-]+)$/u.exec(path);
    if (detailRoute && request.method === 'GET') {
      const run = workbench.store.run(detailRoute[1]);
      if (!run) throw new HttpError(404, 'Run not found');
      return json(response, 200, run);
    }
    if (detailRoute && request.method === 'DELETE') {
      await workbench.deleteRun(detailRoute[1]);
      return json(response, 200, { ok: true });
    }
    const baselineRoute = /^\/api\/runs\/([a-f0-9-]+)\/baselines$/u.exec(path);
    if (baselineRoute && request.method === 'POST') {
      const body = await readJson(request);
      if (typeof body.captureId !== 'string') throw new HttpError(400, 'Capture ID required');
      await workbench.approveBaseline(baselineRoute[1], body.captureId);
      return json(response, 200, { ok: true });
    }
    const artifactRoute = /^\/api\/runs\/([a-f0-9-]+)\/artifacts\/([a-z0-9.-]+)$/u.exec(path);
    if (artifactRoute && request.method === 'GET') {
      const { bytes, type } = await workbench.artifact(artifactRoute[1], artifactRoute[2]);
      response.writeHead(200, { 'Content-Type': type });
      response.end(bytes);
      return;
    }
    throw new HttpError(404, 'Not found');
  }
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 4310, host, resolve);
    });
  } catch (error) {
    await workbench.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server address unavailable');
  origin ||= `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`;
  return {
    origin,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await workbench.close();
    },
  };
}

export async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 128 * 1024) throw new HttpError(413, 'Request exceeds 128 KiB');
    chunks.push(Buffer.from(chunk));
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new HttpError(400, 'JSON object required');
  return body as Record<string, unknown>;
}

export function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}
