import { createServer, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { chromium } from 'playwright';
import {
  installFault,
  isInducibleStatus,
  faultBody,
  SUBMIT_FORMS_SCRIPT,
  TRANSIENT_REGIONS_SCRIPT,
  INDUCIBLE_STATUSES,
  type TransientRegion,
} from '../state-induction';
import { launchArgs } from '../determinism';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

/**
 * An application whose error banner and inline validation exist only when
 * something fails: navigating to it renders the happy path and nothing else.
 */
const APP = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; font: 14px system-ui; }
  #banner { display: none; background: #fee; color: #900; padding: 8px; }
  #banner.shown { display: block; }
</style></head>
<body>
  <div id="banner" role="alert"></div>
  <div id="list">loading…</div>
  <form id="signup" novalidate>
    <input name="email" type="email" required aria-invalid="false">
    <span id="email-error" hidden>Enter your email</span>
    <button type="submit">Sign up</button>
  </form>
  <script>
    fetch('/api/items')
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => { document.getElementById('list').textContent = d.items.join(','); })
      .catch((e) => {
        const banner = document.getElementById('banner');
        banner.textContent = 'Could not load items (' + e.message + ')';
        banner.classList.add('shown');
        document.getElementById('list').textContent = '';
      });
    document.getElementById('signup').addEventListener('submit', (event) => {
      event.preventDefault();
      const field = event.target.elements.email;
      const bad = !field.value;
      field.setAttribute('aria-invalid', String(bad));
      document.getElementById('email-error').hidden = !bad;
    });
  </script>
</body></html>`;

async function serve() {
  const server: Server = createServer((request, response) => {
    if (request.url?.startsWith('/api/items')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ items: ['alpha', 'beta'] }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(APP);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  cleanup.push(() => new Promise<void>((done) => server.close(() => done())));
  const { port } = server.address() as { port: number };
  return `http://127.0.0.1:${port}`;
}

async function browser() {
  const instance = await chromium.launch({ headless: true, args: launchArgs('chromium') });
  cleanup.push(() => instance.close());
  return instance;
}

it('reaches the happy path without induction, so the error state is genuinely unreachable', async () => {
  const origin = await serve();
  const page = await (await (await browser()).newContext()).newPage();
  await page.goto(origin, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('list')?.textContent !== 'loading…');
  expect(await page.locator('#list').textContent()).toBe('alpha,beta');
  expect(await page.locator('#banner').isVisible()).toBe(false);
  expect(await page.evaluate(TRANSIENT_REGIONS_SCRIPT)).toEqual([]);
}, 60_000);

it.each([500, 503, 422] as const)(
  'renders the application error banner when its data request is answered %i',
  async (status) => {
    const origin = await serve();
    const context = await (await browser()).newContext();
    const counters = await installFault(context, origin, { status });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: 'load' });
    await page.waitForSelector('#banner.shown');
    expect(counters.answered).toBe(1);
    expect(await page.locator('#banner').textContent()).toContain(String(status));
    const regions = (await page.evaluate(TRANSIENT_REGIONS_SCRIPT)) as TransientRegion[];
    expect(regions).toHaveLength(1);
    expect(regions[0]!.role).toBe('alert');
    expect(regions[0]!.width).toBeGreaterThan(0);
  },
  60_000,
);

it('leaves the document navigation alone so the application handles its own error', async () => {
  const origin = await serve();
  const context = await (await browser()).newContext();
  await installFault(context, origin, { status: 500 });
  const page = await context.newPage();
  const response = await page.goto(origin, { waitUntil: 'load' });
  // The page itself still loads — only its data request was answered 500.
  expect(response?.status()).toBe(200);
  await page.waitForSelector('#banner.shown');
}, 60_000);

it('only intercepts requests whose path matches a scoped fault', async () => {
  const origin = await serve();
  const context = await (await browser()).newContext();
  const counters = await installFault(context, origin, { status: 500, path: '/api/never' });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('list')?.textContent !== 'loading…');
  expect(counters.answered).toBe(0);
  expect(await page.locator('#list').textContent()).toBe('alpha,beta');
}, 60_000);

it('never forwards the request it answers, so the target is untouched', async () => {
  let reached = 0;
  const server: Server = createServer((request, response) => {
    if (request.url?.startsWith('/api/items')) {
      reached++;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"items":[]}');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(APP);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  cleanup.push(() => new Promise<void>((done) => server.close(() => done())));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const context = await (await browser()).newContext();
  await installFault(context, origin, { status: 500 });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'load' });
  await page.waitForSelector('#banner.shown');
  expect(reached).toBe(0);
}, 60_000);

it('provokes inline validation by submitting the form empty', async () => {
  const origin = await serve();
  const page = await (await (await browser()).newContext()).newPage();
  await page.goto(origin, { waitUntil: 'load' });
  expect(await page.locator('#email-error').isVisible()).toBe(false);
  const submitted = (await page.evaluate(SUBMIT_FORMS_SCRIPT)) as {
    forms: number;
    invalidFields: number;
  };
  expect(submitted.forms).toBe(1);
  expect(submitted.invalidFields).toBeGreaterThan(0);
  expect(await page.locator('#email-error').isVisible()).toBe(true);
  expect(await page.locator('input[name=email]').getAttribute('aria-invalid')).toBe('true');
}, 60_000);

it('clears a prefilled field before submitting, so a restored value cannot pass the form', async () => {
  const origin = await serve();
  const page = await (await (await browser()).newContext()).newPage();
  await page.goto(origin, { waitUntil: 'load' });
  await page.fill('input[name=email]', 'someone@example.test');
  await page.evaluate(SUBMIT_FORMS_SCRIPT);
  expect(await page.locator('input[name=email]').inputValue()).toBe('');
  expect(await page.locator('#email-error').isVisible()).toBe(true);
}, 60_000);

it('reports a page with no form rather than pretending it induced something', async () => {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><meta charset="utf-8"><body>no forms here</body>');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  cleanup.push(() => new Promise<void>((done) => server.close(() => done())));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const page = await (await (await browser()).newContext()).newPage();
  await page.goto(origin, { waitUntil: 'load' });
  expect(await page.evaluate(SUBMIT_FORMS_SCRIPT)).toEqual({ forms: 0, invalidFields: 0 });
}, 60_000);

it('admits only the closed list of statuses', () => {
  for (const status of INDUCIBLE_STATUSES) expect(isInducibleStatus(status)).toBe(true);
  for (const rejected of [200, 301, 418, 599, '500', null, undefined, NaN])
    expect(isInducibleStatus(rejected)).toBe(false);
  expect(JSON.parse(faultBody(500))).toMatchObject({ status: 500, induced: true });
});
