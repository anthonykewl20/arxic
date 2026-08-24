import { randomUUID } from 'node:crypto';
import type {
  Diagnostic,
  DiscoveryRequest,
  EvidenceEvent,
  EvidenceRefRuntime,
  SurfaceDiscoverer,
} from '@arxic/contracts';
import {
  Configuration,
  PlaywrightCrawler,
  RequestQueue,
  createPlaywrightRouter,
  type PlaywrightCrawlingContext,
} from 'crawlee';
import {
  ARXIC_SURFACE_BUILD_UNATTESTED,
  ARXIC_SURFACE_EXTERNAL_ORIGIN,
  ARXIC_SURFACE_FORM_SUBMIT_BLOCKED,
  ARXIC_SURFACE_FRONTIER_STOP,
  ARXIC_SURFACE_MUTATION_BLOCKED,
  ARXIC_SURFACE_NAVIGATION_FAILED,
  ARXIC_SURFACE_ORIGIN_INVALID,
  ARXIC_SURFACE_PERSONA_SERIALIZED,
  surfaceDiagnostic,
} from './diagnostics';
import { codepointCompare } from './serialize';
import type {
  NavigationEdge,
  RouteSurface,
  SurfaceControl,
  SurfaceDiscovererOptions,
  SurfaceDiscoveryRequest,
  SurfaceForm,
  SurfaceLink,
  SurfaceMap,
} from './types';

const DEFAULT_MAX_URLS = 50;
const DEFAULT_MAX_DEPTH = 3;
const BUILD_DIGEST = /^[a-f0-9]{64}$/;
const identityTails = new Map<string, Promise<void>>();

type PageInventory = {
  title: string;
  forms: SurfaceForm[];
  controls: SurfaceControl[];
  links: Array<{ href: string; text: string }>;
};

/**
 * DG-289 (#289, SURFACE-005): this callback is serialized into the page by
 * `page.evaluate` (Playwright ships `Function.toString()` and evaluates it in
 * the page context). It MUST stay serialization-safe under esbuild-family
 * transforms that inject the `__name` helper for named inner functions — tsx
 * does, and at baseline this body declared `labelOf`/`control` as named
 * inner arrows, so the transform embedded `__name(...)` calls inside the
 * serialized source and every tsx-lane crawl died at the root with
 * `ReferenceError: __name is not defined`. Rules for this body:
 *   - no named function bindings and no object shorthand methods;
 *   - no closure captures — only anonymous inline arrows, plain local
 *     non-function constants, and page globals (`document`,
 *     `HTMLInputElement`). The module-level binding below is safe: any
 *     keepNames wrap lands OUTSIDE the arrow body, so the serialized source
 *     stays clean.
 * Exported so the SP-1 regression test can assert under the tsx lane that
 * the serialized source contains no `__name`. The control-mapping literal is
 * deliberately duplicated for page controls and form controls — sharing it
 * would require exactly the named-helper shape that broke serialization.
 */
