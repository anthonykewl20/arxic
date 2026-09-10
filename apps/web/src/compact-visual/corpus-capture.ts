import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { chromium, type Locator, type Page } from 'playwright';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';
import {
  bootFixtureApp,
  referenceAuthApp,
  vulnerableAuthApp,
  stopApp,
} from '../../../../packages/real-world-testkit/src';
import { startWorkbench } from '../server';
import { extractCase } from './features';
import { runTraining, type TrainingRow } from './train-runner';
import {
  addressedHeads,
  DEFECT_HEADS,
  evaluateLayoutShiftOracle,
  evaluateMissingOracle,
  evaluateOcclusionOracle,
  evaluateOracle,
  evaluateOverflowOracle,
  evaluateTextTruncationOracle,
  validateCorpusPlan,
  VARIANT_REGISTRY,
  type FrozenPlan,
} from './corpus';
import { toTrainingLabels, validateVisualLabel, type VisualLabel } from './labels';
import { maskBoxes, measure, save } from './workflow';
import type { Measurement } from './evidence';
import type { Box, Scene, VisualCase } from './evidence';

const execute = promisify(execFile);

export type CorpusV2Manifest = {
  version: 1;
  plan: FrozenPlan;
  revision: string;
  skipped: { family: string; viewport: number; variant: string; reason: string }[];
  cases: {
    manifest: string;
    family: string;
    split: 'train' | 'calibration' | 'test';
    variant: string;
    viewport: number;
    /** Controlled per-head labels in DEFECT_HEADS order; null = not applicable. */
    labels: (0 | 1 | null)[];
    labelOrigin: string;
    /** Null when the variant removes the control (no box exists to measure). */
    measuredClip: number | null;
    measuredOverflowX: number;
  }[];
  provenance: string;
};

type FamilySurface = {
  origin: string;
  path: string;
  button: string;
  buttonExact: boolean;
  /** Locators that Chromium's a11y tree cannot name (koel's label-wrapped submit, #383) bind by unique css instead. */
  buttonSelector?: string;
};
type StartedFamily = {
  surface: FamilySurface;
  /** Design viewport override: wide dashboards scroll horizontally at 800px,
   * which would contradict the overflow oracle on unmutated pages. */
  viewport?: number;
  stop: () => Promise<void>;
};

const THIRD_PARTY_ROOT =
  process.env.ARXIC_VISUAL_THIRD_PARTY ?? join(homedir(), 'devtony', 'thirdparty-dg');

const PUBLIC_FAMILIES_ROOT =
  process.env.ARXIC_VISUAL_PUBLIC_FAMILIES ?? `${THIRD_PARTY_ROOT}/public-families`;

/**
 * Static open-source application families served read-only from local clones
 * under PUBLIC_FAMILIES_ROOT (commit-pinned; local-only, never committed).
 * todomvc's vanilla app has no button role, so its input is the control; the
 * admin templates expose login pages whose submit button is the control.
 */
export const STATIC_FAMILY_CONFIG: Record<
  string,
  {
    docroot: string;
    path: string;
    button: string;
    buttonExact: boolean;
    buttonSelector?: string;
    vendorRoutes?: Record<string, string>;
    viewport?: number;
  }
