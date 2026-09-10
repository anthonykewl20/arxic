import type { Capture, Project, Run } from './types';
import { checkWords, type Words } from './plain-words';

/**
 * The pages of a site, assembled for people rather than for the engine.
 *
 * The dashboard's inventory used to be the source tier's route table: one row
 * per HTTP method per path, so `/albums` appeared five times and `POST
 * /api/albums` — which nobody can look at — sat beside `/login`, which
 * everybody can. That table is the right shape for reasoning about coverage
 * and the wrong shape for the question people actually arrive with, which is
 * "what does my sign-in page look like, and is it still right".
 *
 * A page here is something a browser can open and a camera can photograph:
 * a path the operator configured, a path the crawler reached, or a path that
 * already has a screenshot. API endpoints are not pages and are not in here;
 * they keep their place in the coverage view, where the route table belongs.
 *
 * Everything is derived from the state snapshot the dashboard already polls —
 * no extra request, no engine change. Pure, so it can be tested without a
 * browser.
 */

/**
 * Checks whose measurement is unconditional, so their absence really is a pass.
 *
 * Text contrast is deliberately not in here: it is measured only when the
 * capture yielded text-paint evidence, so "no finding" does not prove "no
 * problem" and reporting a pass would claim more than was measured. It appears
 * on a page when it fails and never when it does not.
 */
const alwaysMeasured = [
  'broken-images',
  'unlabeled-inputs',
  'undecodable-images',
  'script-errors',
  'http-errors',
] as const;

/**
 * Measured from the same evidence, but only meaningful once the page held
 * still: an unstable capture measured nothing reliably, so the claim is
 * withdrawn rather than reported clean.
 */
const measuredWhenStable = 'horizontal-overflow';

export type PageStatus = 'untested' | 'needs-review' | 'problem' | 'first-look' | 'ok';

/** Attention first, then gaps, then the pages that are fine. */
const statusRank: Record<PageStatus, number> = {
  'needs-review': 0,
  problem: 1,
  untested: 2,
  'first-look': 3,
  ok: 4,
};

export type PageShot = {
  capture: Capture;
  runId: string;
  /** 'Normal', or what state was provoked to produce this frame. */
  state: string;
};

export type PageEntry = {
  /** Stable across renders and unique across projects. */
  key: string;
  projectId: string;
  projectName: string;
  /** Which copy of the site this page lives on; absent means development. */
  environment: Project['environment'];
  /** The project's GitHub origin, so a source file can link to itself. */
  repositoryUrl?: string;
  path: string;
  /** The page's name in words: '/login' reads as 'Sign in'. */
  title: string;
  /** Where the browser would go, when the project has a target origin. */
  url: string;
  /** Configured by the operator, reached by the crawler, or both. */
  found: 'configured' | 'discovered' | 'both';
  status: PageStatus;
  /** The run these screenshots and checks came from. */
  runId?: string;
  checkedAt?: string;
  captures: Capture[];
  /** One frame per state, normal first: the page's own filmstrip. */
  shots: PageShot[];
  /** The frame to show on the card. */
  thumbnail?: PageShot;
  browsers: string[];
  themes: string[];
  sizes: Array<{ width: number; height: number }>;
  states: string[];
  /** Screenshots differing from their approved picture, awaiting a decision. */
  needsReview: number;
  /** Those same screenshots: what a reviewer still has to look at. */
  pending: Capture[];
  firstLook: number;
  unsettled: number;
  /** Whether the page was reached as a signed-in user. */
  signedIn: boolean;
  failing: Words[];
  passing: Words[];
};

