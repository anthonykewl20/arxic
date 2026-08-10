import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ARXIC_SURFACE_EXTERNAL_ORIGIN,
  ARXIC_SURFACE_MUTATION_BLOCKED,
  CrawleeSurfaceDiscoverer,
} from '..';

const digest = 'd'.repeat(64);
let evidenceDirectory = '';
let retainEvidence = false;
let originServer: Server;
let externalServer: Server;
let origin = '';
let externalOrigin = '';
let mutationRequests = 0;
let externalRequests = 0;
let serviceWorkerScripts = 0;

describe('real Chromium Service Worker containment proof', () => {
  beforeAll(async () => {
    const configuredEvidenceDirectory = process.env.ARXIC_EVIDENCE_DIR?.trim();
    retainEvidence = Boolean(configuredEvidenceDirectory);
    evidenceDirectory = configuredEvidenceDirectory
      ? resolve(configuredEvidenceDirectory)
      : await mkdtemp(join(tmpdir(), 'arxic-service-workers-evidence-'));
    await mkdir(evidenceDirectory, { recursive: true });
    externalServer = createServer((_request, response) => {
      externalRequests += 1;
      response.setHeader('access-control-allow-origin', '*');
      response.end('external sink reached');
    });
    externalOrigin = await listen(externalServer);
    originServer = createServer((request, response) => {
      if (request.url === '/sw.js') {
        serviceWorkerScripts += 1;
        response.setHeader('content-type', 'application/javascript');
        response.setHeader('service-worker-allowed', '/');
        response.end(`
          self.addEventListener('install', () => self.skipWaiting());
          self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
          self.addEventListener('fetch', event => event.respondWith(fetch(event.request)));
        `);
        return;
      }
      if (request.url === '/mutate' && request.method === 'POST') {
        mutationRequests += 1;
        response.end('mutation sink reached');
        return;
      }
      response.setHeader('content-type', 'text/html');
      response.end(fixtureHtml(externalOrigin));
    });
    origin = await listen(originServer);
  });

  afterAll(async () => {
    await Promise.all([close(originServer), close(externalServer)]);
    if (!retainEvidence) await rm(evidenceDirectory, { recursive: true, force: true });
  });

  it('proves the hostile fixture performs both prohibited requests when Service Workers are allowed', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ serviceWorkers: 'allow' });
      const page = await context.newPage();
      await page.goto(origin);
      await page.evaluate(
        () => (window as unknown as { fixtureDone: Promise<string> }).fixtureDone,
      );
      await page.reload();
      await expect
        .poll(() => page.evaluate(() => document.querySelector('#status')?.textContent), {
          timeout: 10_000,
        })
        .toBe('active worker; prohibited requests attempted');
      await expect.poll(() => mutationRequests).toBeGreaterThan(0);
      await expect.poll(() => externalRequests).toBeGreaterThan(0);
      expect(serviceWorkerScripts).toBeGreaterThan(0);
      await context.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

  it('blocks registration, diagnoses both page-owned fallback probes, and leaves both sinks untouched', async () => {
    mutationRequests = 0;
    externalRequests = 0;
    serviceWorkerScripts = 0;

    const result = await new CrawleeSurfaceDiscoverer({
      maxConcurrency: 1,
      maxRequestRetries: 0,
    }).collect({ origin, appBuildDigest: digest, maxUrls: 1, maxDepth: 0 });
    expect(mutationRequests).toBe(0);
    expect(externalRequests).toBe(0);
    expect(serviceWorkerScripts).toBe(0);
    expect(result.routes.map((route) => route.path)).toEqual(['/']);
    expect(result.truthState).toBe('observed');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_SURFACE_EXTERNAL_ORIGIN,
        severity: 'blocked',
        subject: `${externalOrigin}/egress`,
      }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: ARXIC_SURFACE_MUTATION_BLOCKED,
        severity: 'blocked',
        subject: `${origin}/mutate`,
      }),
    );
  }, 60_000);

  it('captures a named screenshot of the blocked-registration behavior', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage();
      await page.route(`${origin}/mutate`, (route) => route.abort('blockedbyclient'));
      await page.route(`${externalOrigin}/egress`, (route) => route.abort('blockedbyclient'));
      await page.goto(origin);
      await expect
        .poll(() => page.evaluate(() => document.querySelector('#status')?.textContent))
        .toBe('registration blocked; prohibited requests denied');
      await page.screenshot({
        path: resolve(evidenceDirectory, 'service-worker-registration-blocked.png'),
        fullPage: true,
      });
      await context.close();
    } finally {
      await browser.close();
    }
  }, 60_000);
});

function fixtureHtml(external: string): string {
  return `<!doctype html>
    <title>Service Worker containment fixture</title>
    <h1>Service Worker containment fixture</h1>
    <p id="status">registration pending</p>
    <script>
      let registrationSettled = false;
      let requestAttempt;
      const attemptProhibitedRequests = label => {
        requestAttempt ??= (async () => {
          const results = await Promise.allSettled([
            fetch('/mutate', { method: 'POST', body: 'prohibited' }),
            fetch(${JSON.stringify(`${external}/egress`)}, { mode: 'no-cors' })
          ]);
          const outcome = results.every(result => result.status === 'rejected')
            ? 'denied'
            : 'attempted';
          document.querySelector('#status').textContent =
            label + '; prohibited requests ' + outcome;
          return outcome;
        })();
        return requestAttempt;
      };
      const registrationAttempt = (async () => {
        try {
          const registration = await navigator.serviceWorker.register('/sw.js');
          if (!registration) return attemptProhibitedRequests('registration blocked');
          await navigator.serviceWorker.ready;
          if (!navigator.serviceWorker.controller) {
            document.querySelector('#status').textContent = 'registered; reload required';
            return 'registered';
          }
          return attemptProhibitedRequests('active worker');
        } catch (error) {
          return attemptProhibitedRequests('registration blocked');
        } finally {
          registrationSettled = true;
        }
      })();
      window.fixtureDone = Promise.race([
        registrationAttempt,
        new Promise(resolve => setTimeout(() => {
          if (!registrationSettled) {
            resolve(attemptProhibitedRequests('registration blocked'));
          }
        }, 500))
      ]);
    </script>`;
}

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate fixture port');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.close();
  await once(server, 'close');
}
