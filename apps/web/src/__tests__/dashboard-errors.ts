import type { Page } from 'playwright';

/**
 * Corroborated classification of WebKit driver fetch-load diagnostics (#447).
 *
 * WebKit's `ThreadableLoader::logError` skips cancellations but logs
 * `Fetch API cannot load <url> due to access control checks.` as a JS-source
 * error console message when `CachedResourceLoader`'s synchronous failure path
 * converts a fetch initiated mid-teardown into an access-control error, and
 * Playwright's WebKit driver maps JS-source error console messages to
 * `pageerror`. Such an event belongs to an outgoing document, not to an
 * application defect — but the same driver shape also appears for real
 * active-page failures and can be forged by thrown look-alikes, so the message
 * shape alone must never waive anything.
 *
 * Driver delivery order cannot be trusted for corroboration: the pageerror can
 * arrive before the outgoing document's `pagehide` console marker and before
 * the replacing document's commit event. Classification is therefore deferred
 * to query time over timestamped facts.
 *
 * A fetch-load-shaped `pageerror` is classified `outgoing-document-fetch` only
 * when ALL of the following corroborate within a bounded window on either side:
 *  1. the event matches the exact `logError` console-text shape, and
 *  2. its URL is a known dashboard GET API endpoint, and
 *  3. an outgoing-document teardown marker (native `pagehide` or a main-frame
 *     navigation commit) exists, and
 *  4. no request to the SAME endpoint failed for a non-cancellation reason —
 *     every active failed request has such a `requestfailed` record, while the
 *     teardown fetch fails synchronously before dispatch (this also holds for
 *     the original incident shape: a single interval fetch racing a reload
 *     with no sibling in flight), and
 *  5. no native `error`/`unhandledrejection` marker exists.
 * Every other pageerror stays a hard error, exactly as before.
 */

const FETCH_LOAD_SHAPE =
  /^Fetch API cannot load (https?:\/\/[^\s]+) due to access control checks\.$/;
const KNOWN_API_PATHS = ['/api/state', '/api/session', '/api/runs'] as const;
const CORROBORATION_WINDOW_MS = 2000;

/**
 * Playwright's WebKit driver splits the console text into `name`/`message` at
 * the first colon — inside the URL's `http://`. Observed split: name
 * `Fetch API cannot load http`, message `/127.0.0.1:<port>/... due to access
 * control checks.`, i.e. the original text is `name + ":/" + message`; the
 * other variants guard against neighbouring split points.
 */
function fetchLoadTexts(name: string, message: string): string[] {
  return [`${name}:/${message}`, `${name}:${message}`, `${name}: ${message}`];
}

/** Exact WebKit `ThreadableLoader::logError` console-text shape test. */
export function isFetchLoadShape(name: string, message: string): boolean {
  return fetchLoadTexts(name, message).some((text) => FETCH_LOAD_SHAPE.test(text));
}

export type DashboardErrorEvent =
  | { kind: 'hard'; name: string; message: string }
  | { kind: 'outgoing-document-fetch'; endpoint: string };

export type DashboardErrorTraceKind =
  | 'pageerror'
  | 'hard'
  | 'outgoing-document-fetch'
  | 'native-ready'
  | 'native-hide'
  | 'native-error'
  | 'native-rejection'
  | 'main-frame-navigated'
  | 'request-cancelled';

export type DashboardErrorTrace = {
  sequence: number;
  kind: DashboardErrorTraceKind;
  endpoint?: string;
};

export type DashboardErrors = {
  /** Classification of every pageerror in arrival order. */
  events(): DashboardErrorEvent[];
  /** Everything a plain no-error check must still fail on. */
  hard(): Array<{ name: string; message: string }>;
  /** Corroborated outgoing-document diagnostics; never a waiver for anything else. */
  waived(): Array<{ endpoint: string }>;
  /** Sanitized ordinal trace (closed categories only; no URLs, payloads or stacks). */
  trace(): DashboardErrorTrace[];
};

type MarkerKind = 'native-hide' | 'native-error' | 'native-rejection' | 'main-frame-navigated';
type Marker = { kind: MarkerKind; time: number };
type FailedRequest = { endpoint: string; cancelled: boolean; time: number };
type RawPageError = { name: string; message: string; time: number };