const dynamic = /^(?::|\[|\{|\*|<)/u;
const titleCase = (value: string) =>
  value
    .replace(/[-_]+/gu, ' ')
    .replace(/([a-z\d])([A-Z])/gu, '$1 $2')
    .trim()
    .replace(/^./u, (character) => character.toUpperCase());

/** Names people already use for the pages every site has. */
const knownPages: Record<string, string> = {
  login: 'Sign in',
  signin: 'Sign in',
  'sign-in': 'Sign in',
  logout: 'Sign out',
  signout: 'Sign out',
  register: 'Create account',
  signup: 'Create account',
  'sign-up': 'Create account',
  'forgot-password': 'Forgot password',
  'reset-password': 'Reset password',
  settings: 'Settings',
  profile: 'Profile',
  account: 'Account',
  search: 'Search',
  admin: 'Admin',
  dashboard: 'Dashboard',
  about: 'About',
  contact: 'Contact',
  pricing: 'Pricing',
  cart: 'Basket',
  checkout: 'Checkout',
  'not-found': 'Not found',
  404: 'Not found',
};

const singular = (value: string) => (/s$/iu.test(value) ? value.slice(0, -1) : value);

/**
 * A path, said out loud.
 *
 * `/` is Home. A dynamic last segment describes what it is a page *of*, so
 * `/albums/:id` reads as "Album detail" rather than ": id". Everything else is
 * its own last segment, title-cased.
 */
export function humanizePath(path: string): string {
  const segments = path.split('?')[0]!.split('#')[0]!.split('/').filter(Boolean);
  if (!segments.length) return 'Home';
  const last = segments[segments.length - 1]!;
  if (!dynamic.test(last)) return knownPages[last.toLowerCase()] ?? titleCase(last);
  const parent = segments[segments.length - 2];
  return parent && !dynamic.test(parent) ? `${titleCase(singular(parent))} detail` : 'Detail';
}

const environmentOf = (capture: Capture) =>
  capture.environment ?? { browser: 'chromium' as const, colorScheme: 'light' as const };

/**
 * Newest first is how runs arrive, so the first match is the latest. A page's
 * evidence is one run's worth: mixing screenshots from different runs into one
 * card would present a page as more current than it is.
 */
const latestRun = (runs: Run[], projectId: string, has: (run: Run) => boolean) =>
  runs.find((run) => run.projectId === projectId && has(run));

export function buildPageInventory(input: {
  projects: Project[];
  runs: Run[];
  projectId?: string;
  /** Current baseline pointers, so an approved change stops being pending. */
  baselines?: Array<{ run_id: string; capture_id: string }>;
}): PageEntry[] {
  // Approving IS the decision. A capture keeps `status: 'changed'` for ever —
  // it is the record of what that run measured — so a queue keyed on status
  // alone would ask the same question again after it had been answered.
  const decided = new Set(
    (input.baselines ?? []).map((pointer) => `${pointer.run_id}\u0000${pointer.capture_id}`),
  );
  const pages: PageEntry[] = [];
  for (const project of input.projects) {
    if (input.projectId && project.id !== input.projectId) continue;
    const evidence = latestRun(input.runs, project.id, (run) => !!run.result?.captures?.length);
    const crawl = latestRun(input.runs, project.id, (run) => !!run.result?.discoveredPaths?.length);
    const configured = new Set(project.paths);
    const discovered = new Set(crawl?.result?.discoveredPaths ?? []);
    const captured = evidence?.result?.captures ?? [];
    const findings = evidence?.result?.findings ?? [];
    const paths = [
      ...new Set([...configured, ...discovered, ...captured.map((capture) => capture.path)]),
    ].sort();
    const titles = new Map<string, number>();
    for (const path of paths) {
      const title = humanizePath(path);
      titles.set(title, (titles.get(title) ?? 0) + 1);
    }
    for (const path of paths) {
      // A page cropped out of another page is evidence about that page, not a
      // page of its own; it belongs on the parent's detail, not the grid.
      const captures = captured.filter(
        (capture) => capture.path === path && !capture.isolatedRegion,
      );
      const shots = captures
        .map((capture) => ({
          capture,
          runId: evidence!.id,
          state: capture.stateVariant ?? '',
        }))
        // Normal first, then the provoked states in the order they were declared.
        .sort((left, right) => Number(!!left.state) - Number(!!right.state));
      // One finding per kind, not one per capture. A page photographed on
      // desktop and on a phone reports "1 field has no label" from each, and
      // listing the same sentence twice reads as two separate defects.
      const worst = new Map<string, number>();
      for (const finding of findings)
        if (finding.path === path)
          worst.set(finding.kind, Math.max(worst.get(finding.kind) ?? 0, finding.count));
      const kinds = [...worst].map(([kind, count]) => ({ kind, count }));
      const unsettled = captures.filter((capture) => capture.status === 'unstable').length;
      const failing = kinds.map((finding) => checkWords(finding.kind, finding.count));
      const passing = [...alwaysMeasured, ...(unsettled ? [] : [measuredWhenStable])]
        .filter((kind) => captures.length && !kinds.some((finding) => finding.kind === kind))
        .map((kind) => checkWords(kind, 0, true));
      const pending = captures.filter(
        (capture) =>
          capture.status === 'changed' && !decided.has(`${evidence!.id}\u0000${capture.id}`),
      );
      const needsReview = pending.length;
      const firstLook = captures.filter((capture) => capture.status === 'needs-baseline').length;
      const status: PageStatus = !captures.length
        ? 'untested'
        : needsReview
          ? 'needs-review'
          : failing.some((check) => check.tone === 'problem') || unsettled
            ? 'problem'
            : firstLook === captures.length
              ? 'first-look'
              : 'ok';
      const bare = humanizePath(path);
      const parent = path.split('/').filter(Boolean).slice(-2, -1)[0];
      pages.push({
        key: `${project.id}::${path}`,
        projectId: project.id,
        projectName: project.name,
        environment: project.environment,
        ...(project.repositoryUrl ? { repositoryUrl: project.repositoryUrl } : {}),
        path,
        // Two pages called "Profile" in one project help nobody; the parent
        // segment disambiguates only where it has to.
        title:
          (titles.get(bare) ?? 0) > 1 && parent && !dynamic.test(parent)
            ? `${titleCase(parent)} · ${bare}`
            : bare,
        url: project.origin ? `${project.origin.replace(/\/$/u, '')}${path}` : '',
        found:
          configured.has(path) && discovered.has(path)
            ? 'both'
            : discovered.has(path)
              ? 'discovered'
              : 'configured',
        status,
        ...(captures.length ? { runId: evidence!.id } : {}),
        ...(captures.length && evidence?.finishedAt ? { checkedAt: evidence.finishedAt } : {}),
        captures,
        shots,
        ...(shots[0] ? { thumbnail: shots[0] } : {}),
        browsers: [...new Set(captures.map((capture) => environmentOf(capture).browser))].sort(),
        themes: [...new Set(captures.map((capture) => environmentOf(capture).colorScheme))].sort(),
        sizes: [
          ...new Map(
            captures.map((capture) => [
              `${capture.viewport.width}x${capture.viewport.height}`,
              capture.viewport,
            ]),
          ).values(),
        ].sort((left, right) => left.width - right.width),
        states: [...new Set(captures.map((capture) => capture.stateVariant ?? ''))],
        needsReview,
        pending,
        firstLook,
        unsettled,
        signedIn: captures.some((capture) => capture.authenticated),
        failing,
        passing,
      });
    }
  }
  return pages.sort(
    (left, right) =>
      statusRank[left.status] - statusRank[right.status] ||
      left.projectName.localeCompare(right.projectName) ||
      left.path.localeCompare(right.path),
  );
}

/** One screenshot waiting for a decision, with the page it belongs to. */
export type PendingChange = { page: PageEntry; capture: Capture; runId: string };

/**
 * Everything a reviewer has to decide on, newest evidence first.
 *
 * The queue is the product's core loop — Percy, Chromatic and Argos all build
 * their product around it — so it is derived once here and shown wherever a
 * count or a list of pending decisions is needed.
 */
export function pendingChanges(pages: PageEntry[]): PendingChange[] {
  return pages.flatMap((page) =>
    page.runId ? page.pending.map((capture) => ({ page, capture, runId: page.runId! })) : [],
  );
}