> = {
  todomvc: {
    // The monorepo root must be the docroot: the app loads per-example
    // node_modules assets that the shallow clone does not ship, so those
    // requests route to the local todomvc-vendor clones instead.
    docroot: 'todomvc',
    path: '/examples/javascript-es5/',
    button: '',
    buttonExact: true,
    buttonSelector: 'input.new-todo',
    vendorRoutes: {
      '/examples/javascript-es5/node_modules/todomvc-common/': 'todomvc-vendor/todomvc-common',
      '/examples/javascript-es5/node_modules/todomvc-app-css/': 'todomvc-vendor/todomvc-app-css',
    },
  },
  gentelella: {
    docroot: 'gentelella/production',
    path: '/index.html',
    button: '',
    buttonExact: true,
    buttonSelector: 'div.page-actions button.btn-outline',
    viewport: 1280,
  },
  'sb-admin': {
    docroot: 'sb-admin/dist',
    path: '/login.html',
    button: '',
    buttonExact: true,
    buttonSelector: 'a.btn.btn-primary',
  },
  adminlte: {
    // The OSS dist's index pages keep every real button below the fold at this
    // viewport; the starter page's card button is visible without scrolling.
    // 1280 is the design width: at 800 the dashboard scrolls horizontally and
    // unmutated pages would contradict the overflow oracle.
    docroot: 'adminlte',
    path: '/starter.html',
    button: '',
    buttonExact: true,
    buttonSelector: ':nth-match(a.btn.btn-primary, 1)',
    viewport: 1280,
  },
  'sb-admin-2': {
    // The successor template is a distinct DOM: its login submit is the only
    // btn-primary anchor on the centered card, while the sibling Google and
    // Facebook anchors carry different classes, so the selector stays unique
    // without a viewport pin (the page is responsive at any width).
    docroot: 'sb-admin-2',
    path: '/login.html',
    button: '',
    buttonExact: true,
    buttonSelector: 'a.btn-primary.btn-user',
  },
  'material-dashboard': {
    // Creative Tim's template (MIT, tag v3.1.0, commit-pinned) is a vendor
    // distinct from the StartBootstrap families: its static build ships the
    // sign-in page with a plain enabled submit button — the page's only
    // bg-gradient-primary button (the navbar CTA is bg-gradient-dark), so
    // the selector stays unique. Remote fonts and the unsplash header image
    // do not paint offline; nothing the oracles measure depends on them.
    docroot: 'material-dashboard',
    path: '/pages/sign-in.html',
    button: '',
    buttonExact: true,
    buttonSelector: 'button.bg-gradient-primary',
  },
  'material-kit': {
    // Same vendor and license as material-dashboard (MIT, commit-pinned at
    // 54cdbf81, default-branch HEAD — no release tag). The sign-in page's
    // submit is the page's only bg-gradient-dark BUTTON: the navbar CTA
    // carrying the same class is an anchor, and the dark card header and
    // image mask are not buttons, so the tag-qualified selector stays unique.
    // Like material-dashboard the card is centered with my-auto, so removing
    // the control re-centers the inputs — the capture records honest
    // unstable-case skips for those cases rather than fabricated rows.
    docroot: 'material-kit',
    path: '/pages/sign-in.html',
    button: '',
    buttonExact: true,
    buttonSelector: 'button.bg-gradient-dark',
  },
  adminbsb: {
    // AdminBSB - Material Design (MIT, a plain no-build HTML template,
    // commit-pinned at e5d39b8 — default-branch HEAD). Its sign-in page's
    // submit is the only bg-pink element anywhere in the page, so the class
    // selector alone stays unique page-wide. The login card keeps its
    // position when the control is removed (no my-auto recentering), so the
    // missing-element oracle is stable at every width probed (360–1280). The
    // page carries no h1/h2/p — its intro text lives in a div.msg — so the
    // text-truncate variant honestly refuses no-text-element; recorded per
    // case, never fabricated.
    docroot: 'adminbsb',
    path: '/pages/examples/sign-in.html',
    button: '',
    buttonExact: true,
    buttonSelector: 'button.bg-pink',
  },
  'now-ui-kit': {
    // Creative Tim's now-ui-kit (MIT, a static kit, commit-pinned at
    // 80acd17 — default-branch HEAD). Its login card's "Get Started"
    // control is an anchor styled as a button (the sb-admin precedent),
    // and the only btn-primary anchor on the page, so the class selector
    // stays unique. The card keeps its position when the control is
    // removed (missing-element stable at every width probed, 360–1280),
    // and the page's widest h1/h2/p text stays under the oracle's 80px
    // floor, so the text-truncate variant honestly refuses
    // no-text-element — recorded per case, never fabricated.
    docroot: 'now-ui-kit',
    path: '/examples/login-page.html',
    button: '',
    buttonExact: true,
    buttonSelector: 'a.btn-primary',
  },
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Read-only static file server for one public-family docroot on an
 * ephemeral loopback port. Serves nothing outside the docroot or an explicit
 * vendor route. */
export async function startStaticFamily(config: {
  docroot: string;
  /** Exact path-prefix routes for vendored assets the app expects but the
   * clone does not ship (todomvc's per-example node_modules). */
  vendorRoutes?: Record<string, string>;
}): Promise<StartedFamily> {
  const root = resolve(PUBLIC_FAMILIES_ROOT, config.docroot);
  await access(join(root, 'index.html'));
  const vendorRoots = Object.entries(config.vendorRoutes ?? {}).map(
    ([prefix, dir]) => [prefix, resolve(PUBLIC_FAMILIES_ROOT, dir)] as const,
  );
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const vendor = vendorRoots.find(([prefix]) => pathname.startsWith(prefix));
      const base = vendor ? vendor[1] : root;
      const relative = vendor ? pathname.slice(vendor[0].length) : pathname;
      const file = resolve(base, `.${relative.startsWith('/') ? relative : `/${relative}`}`);
      if (!file.startsWith(base + '/') && file !== base) throw new Error('outside-docroot');
      const bytes = await readFile(file);
      response.writeHead(200, {
        'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      });
      response.end(bytes);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not-found');
    }
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    surface: { origin, path: '/', button: '', buttonExact: true },
    stop: () =>
      new Promise<void>((resolveClose) => {
        // Chromium keeps idle keep-alive sockets open; closeIdleConnections
        // lets the server actually finish instead of waiting out their lifetime.
        server.closeIdleConnections();
        server.close(() => resolveClose());
      }),
  };
}

async function bootDockerFamily(config: {
  image: string;
  containerPrefix: string;
  containerPort: number;
  args: string[];
  mounts: { host: string; container: string }[];
  healthPath: string;
}): Promise<StartedFamily> {
  const container = `${config.containerPrefix}-${randomUUID().slice(0, 8)}`;
  const uid = process.getuid?.() ?? 1000,
    gid = process.getgid?.() ?? 1000;
  const runArgs = [
    'run',
    '-d',
    '--name',
    container,
    '-u',
    `${uid}:${gid}`,
    '-e',
    'HOME=/tmp',
    '-p',
    `127.0.0.1::${config.containerPort}`,
    ...config.mounts.flatMap((m) => ['-v', `${m.host}:${m.container}`]),
    ...config.args,
  ];
  await execute('docker', runArgs, { timeout: 60000 });
  const stop = async () => {
    await execute('docker', ['stop', '-t', '5', container], { timeout: 30000 }).catch(() => {});
    await execute('docker', ['rm', '-f', container], { timeout: 30000 }).catch(() => {});
  };
  try {
    const port = (
      await execute('docker', ['port', container, `${config.containerPort}/tcp`])
    ).stdout
      .trim()
      .split('\n')[0]!
      .replace(/^.*:/u, '');
    const origin = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 120000;
    do {
      try {
        const response = await fetch(`${origin}${config.healthPath}`);
        if (response.ok)
          return { surface: { origin, path: '/', button: '', buttonExact: true }, stop };
      } catch {
        /* container still starting */
      }
      await new Promise((r) => setTimeout(r, 1000));
    } while (Date.now() < deadline);
    throw new Error('family-boot-failed');
  } catch (error) {
    await stop();
    throw error;
  }
}

export async function startFamily(root: string, family: string): Promise<StartedFamily> {
  if (family === 'next' || family === 'express') {
    const fixture = await bootFixtureApp(
      root,
      family === 'next' ? referenceAuthApp : vulnerableAuthApp,
      `visual-corpus-${family}`,
    );
    return {
      surface: {
        origin: fixture.origin,
        path: family === 'next' ? '/login' : '/',
        button: 'Login',
        buttonExact: true,
      },
      stop: async () => {
        await stopApp(fixture.child);
        await rm(fixture.runtimeDirectory, { recursive: true, force: true });
      },
    };
  }
  if (family === 'arxic') {
    const state = await mkdtemp(join(tmpdir(), 'visual-corpus-arxic-'));
    const app = await startWorkbench({
      roots: [root],
      stateDirectory: state,
      adminToken: 'visual-capture-anonymous-only-token',
      port: 0,
    });
    return {
      surface: { origin: app.origin, path: '/', button: 'Open workbench', buttonExact: false },
      stop: async () => {
        await app.close();
        await rm(state, { recursive: true, force: true });
      },
    };
  }
  if (family === 'koel') {
    const started = await bootDockerFamily({
      image: 'koel-php83:rehearsal',
      containerPrefix: 'koel-visual-corpus',
      containerPort: 8123,
      mounts: [
        { host: `${THIRD_PARTY_ROOT}/koel`, container: '/var/www/koel' },
        { host: `${THIRD_PARTY_ROOT}/koel-data`, container: '/data' },
      ],
      args: [
        '-w',
        '/var/www/koel',
        'koel-php83:rehearsal',
        'php',
        'artisan',
        'serve',
        '--host=0.0.0.0',
        '--port=8123',
      ],
      healthPath: '/',
    });
    return {
      surface: {
        ...started.surface,
        path: '/',
        button: 'Log In',
        buttonExact: false,
        buttonSelector: 'form button[type="submit"]',
      },
      stop: started.stop,
    };
  }
  if (family === 'directus') {
    const started = await bootDockerFamily({
      image: 'directus-node22:rehearsal',
      containerPrefix: 'directus-visual-corpus',
      containerPort: 8055,
      mounts: [
        { host: `${THIRD_PARTY_ROOT}/directus`, container: '/repo' },
        { host: `${THIRD_PARTY_ROOT}/directus-data`, container: '/data' },
      ],
      args: [
        '-w',
        '/repo',
        '-e',
        'DB_CLIENT=sqlite3',
        '-e',
        'DB_FILENAME=/data/data.db',
        '-e',
        'SECRET=rehearsal-57ab82b4a0f62432c3329123162c0f02',
        '-e',
        'HOST=0.0.0.0',
        '-e',
        'PORT=8055',
        '-e',
        'EXTENSIONS_PATH=/data/extensions',
        '-e',
        'STORAGE_LOCAL_ROOT=/data/uploads',
        'directus-node22:rehearsal',
        'node',
        'api/dist/cli/run.js',
        'start',
      ],
      healthPath: '/server/ping',
    });
    return {
      surface: { ...started.surface, path: '/admin', button: 'Sign In', buttonExact: false },
      stop: started.stop,
    };
  }
  if (family === 'mailpit') {
    const started = await bootDockerFamily({
      image: 'axllent/mailpit:v1.30.0',
      containerPrefix: 'mailpit-visual-corpus',
      containerPort: 8025,
      mounts: [],
      args: ['axllent/mailpit:v1.30.0'],
      healthPath: '/',
    });
    return {
      // The SPA's accessible button names carry a leading space; exact matching misses them.
      surface: { ...started.surface, button: 'Delete all', buttonExact: false },
      stop: started.stop,
    };
  }
  const staticFamily = STATIC_FAMILY_CONFIG[family];
  if (staticFamily) {
    const started = await startStaticFamily(staticFamily);
    return {
      surface: {
        ...started.surface,
        path: staticFamily.path,
        button: staticFamily.button,
        buttonExact: staticFamily.buttonExact,
        buttonSelector: staticFamily.buttonSelector,
      },
      viewport: staticFamily.viewport,
      stop: started.stop,
    };
  }
  throw new Error('unknown-family');
}

/** Clamp the document scrollport so transformed controls do not surface as
 * scrollport overflow: the clipping criterion isolates reachability, not
 * scrollable overflow (the overflow-x variant covers that head). */
async function clampScrollport(page: Page) {
  await page.evaluate(() => {
    (document.documentElement as HTMLElement).style.overflow = 'clip';
    (document.body as HTMLElement).style.overflow = 'clip';
  });
}

/** Per-head measured signals for the four non-box oracles. Nulls mark signals
 * that cannot exist (hit-test and shift need a present control). */
async function measureHeadSignals(
  button: Locator,
  page: Page,
  beforeBox: Box,
): Promise<{
  controlPresent: boolean;
  hitBlocked: boolean | null;
  textOverflowPx: number | null;
  shiftX: number;
  shiftY: number;
}> {
  const present = (await button.count()) > 0;
  const textOverflowPx = await page.evaluate(() => {
    // Prefer the element the text-truncate mutation marked; otherwise the
    // honest negative is the widest hidden overflow across the text seam.
    const marked = document.querySelector<HTMLElement>('[data-visual-corpus-text]');
    if (marked) return Math.max(0, marked.scrollWidth - marked.clientWidth);
    const candidates = [...document.querySelectorAll<HTMLElement>('h1, h2, p')];
    if (!candidates.length) return null;
    return candidates.reduce(
      (max, el) => Math.max(max, Math.max(0, el.scrollWidth - el.clientWidth)),
      0,
    );
  });
  if (!present)
    return { controlPresent: false, hitBlocked: null, textOverflowPx, shiftX: 0, shiftY: 0 };
  const control = await button.evaluate((node, before: Box) => {
    const rect = (node as HTMLElement).getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      hitBlocked: !(top && (top === node || node.contains(top))),
      shiftX: rect.left + rect.width / 2 - (before.x + before.width / 2),
      shiftY: rect.top + rect.height / 2 - (before.y + before.height / 2),
    };
  }, beforeBox);
  return { controlPresent: true, ...control, textOverflowPx };
}