export const pageInventoryProbe = (): PageInventory => {
  const controls = [
    ...document.querySelectorAll('input,select,textarea,button,[role="button"]'),
  ].map((element) => {
    // DG-297 E1 (#297): label-first with a placeholder fallback — the same
    // semantics the verifier adopted in #295. Vanilla SPA targets ship
    // placeholder-only inputs, and an aria-label of the LITERAL string
    // "undefined"/"null" is an upstream binding artifact (observed on the
    // koel pin), not an honest label — treat it as absent so the placeholder
    // can carry the field. Serialization rules: plain consts + anonymous
    // arrows only (see the block comment above).
    const ariaLabel = element.getAttribute('aria-label')?.trim();
    const aria =
      ariaLabel && ariaLabel !== 'undefined' && ariaLabel !== 'null' ? ariaLabel : undefined;
    const label =
      aria ||
      (element instanceof HTMLInputElement && element.labels?.[0]?.textContent
        ? element.labels[0].textContent!.trim()
        : undefined) ||
      (element instanceof HTMLInputElement && element.placeholder?.trim()
        ? element.placeholder.trim()
        : undefined) ||
      element.textContent?.trim() ||
      undefined;
    return {
      tag: element.tagName.toLowerCase(),
      type:
        element.getAttribute('type')?.toLowerCase() ||
        element.getAttribute('role')?.toLowerCase() ||
        element.tagName.toLowerCase(),
      ...(element.getAttribute('name') ? { name: element.getAttribute('name')! } : {}),
      ...(label ? { label } : {}),
      required: element.hasAttribute('required'),
    };
  });
  return {
    title: document.title,
    controls,
    forms: [...document.forms].map((form) => ({
      action: form.action,
      method: form.method.toUpperCase(),
      destructive: form.method.toUpperCase() !== 'GET',
      controls: [...form.querySelectorAll('input,select,textarea,button')].map((element) => {
        // DG-297 E1 (#297): identical label-first/placeholder-fallback chain
        // as the page controls above — duplicated literal by design (sharing
        // it would need the named-helper shape that broke serialization).
        const formAriaLabel = element.getAttribute('aria-label')?.trim();
        const formAria =
          formAriaLabel && formAriaLabel !== 'undefined' && formAriaLabel !== 'null'
            ? formAriaLabel
            : undefined;
        const label =
          formAria ||
          (element instanceof HTMLInputElement && element.labels?.[0]?.textContent
            ? element.labels[0].textContent!.trim()
            : undefined) ||
          (element instanceof HTMLInputElement && element.placeholder?.trim()
            ? element.placeholder.trim()
            : undefined) ||
          element.textContent?.trim() ||
          undefined;
        return {
          tag: element.tagName.toLowerCase(),
          type:
            element.getAttribute('type')?.toLowerCase() ||
            element.getAttribute('role')?.toLowerCase() ||
            element.tagName.toLowerCase(),
          ...(element.getAttribute('name') ? { name: element.getAttribute('name')! } : {}),
          ...(label ? { label } : {}),
          required: element.hasAttribute('required'),
        };
      }),
    })),
    links: [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].map((link) => ({
      href: link.href,
      text: link.textContent?.trim() ?? '',
    })),
  };
};

export class CrawleeSurfaceDiscoverer implements SurfaceDiscoverer {
  readonly #options: Required<Omit<SurfaceDiscovererOptions, 'browserExecutablePath'>> &
    Pick<SurfaceDiscovererOptions, 'browserExecutablePath'>;