export function trackDashboardErrors(page: Page): DashboardErrors {
  const trace: DashboardErrorTrace[] = [];
  const rawErrors: RawPageError[] = [];
  const markers: Marker[] = [];
  const failedRequests: FailedRequest[] = [];
  const endpointOf = (pathname: string) =>
    KNOWN_API_PATHS.find((path) => pathname === path || pathname.startsWith(`${path}?`));

  page.on('console', (message) => {
    const marker = message.text().split(':')[0] ?? '';
    if (marker === 'arxic-native-ready') {
      trace.push({ sequence: trace.length, kind: 'native-ready' });
      return;
    }
    if (marker === 'arxic-native-hide') {
      markers.push({ kind: 'native-hide', time: Date.now() });
      trace.push({ sequence: trace.length, kind: 'native-hide' });
      return;
    }
    if (marker === 'arxic-native-error' || marker === 'arxic-native-rejection') {
      const kind = marker === 'arxic-native-error' ? 'native-error' : 'native-rejection';
      markers.push({ kind, time: Date.now() });
      trace.push({ sequence: trace.length, kind });
    }
  });
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    markers.push({ kind: 'main-frame-navigated', time: Date.now() });
    trace.push({ sequence: trace.length, kind: 'main-frame-navigated' });
  });
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText ?? '';
    const cancelled = errorText.toLowerCase().includes('cancel');
    const pathname = (() => {
      try {
        return new URL(request.url()).pathname;
      } catch {
        return '';
      }
    })();
    const endpoint = endpointOf(pathname);
    if (!endpoint) return;
    failedRequests.push({ endpoint, cancelled, time: Date.now() });
    if (cancelled) trace.push({ sequence: trace.length, kind: 'request-cancelled', endpoint });
  });
  page.on('pageerror', (error) => {
    rawErrors.push({ name: error.name, message: error.message, time: Date.now() });
    trace.push({ sequence: trace.length, kind: 'pageerror' });
  });
  // Observation only: listeners record markers; no application state, request or
  // navigation is changed. Kept identical in spirit to the #451 probe script.
  void page.addInitScript(() => {
    console.info('arxic-native-ready');
    addEventListener('pagehide', () => console.info('arxic-native-hide'));
    addEventListener('error', () => console.info('arxic-native-error'));
    addEventListener('unhandledrejection', () => console.info('arxic-native-rejection'));
  });

  const classify = (): DashboardErrorEvent[] =>
    rawErrors.map((error) => {
      const match = fetchLoadTexts(error.name, error.message)
        .map((text) => FETCH_LOAD_SHAPE.exec(text))
        .find((found) => found !== null);
      if (!match) return { kind: 'hard', name: error.name, message: error.message };
      let url: URL;
      try {
        url = new URL(match[1] ?? '');
      } catch {
        return { kind: 'hard', name: error.name, message: error.message };
      }
      const endpoint = endpointOf(url.pathname);
      const windowStart = error.time - CORROBORATION_WINDOW_MS;
      const windowEnd = error.time + CORROBORATION_WINDOW_MS;
      const markersNear = markers.filter(
        (marker) => marker.time >= windowStart && marker.time <= windowEnd,
      );
      const requestsNear = failedRequests.filter(
        (request) => request.time >= windowStart && request.time <= windowEnd,
      );
      const corroborated =
        endpoint !== undefined &&
        !markersNear.some(
          (marker) => marker.kind === 'native-error' || marker.kind === 'native-rejection',
        ) &&
        markersNear.some(
          (marker) => marker.kind === 'native-hide' || marker.kind === 'main-frame-navigated',
        ) &&
        !requestsNear.some((request) => !request.cancelled && request.endpoint === endpoint);
      return corroborated && endpoint !== undefined
        ? { kind: 'outgoing-document-fetch', endpoint }
        : { kind: 'hard', name: error.name, message: error.message };
    });

  return {
    events: () => classify(),
    hard: () =>
      classify().filter(
        (event): event is { kind: 'hard'; name: string; message: string } => event.kind === 'hard',
      ),
    waived: () =>
      classify()
        .filter(
          (event): event is { kind: 'outgoing-document-fetch'; endpoint: string } =>
            event.kind === 'outgoing-document-fetch',
        )
        .map(({ endpoint }) => ({ endpoint })),
    trace: () => {
      // Replace provisional 'pageerror' ordinals with the current verdicts so
      // the retained record reflects the final classification.
      const verdicts = classify();
      let next = 0;
      return trace.map((entry) => {
        if (entry.kind !== 'pageerror') return entry;
        const verdict = verdicts[next++];
        if (!verdict || verdict.kind === 'hard') return { ...entry, kind: 'hard' as const };
        return {
          ...entry,
          kind: 'outgoing-document-fetch' as const,
          endpoint: verdict.endpoint,
        };
      });
    },
  };
}