async function applyVariant(
  button: Locator,
  page: Page,
  variantId: string,
  box: Box,
  viewport: { width: number; height: number },
): Promise<string | null> {
  const variant = VARIANT_REGISTRY[variantId]!;
  if (variantId === 'clean') return null;
  if (variant.clipFull) {
    await button.evaluate((node) => {
      (node as HTMLElement).style.transform = 'translateX(3000px)';
    });
    // Chromium includes transformed boxes in scrollable overflow: without
    // clamping, the translated control would also overflow the scrollport and
    // the two defect heads would be inseparable. Clamping represents the real
    // "unreachable control without scroll access" clipping class.
    await clampScrollport(page);
    return null;
  }
  if (variant.clipKeep !== undefined) {
    const keep = variant.clipKeep;
    if (variant.clipDirection === 'right') {
      const translate = viewport.width - keep * box.width - box.x;
      await button.evaluate((node, translate: number) => {
        (node as HTMLElement).style.transform = `translateX(${translate}px)`;
      }, translate);
    } else {
      const translate = viewport.height - keep * box.height - box.y;
      await button.evaluate((node, translate: number) => {
        (node as HTMLElement).style.transform = `translateY(${translate}px)`;
      }, translate);
    }
    await clampScrollport(page);
    return null;
  }
  if (variantId === 'content-change') {
    // An approved content change must not touch the required control itself:
    // its role-locator identity has to survive for the after-measurement.
    await page.evaluate(() => {
      const text = document.querySelector<HTMLElement>('h1, h2, p');
      if (text) text.textContent = text.textContent === 'Continue' ? 'Proceed' : 'Continue';
    });
    return null;
  }
  if (variantId === 'overflow-x') {
    // Layout-neutral overflow regression: a transparent 1px-tall absolutely
    // positioned element doubles the document scrollport width without moving
    // any visible control or input geometry.
    await page.evaluate(() => {
      const wide = document.createElement('div');
      wide.setAttribute('data-visual-corpus', 'overflow-x');
      wide.style.cssText =
        'position:absolute;left:0;top:0;width:200vw;height:1px;pointer-events:none;';
      document.body.appendChild(wide);
    });
    return null;
  }
  if (variantId === 'overlay-adjacent') {
    await page.evaluate(() => {
      const banner = document.createElement('div');
      banner.setAttribute('data-visual-corpus', 'overlay-adjacent');
      banner.style.cssText =
        'position:fixed;left:0;top:0;width:96px;height:36px;background:#1f2937;z-index:2147483647;';
      document.body.appendChild(banner);
    });
    return null;
  }
  if (variantId === 'style-tweak') {
    await page.evaluate(() => {
      document.body.style.filter = 'brightness(1.02)';
    });
    return null;
  }
  if (variantId === 'occlusion-overlay') {
    // An opaque overlay exactly over the control: the box stays put and fully
    // inside the viewport, but the topmost element at its center is the overlay.
    await page.evaluate((before: Box) => {
      const overlay = document.createElement('div');
      overlay.setAttribute('data-visual-corpus', 'occlusion-overlay');
      overlay.style.cssText = `position:fixed;left:${before.x}px;top:${before.y}px;width:${before.width}px;height:${before.height}px;background:#111827;z-index:2147483647;`;
      document.body.appendChild(overlay);
    }, box);
    return null;
  }
  if (variantId === 'missing-element') {
    await button.evaluate((node) => {
      node.remove();
    });
    return null;
  }
  if (variantId === 'text-truncate') {
    // Same non-control text seam as content-change, but the chosen element is
    // the widest h1/h2/p on the page (short headings like "Login" cannot hide
    // 60px). scrollWidth floors at clientWidth for blocks, so the one-line
    // width comes from a DOM Range; the chosen element is marked so the
    // measurement seam reads exactly the mutated element.
    const hasText = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll<HTMLElement>('h1, h2, p')];
      let best: HTMLElement | null = null;
      let bestWidth = 0;
      for (const el of candidates) {
        if (!el.textContent?.trim()) continue;
        el.style.whiteSpace = 'nowrap';
        const range = document.createRange();
        range.selectNodeContents(el);
        const width = range.getBoundingClientRect().width;
        if (width > bestWidth) {
          bestWidth = width;
          best = el;
        }
      }
      for (const el of candidates) {
        if (el !== best) el.style.removeProperty('white-space');
      }
      if (!best || bestWidth < 80) return false;
      best.setAttribute('data-visual-corpus-text', 'truncated');
      best.style.overflow = 'hidden';
      best.style.textOverflow = 'ellipsis';
      best.style.maxWidth = `${bestWidth - 60}px`;
      return true;
    });
    return hasText ? null : 'no-text-element';
  }
  if (variantId === 'layout-shift') {
    // Translate toward whichever side has ≥24px of room so the control stays
    // fully inside the viewport (clipping stays negative); the measured box
    // center movement is what the oracle reads, never the intent.
    const room = {
      right: viewport.width - (box.x + box.width),
      left: box.x,
      down: viewport.height - (box.y + box.height),
      up: box.y,
    };
    const dx = room.right >= 24 ? 24 : room.left >= 24 ? -24 : 0;
    const dy = room.down >= 24 ? 24 : room.up >= 24 ? -24 : 0;
    if (dx === 0 && dy === 0) return 'no-shift-room';
    const transform = `translate(${dx}px, ${dy}px)`;
    await button.evaluate((node, transform: string) => {
      (node as HTMLElement).style.transform = transform;
    }, transform);
    await clampScrollport(page);
    return null;
  }
  throw new Error('unknown-variant');
}