  constructor(options: SurfaceDiscovererOptions = {}) {
    this.#options = {
      maxConcurrency: Math.max(1, Math.floor(options.maxConcurrency ?? 2)),
      maxRequestRetries: Math.max(0, Math.floor(options.maxRequestRetries ?? 2)),
      navigationTimeoutSecs: Math.max(1, options.navigationTimeoutSecs ?? 30),
      // DG-297 E1: bounded per-URL wait for hydration to commit a form.
      hydrationSettleMs: Math.max(0, options.hydrationSettleMs ?? 2_500),
      now: options.now ?? (() => new Date().toISOString()),
      runId: options.runId ?? randomUUID,
      browserExecutablePath: options.browserExecutablePath,
    };
  }

  async *discover(input: DiscoveryRequest): AsyncIterable<EvidenceEvent> {
    const map = await this.collect(input);
    for (const route of map.routes) if (route.evidence) yield { ref: route.evidence };
    for (const diagnostic of map.diagnostics) yield { diagnostic };
  }

  async collect(input: SurfaceDiscoveryRequest): Promise<SurfaceMap> {
    const normalized = normalizeInput(input);
    if (!normalized.ok) return emptyMap(input.origin, normalized.diagnostic);
    const identityKeys = [
      ...new Set(input.personas?.length ? input.personas : [`anonymous@${normalized.origin}`]),
    ].sort(codepointCompare);
    const releases: Array<() => void> = [];
    let contended = false;
    try {
      for (const identity of identityKeys) {
        const lock = await acquireIdentity(identity);
        releases.unshift(lock.release);
        contended ||= lock.contended;
      }
      return await this.#collectLocked(
        { ...input, origin: normalized.origin },
        contended,
        identityKeys,
      );
    } finally {
      for (const release of releases) release();
    }
  }

  async #collectLocked(
    input: SurfaceDiscoveryRequest,
    contended: boolean,
    identities: string[],
  ): Promise<SurfaceMap> {
    const maxUrls = positiveInteger(input.maxUrls, DEFAULT_MAX_URLS);
    const maxDepth = nonnegativeInteger(input.maxDepth, DEFAULT_MAX_DEPTH);
    // DG-289 C-4 (#289): the browser request origin gate below admits exactly
    // these origins — the target origin plus config-declared
    // `allowedOrigins` (fail-closed default: target origin only, byte-
    // identical to the pre-wiring baseline when the declaration is
    // unset/empty). Crawl FOLLOWING stays same-origin by design; declared
    // origins license ASSETS during discovery.
    const admittedOrigins = allowedCrawlOrigins(input);
    const runId = this.#options.runId();
    const diagnostics: Diagnostic[] = [];
    const diagnosticKeys = new Set<string>();
    const routesByUrl = new Map<string, RouteSurface>();
    const navigationEdges: NavigationEdge[] = [];
    const scheduled = new Set<string>([canonicalUrl(input.origin)]);
    const addDiagnostic = (diagnostic: Diagnostic) => {
      const key = `${diagnostic.code}\0${diagnostic.subject}`;
      if (diagnosticKeys.has(key)) return;
      diagnosticKeys.add(key);
      diagnostics.push(diagnostic);
    };
    if (contended) {
      addDiagnostic(
        surfaceDiagnostic(
          ARXIC_SURFACE_PERSONA_SERIALIZED,
          'blocked',
          identities.join(','),
          'A concurrent crawl requested the same mutable persona; this crawl waited for exclusive access.',
        ),
      );
    }
    const appBuildDigest = await resolveBuildDigest(input, addDiagnostic);
    const crawlConcurrency = input.personas?.length ? 1 : this.#options.maxConcurrency;
    const config = new Configuration({ persistStorage: false, purgeOnStart: true });
    const queue = await RequestQueue.open(
      `arxic-surface-${runId.replaceAll(/[^a-zA-Z0-9-]/g, '-')}`,
      { config },
    );
    await queue.addRequest({ url: canonicalUrl(input.origin), userData: { depth: 0 } });
    const router = createPlaywrightRouter();
    router.addDefaultHandler(async (context: PlaywrightCrawlingContext) => {
      const { page, request } = context;
      const depth = Number(request.userData.depth ?? 0);
      const finalUrl = canonicalUrl(page.url());
      if (!sameOrigin(finalUrl, input.origin)) {
        addDiagnostic(
          surfaceDiagnostic(
            ARXIC_SURFACE_EXTERNAL_ORIGIN,
            'blocked',
            finalUrl,
            `Navigation outside ${input.origin} was blocked.`,
          ),
        );
        return;
      }
      // DG-297 E1 (#297): SPA targets render their forms only AFTER
      // hydration, which commits after the load event (observed on both
      // ratified DG-12 targets — the probe-at-load saw zero forms). Wait
      // bounded for A form to attach before probing; pages whose forms are
      // already present resolve instantly, form-less pages pay the settle
      // once, and a target that never renders still probes (honestly empty)
      // instead of failing navigation.
      await page
        .waitForSelector('form', { state: 'attached', timeout: this.#options.hydrationSettleMs })
        .catch(() => undefined);
      const inventory = await page.evaluate<PageInventory>(pageInventoryProbe);
      const links: SurfaceLink[] = inventory.links
        .map((link) => ({
          ...link,
          href: canonicalUrl(link.href),
          external: !sameOrigin(link.href, input.origin),
        }))
        .sort((left, right) => codepointCompare(left.href, right.href));
      for (const form of inventory.forms.filter((candidate) => candidate.destructive)) {
        addDiagnostic(
          surfaceDiagnostic(
            ARXIC_SURFACE_FORM_SUBMIT_BLOCKED,
            'blocked',
            form.action,
            `Breadth discovery observed a ${form.method} form and did not submit it (default-deny mutation policy).`,
          ),
        );
      }
      const evidence: EvidenceRefRuntime | undefined = appBuildDigest
        ? {
            kind: 'runtime',
            runId,
            appBuildDigest,
            browser: 'chromium',
            browserVersion: page.context().browser()?.version() ?? 'unknown',
            url: finalUrl,
            timestamp: this.#options.now(),
          }
        : undefined;
      const surface: RouteSurface = {
        truthState: 'observed',
        url: finalUrl,
        path: new URL(finalUrl).pathname,
        depth,
        title: inventory.title,
        forms: inventory.forms,
        controls: inventory.controls,
        links,
        ...(evidence ? { evidence } : {}),
      };
      const existing = routesByUrl.get(finalUrl);
      if (!existing || depth < existing.depth) routesByUrl.set(finalUrl, surface);
      for (const link of links) {
        const nextDepth = depth + 1;
        if (link.external) {
          navigationEdges.push({
            from: finalUrl,
            to: link.href,
            depth: nextDepth,
            status: 'blocked',
            reason: 'external-origin',
          });
          addDiagnostic(
            surfaceDiagnostic(
              ARXIC_SURFACE_EXTERNAL_ORIGIN,
              'blocked',
              link.href,
              `External link was inventoried but not followed; allowed origin is ${input.origin}.`,
            ),
          );
          continue;
        }
        if (nextDepth > maxDepth) {
          navigationEdges.push({
            from: finalUrl,
            to: link.href,
            depth: nextDepth,
            status: 'blocked',
            reason: 'max-depth',
          });
          addDiagnostic(
            surfaceDiagnostic(
              ARXIC_SURFACE_FRONTIER_STOP,
              'blocked',
              link.href,
              `Frontier stopped at maxDepth=${maxDepth}.`,
            ),
          );
          continue;
        }
        if (!scheduled.has(link.href) && scheduled.size >= maxUrls) {
          navigationEdges.push({
            from: finalUrl,
            to: link.href,
            depth: nextDepth,
            status: 'blocked',
            reason: 'max-urls',
          });
          addDiagnostic(
            surfaceDiagnostic(
              ARXIC_SURFACE_FRONTIER_STOP,
              'blocked',
              link.href,
              `Frontier stopped at maxUrls=${maxUrls}.`,
            ),
          );
          continue;
        }
        navigationEdges.push({
          from: finalUrl,
          to: link.href,
          depth: nextDepth,
          status: 'observed',
        });
        if (!scheduled.has(link.href)) {
          scheduled.add(link.href);
          await queue.addRequest({ url: link.href, userData: { depth: nextDepth } });
        }
      }
    });
    const crawler = new PlaywrightCrawler(
      {
        requestQueue: queue,
        requestHandler: router,
        maxConcurrency: crawlConcurrency,
        // URL cardinality is enforced before enqueue. Leave room for bounded retries of those URLs.
        maxRequestsPerCrawl: maxUrls * (this.#options.maxRequestRetries + 1),
        maxRequestRetries: this.#options.maxRequestRetries,
        navigationTimeoutSecs: this.#options.navigationTimeoutSecs,
        useSessionPool: true,
        sessionPoolOptions: { maxPoolSize: crawlConcurrency },
        launchContext: {
          // Crawlee 3.18 passes these options to Playwright's persistent BrowserContext.
          // Preserve that shared context for crawl cookies while blocking registration before
          // worker-owned traffic could bypass page.route().
          useIncognitoPages: false,
          launchOptions: {
            headless: true,
            serviceWorkers: 'block',
            ...(this.#options.browserExecutablePath
              ? { executablePath: this.#options.browserExecutablePath }
              : {}),
          },
        },
        preNavigationHooks: [
          async ({ page }) => {
            await page.route('**/*', async (route) => {
              const url = route.request().url();
              if (
                /^https?:/u.test(url) &&
                !admittedOrigins.some((allowed) => sameOrigin(url, allowed))
              ) {
                addDiagnostic(
                  surfaceDiagnostic(
                    ARXIC_SURFACE_EXTERNAL_ORIGIN,
                    'blocked',
                    url,
                    `Browser request outside ${input.origin} was aborted.`,
                  ),
                );
                await route.abort('blockedbyclient');
                return;
              }
              const method = route.request().method().toUpperCase();
              if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
                addDiagnostic(
                  surfaceDiagnostic(
                    ARXIC_SURFACE_MUTATION_BLOCKED,
                    'blocked',
                    url,
                    `${method} request to ${url} was aborted (default-deny mutation policy; only safe methods GET/HEAD/OPTIONS are permitted during breadth discovery)`,
                  ),
                );
                await route.abort('blockedbyclient');
                return;
              }
              await route.continue();
            });
            await page.routeWebSocket('**/*', async (socket) => {
              if (!sameNetworkAuthority(socket.url(), input.origin)) {
                addDiagnostic(
                  surfaceDiagnostic(
                    ARXIC_SURFACE_EXTERNAL_ORIGIN,
                    'blocked',
                    socket.url(),
                    `WebSocket outside ${input.origin} was closed before connection.`,
                  ),
                );
                await socket.close({ code: 1008, reason: 'Origin policy' });
              } else socket.connectToServer();
            });
          },
        ],
        postNavigationHooks: [
          async ({ request, response }) => {
            const status = response?.status();
            if (status && (status === 408 || status === 425 || status === 429 || status >= 500)) {
              throw new Error(`Transient HTTP ${status} while navigating ${request.url}`);
            }
          },
        ],
        failedRequestHandler: async ({ request }, error) => {
          addDiagnostic(
            surfaceDiagnostic(
              ARXIC_SURFACE_NAVIGATION_FAILED,
              'observed',
              request.url,
              `Navigation failed after ${this.#options.maxRequestRetries + 1} bounded attempts: ${error.message}`,
            ),
          );
        },
      },
      config,
    );
    try {
      await crawler.run();
    } finally {
      try {
        await queue.drop();
      } catch (error) {
        void error;
      }
    }
    diagnostics.sort((left, right) =>
      codepointCompare(`${left.code}\0${left.subject}`, `${right.code}\0${right.subject}`),
    );
    const routes = [...routesByUrl.values()].sort((left, right) =>
      codepointCompare(left.url, right.url),
    );
    const deduplicatedEdges = new Map<string, NavigationEdge>();
    for (const edge of navigationEdges) {
      const key = `${edge.from}\0${edge.to}\0${edge.status}\0${edge.reason ?? ''}`;
      const existing = deduplicatedEdges.get(key);
      if (!existing || edge.depth < existing.depth) deduplicatedEdges.set(key, edge);
    }
    navigationEdges.splice(0, navigationEdges.length, ...deduplicatedEdges.values());
    navigationEdges.sort((left, right) =>
      codepointCompare(
        `${left.from}\0${left.to}\0${left.status}\0${left.reason ?? ''}\0${left.depth}`,
        `${right.from}\0${right.to}\0${right.status}\0${right.reason ?? ''}\0${right.depth}`,
      ),
    );
    return {
      schemaVersion: 1,
      truthState: 'observed',
      origin: input.origin,
      routes,
      navigationEdges,
      diagnostics,
    };
  }
}

async function resolveBuildDigest(
  input: SurfaceDiscoveryRequest,
  addDiagnostic: (diagnostic: Diagnostic) => void,
): Promise<string | undefined> {
  if (input.appBuildDigest && BUILD_DIGEST.test(input.appBuildDigest)) return input.appBuildDigest;
  try {
    const response = await fetch(`${input.origin}/.well-known/arxic-test-target.json`, {
      signal: AbortSignal.timeout(8_000),
      redirect: 'manual',
    });
    const value = (await response.json()) as { buildDigest?: unknown; origin?: unknown };
    if (
      response.ok &&
      value.origin === input.origin &&
      typeof value.buildDigest === 'string' &&
      BUILD_DIGEST.test(value.buildDigest)
    )
      return value.buildDigest;
  } catch {
    // The stable diagnostic below is the contract-visible result.
  }
  addDiagnostic(
    surfaceDiagnostic(
      ARXIC_SURFACE_BUILD_UNATTESTED,
      'blocked',
      input.origin,
      'No valid same-origin app build digest was available; surfaces are collected but runtime EvidenceRefs are withheld.',
    ),
  );
  return undefined;
}

function normalizeInput(
  input: DiscoveryRequest,
): { ok: true; origin: string } | { ok: false; diagnostic: Diagnostic } {
  try {
    const url = new URL(input.origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error(
        'origin must be an HTTP(S) origin without credentials, path, query, or fragment',
      );
    return { ok: true, origin: url.origin };
  } catch (error) {
    const subject = input.origin && input.origin.trim() ? input.origin : '<empty-origin>';
    return {
      ok: false,
      diagnostic: surfaceDiagnostic(
        ARXIC_SURFACE_ORIGIN_INVALID,
        'blocked',
        subject,
        error instanceof Error ? error.message : 'Invalid discovery origin.',
      ),
    };
  }
}

function emptyMap(origin: string, diagnostic: Diagnostic): SurfaceMap {
  return {
    schemaVersion: 1,
    truthState: 'observed',
    origin,
    routes: [],
    navigationEdges: [],
    diagnostics: [diagnostic],
  };
}

function canonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  return url.href.endsWith('/') && url.pathname !== '/' ? url.href.slice(0, -1) : url.href;
}

/**
 * DG-289 C-4 (#289, DECISION issuecomment-5360240026): the crawl origin gate
 * admits exactly the target origin plus config-declared `allowedOrigins`.
 * Fail-closed default — unset or empty declaration yields the target origin
 * ONLY (byte-identical to baseline). Declared entries must be bare origins
 * to ever match: `sameOrigin` compares URL origins, so an entry carrying a
 * path or credentials is inert (it admits nothing). Config validation
 * (apps/cli/src/config/validate.ts) rejects non-absolute-URL and empty
 * declarations at load with a stable diagnostic; an origin-not-listed check
 * additionally requires the target origin to be declared.
 */
export function allowedCrawlOrigins(input: SurfaceDiscoveryRequest): string[] {
  if (!input.allowedOrigins || input.allowedOrigins.length === 0) return [input.origin];
  return [...new Set([input.origin, ...input.allowedOrigins])];
}

function sameOrigin(value: string, origin: string): boolean {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

function sameNetworkAuthority(value: string, origin: string): boolean {
  try {
    return new URL(value).host === new URL(origin).host;
  } catch {
    return false;
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
}

function nonnegativeInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

async function acquireIdentity(key: string): Promise<{ contended: boolean; release: () => void }> {
  const predecessor = identityTails.get(key);
  let resolveCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    resolveCurrent = resolve;
  });
  identityTails.set(key, current);
  if (predecessor) await predecessor;
  return {
    contended: predecessor !== undefined,
    release: () => {
      resolveCurrent();
      if (identityTails.get(key) === current) identityTails.delete(key);
    },
  };
}