export async function captureCorpusV2(
  root: string,
  output: string,
  families: string[],
  viewports = [360, 640, 1024, 1280],
  variants = Object.keys(VARIANT_REGISTRY),
): Promise<CorpusV2Manifest> {
  const frozen = validateCorpusPlan({
    version: 1,
    families,
    viewports,
    variants,
    allocationSeed: 423,
    criterion: 'required-submit-inside-viewport',
  });
  await mkdir(output, { recursive: true, mode: 0o700 });
  const revision = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const manifest: CorpusV2Manifest = {
    version: 1,
    plan: frozen,
    revision,
    skipped: [],
    cases: [],
    provenance:
      'Controlled viewport-clipping regressions plus negative controls across application families; groups never split across train/calibration/test; allocation frozen before training with seed 423.',
  };
  const browser = await chromium.launch({ headless: true });
  try {
    for (const family of frozen.families) {
      // A family whose boot or control seam fails skips loudly instead of
      // aborting the whole capture: the skip is recorded with its reason and
      // the remaining families still contribute their cases.
      let started: StartedFamily;
      try {
        started = await startFamily(root, family);
      } catch (error) {
        manifest.skipped.push({
          family,
          viewport: 0,
          variant: '*',
          reason: `family-boot-failed: ${String(error).slice(0, 160)}`,
        });
        continue;
      }
      const split = frozen.allocation.train.includes(family)
        ? 'train'
        : frozen.allocation.calibration.includes(family)
          ? 'calibration'
          : 'test';
      try {
        // A family viewport override captures that family only at its design
        // width; other families contribute every planned viewport.
        const widths = started.viewport ? [started.viewport] : viewports;
        for (const width of widths)
          for (const variantId of variants) {
            const height = 800,
              id = `${family}-${width}-${variantId}`;
            const context = await browser.newContext({
              viewport: { width, height },
              deviceScaleFactor: 1,
              reducedMotion: 'reduce',
              colorScheme: 'light',
              serviceWorkers: 'block',
            });
            const page = await context.newPage();
            try {
              await page.goto(started.surface.origin + started.surface.path);
              const button = started.surface.buttonSelector
                ? page.locator(started.surface.buttonSelector)
                : page.getByRole('button', {
                    name: started.surface.button,
                    exact: started.surface.buttonExact,
                  });
              await button.waitFor({ state: 'visible' });
              if (started.surface.buttonSelector && (await button.count()) !== 1)
                throw new Error('missing-control');
              await page.evaluate(() => document.fonts.ready);
              const beforeMeasurement = await measure(button, width, height);
              if (beforeMeasurement.clip !== 1) {
                manifest.skipped.push({
                  family,
                  viewport: width,
                  variant: variantId,
                  reason: 'baseline-not-inside-viewport',
                });
                continue;
              }
              const beforeMasks = await maskBoxes(page);
              const beforeBytes = await captureMaskedViewport(page, {
                automaticMasks: ['input', 'textarea', '[contenteditable="true"]'],
                requiredMasks: [],
              });
              const skipReason = await applyVariant(
                button,
                page,
                variantId,
                beforeMeasurement.box!,
                {
                  width,
                  height,
                },
              );
              if (skipReason) {
                manifest.skipped.push({
                  family,
                  viewport: width,
                  variant: variantId,
                  reason: skipReason,
                });
                continue;
              }
              const controlRemoved = variantId === 'missing-element';
              const scrollport = await page.evaluate(() => {
                const scroller = document.scrollingElement as HTMLElement | null;
                return {
                  overflowX: scroller
                    ? Math.max(0, scroller.scrollWidth - scroller.clientWidth) /
                      Math.max(1, scroller.clientWidth)
                    : 0,
                  overflowY: scroller
                    ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) /
                      Math.max(1, scroller.clientHeight)
                    : 0,
                };
              });
              const currentMeasurement: Measurement = controlRemoved
                ? {
                    box: null,
                    clip: null,
                    hit: 0,
                    overflowX: scrollport.overflowX,
                    overflowY: scrollport.overflowY,
                  }
                : await measure(button, width, height);
              const currentMasks = await maskBoxes(page);
              const currentBytes = await captureMaskedViewport(page, {
                automaticMasks: ['input', 'textarea', '[contenteditable="true"]'],
                requiredMasks: [],
              });
              if (controlRemoved) {
                // Stability for a removed control is absence, not box equality;
                // the privacy mask layout must still be identical so training's
                // evidence contract (incompatible-masks) accepts the case.
                if (
                  (await button.count()) !== 0 ||
                  JSON.stringify(beforeMasks) !== JSON.stringify(currentMasks)
                ) {
                  manifest.skipped.push({
                    family,
                    viewport: width,
                    variant: variantId,
                    reason: 'unstable-case',
                  });
                  continue;
                }
              } else {
                const repeated = await measure(button, width, height);
                if (
                  JSON.stringify(repeated) !== JSON.stringify(currentMeasurement) ||
                  JSON.stringify(beforeMasks) !== JSON.stringify(currentMasks)
                ) {
                  manifest.skipped.push({
                    family,
                    viewport: width,
                    variant: variantId,
                    reason: 'unstable-case',
                  });
                  continue;
                }
              }
              // Exactly the heads this variant addresses get a measured-decision
              // oracle; any contradiction skips the case instead of mislabeling it.
              const headSignals = await measureHeadSignals(button, page, beforeMeasurement.box!);
              const oracleResults = addressedHeads(variantId).map((head) => {
                if (head === 0)
                  return { head, ...evaluateOracle(variantId, currentMeasurement.clip ?? 1) };
                if (head === 3)
                  return {
                    head,
                    ...evaluateOverflowOracle(
                      variantId,
                      currentMeasurement.overflowX ?? 0,
                      currentMeasurement.overflowY ?? 0,
                    ),
                  };
                if (head === 1)
                  return {
                    head,
                    ...evaluateOcclusionOracle(variantId, headSignals.hitBlocked ?? false),
                  };
                if (head === 2)
                  return { head, ...evaluateMissingOracle(variantId, headSignals.controlPresent) };
                if (head === 4)
                  return {
                    head,
                    ...evaluateTextTruncationOracle(variantId, headSignals.textOverflowPx ?? 0),
                  };
                return {
                  head,
                  ...evaluateLayoutShiftOracle(variantId, headSignals.shiftX, headSignals.shiftY),
                };
              });
              const contradicted = oracleResults.find((result) => !result.ok);
              if (contradicted) {
                manifest.skipped.push({
                  family,
                  viewport: width,
                  variant: variantId,
                  reason: contradicted.reason ?? 'controlled-oracle-failed',
                });
                continue;
              }
              const before = await save(output, `${id}-before.png`, beforeBytes);
              const current = await save(output, `${id}-current.png`, currentBytes);
              const privacy = (hash: string, masks: Box[]) => ({
                version: 1,
                screenshotSha256: hash,
                mode: 'input-masked',
                masks,
                rawTraceRetained: false,
              });
              const beforePrivacy = await save(
                output,
                `${id}-before.png.privacy.json`,
                privacy(before.sha256, beforeMasks),
              );
              const currentPrivacy = await save(
                output,
                `${id}-current.png.privacy.json`,
                privacy(current.sha256, currentMasks),
              );
              const sceneValue: Scene = {
                version: 1,
                beforeSha256: before.sha256,
                currentSha256: current.sha256,
                sanitized: true,
                stable: true,
                regions: [
                  {
                    id: 'viewport',
                    box: { x: 0, y: 0, width, height },
                    before: beforeMeasurement,
                    current: currentMeasurement,
                    eligible: DEFECT_HEADS.map((_, head) =>
                      oracleResults.some((result) => result.head === head),
                    ),
                    criterion: 'required-submit-inside-viewport',
                  },
                ],
                hardChecks: oracleResults.map((result) => ({
                  id: `${DEFECT_HEADS[result.head]}-oracle`,
                  head: DEFECT_HEADS[result.head],
                  verdict: result.verdict,
                  region: 'viewport',
                })),
              };
              const scene = await save(output, `${id}-scene.json`, sceneValue);
              const timeline = await save(output, `${id}-timeline.json`, {
                version: 1,
                actions: [
                  'capture-before',
                  ...(VARIANT_REGISTRY[variantId]!.labels.some((value) => value === 1)
                    ? ['apply-controlled-regression']
                    : []),
                  'capture-current',
                  'measure',
                  'assert-pass',
                ],
              });
              const timelineProvenance = await save(output, `${id}-timeline.sanitization.json`, {
                version: 1,
                sha256: timeline.sha256,
                method: 'allowlisted-actions-v1',
                rawTraceRetained: false,
              });
              const caseManifest: VisualCase = {
                version: 1,
                id,
                group: family,
                revision,
                consent: true,
                context: {
                  width,
                  height,
                  dpr: 1,
                  profile: 'chromium-anonymous-light',
                  state: `required-submit-${variantId}`,
                },
                before,
                current,
                beforePrivacy,
                currentPrivacy,
                scene,
                timeline,
                timelineProvenance,
              };
              await save(output, `${id}.json`, caseManifest);
              manifest.cases.push({
                manifest: `${id}.json`,
                family,
                split,
                variant: variantId,
                viewport: width,
                labels: [...VARIANT_REGISTRY[variantId]!.labels],
                labelOrigin: VARIANT_REGISTRY[variantId]!.labelOrigin,
                measuredClip: currentMeasurement.clip ?? null,
                measuredOverflowX: currentMeasurement.overflowX ?? 0,
              });
            } catch (error) {
              // Case-level failures (control never visible, navigation timeout)
              // skip loudly with the reason instead of aborting the family.
              manifest.skipped.push({
                family,
                viewport: width,
                variant: variantId,
                reason: `case-error: ${String(error).slice(0, 160)}`,
              });
            } finally {
              await context.close();
            }
          }
      } finally {
        await started.stop();
      }
    }
  } finally {
    await browser.close();
  }
  await save(output, 'corpus-v2.json', manifest);
  return manifest;
}

/**
 * Turn captured corpus cases into adjudicated, oracle-checked rows — the
 * shared labeling service for training (which persists dataset.json) and for
 * evaluate-only scoring (which must not write anything the trainer owns).
 */
export async function buildLabeledRows(output: string, manifest: CorpusV2Manifest) {
  const rows: TrainingRow[] = [];
  const evidence = [];
  for (const entry of manifest.cases) {
    const extracted = await extractCase(output, entry.manifest);
    for (const region of extracted.regions) {
      if (region.criterion !== 'required-submit-inside-viewport')
        throw new Error('label-evidence-conflict');
      // Every addressed head's hard-check verdict must agree with the row's
      // controlled label; unaddressed heads carry no check and no claim.
      const states = entry.labels.map((label) =>
        label === null ? 'not_applicable' : label === 1 ? 'present' : 'absent',
      ) as import('./labels').VisualLabel['labels'];
      for (const head of DEFECT_HEADS.keys()) {
        if (entry.labels[head] === null) continue;
        const check = extracted.hardChecks.find(
          (h) => h.region === region.id && h.head === DEFECT_HEADS[head],
        );
        if (!check || check.verdict !== (entry.labels[head] === 1 ? 'fail' : 'pass'))
          throw new Error('label-evidence-conflict');
      }
      // Every corpus label flows through the VisualLabelV1 contract: the four
      // states keep their meaning, the origin is the measured oracle, and only
      // an adjudicated record can produce trainer labels.
      const labelRecord = validateVisualLabel({
        schemaVersion: 'arxic-visual-label-v1',
        caseId: extracted.caseId,
        regionId: region.id,
        evidenceSha256: extracted.manifestSha256,
        splitGroup: extracted.group,
        labels: states,
        labelOrigin: 'deterministic_predicate',
        adjudication: 'adjudicated',
        criterion: region.criterion,
        reviewer: null,
      });
      rows.push({
        id: `${extracted.caseId}-${region.id}`,
        group: extracted.group,
        split: entry.split,
        features: region.values,
        labels: toTrainingLabels(labelRecord),
      });
      evidence.push({
        id: `${extracted.caseId}-${region.id}`,
        label: labelRecord satisfies VisualLabel,
        manifest: entry.manifest,
        manifestSha256: extracted.manifestSha256,
        family: entry.family,
        variant: entry.variant,
        viewport: entry.viewport,
        measuredClip: entry.measuredClip,
        measuredOverflowX: entry.measuredOverflowX,
        labelOrigin: entry.labelOrigin,
        criterion: region.criterion,
        hardChecks: extracted.hardChecks,
      });
    }
  }
  return { rows, evidence };
}

export async function trainCorpusV2(root: string, output: string, manifest: CorpusV2Manifest) {
  const { rows, evidence } = await buildLabeledRows(output, manifest);
  const dataset = await save(output, 'dataset.json', rows);
  await save(output, 'dataset-provenance.json', {
    version: 1,
    datasetSha256: dataset.sha256,
    corpusManifest: 'corpus-v2.json',
    frozenAllocationHash: manifest.plan.frozenAllocationHash,
    evidence,
  });
  const { training, parityMaximumError, reviews } = await runTraining(
    root,
    output,
    rows,
    manifest.cases,
    dataset.sha256,
  );
  const report = {
    version: 1,
    rows: rows.length,
    families: manifest.plan.families,
    allocation: manifest.plan.allocation,
    frozenAllocationHash: manifest.plan.frozenAllocationHash,
    skipped: manifest.skipped,
    parityMaximumError,
    reviews,
    training,
    promotion: 'blocked-experimental-model',
    coverage:
      'six controlled heads (clipping, occlusion, missing_element, overflow, text_truncation, layout_shift); hypothesis-only model',
    noTeacherCalls: true,
  };
  await save(output, 'corpus-report.json', report);
  return report;
}
