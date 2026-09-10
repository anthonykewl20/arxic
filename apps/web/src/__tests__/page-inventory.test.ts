import { expect, it } from 'vitest';
import { buildPageInventory, humanizePath, pendingChanges } from '../page-inventory';
import type { Capture, Project, Run } from '../types';

const project = (over: Partial<Project> = {}): Project =>
  ({
    id: 'p1',
    name: 'Koel',
    folder: '/srv/koel',
    origin: 'https://koel.test',
    paths: ['/', '/login'],
    viewports: [{ width: 1280, height: 800 }],
    masks: [],
    captureConsent: true,
    pageMode: 'discover',
    recordVideo: false,
    maxPages: 20,
    maxDepth: 2,
    configPath: '',
    cron: '',
    scheduleMode: 'visual',
    paused: false,
    nextRunAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as Project;

const capture = (over: Partial<Capture> = {}): Capture =>
  ({
    id: `c-${over.path ?? '/'}-${over.stateVariant ?? 'plain'}-${over.status ?? 'unchanged'}`,
    path: '/',
    viewport: { width: 1280, height: 800 },
    file: 'shot.png',
    sha256: 'a'.repeat(64),
    specHash: 'b'.repeat(64),
    browserVersion: '151',
    status: 'unchanged',
    ...over,
  }) as Capture;

const run = (over: Partial<Run> = {}): Run =>
  ({
    id: 'r1',
    projectId: 'p1',
    mode: 'visual',
    state: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:05:00.000Z',
    project: project(),
    result: { outcome: 'observed', summary: 'done' },
    ...over,
  }) as Run;

it('names a path the way a person would say it', () => {
  expect(humanizePath('/')).toBe('Home');
  expect(humanizePath('/login')).toBe('Sign in');
  expect(humanizePath('/forgot-password')).toBe('Forgot password');
  expect(humanizePath('/settings/profile')).toBe('Profile');
  expect(humanizePath('/albums/:id')).toBe('Album detail');
  expect(humanizePath('/users/[userId]')).toBe('User detail');
  expect(humanizePath('/reportBuilder')).toBe('Report Builder');
  expect(humanizePath('/help?topic=a#top')).toBe('Help');
  // Nothing to take a name from still gets a name, never an empty heading.
  expect(humanizePath('/:id')).toBe('Detail');
});

it('lists configured, crawled and photographed paths as one set of pages', () => {
  const pages = buildPageInventory({
    projects: [project({ paths: ['/', '/login'] })],
    runs: [
      run({
        result: {
          outcome: 'observed',
          summary: '',
          discoveredPaths: ['/', '/albums'],
          captures: [capture({ path: '/queue' })],
        },
      }),
    ],
  });
  expect(pages.map((page) => page.path).sort()).toEqual(['/', '/albums', '/login', '/queue']);
  expect(pages.find((page) => page.path === '/')!.found).toBe('both');
  expect(pages.find((page) => page.path === '/albums')!.found).toBe('discovered');
  expect(pages.find((page) => page.path === '/login')!.found).toBe('configured');
});

it('never lists an API endpoint, because nobody can look at one', () => {
  // The route table's `POST /api/albums` reaches this view only if something
  // navigated to it or photographed it, which is exactly the point.
  const pages = buildPageInventory({
    projects: [project({ paths: ['/', '/api/albums'] })],
    runs: [run({ result: { outcome: 'observed', summary: '', discoveredPaths: ['/albums'] } })],
  });
  // A path an operator configured is honoured — Arxic does not second-guess it —
  // but nothing invents endpoints that were never navigated to.
  expect(pages.map((page) => page.path)).toContain('/api/albums');
  expect(pages.some((page) => page.path.startsWith('POST'))).toBe(false);
});

it('puts the pages needing a decision first and the healthy ones last', () => {
  const pages = buildPageInventory({
    projects: [project({ paths: ['/fine', '/broken', '/changed', '/never-run'] })],
    runs: [
      run({
        result: {
          outcome: 'observed',
          summary: '',
          captures: [
            capture({ path: '/fine' }),
            capture({ path: '/broken' }),
            capture({ path: '/changed', status: 'changed', changedPixels: 4200 }),
          ],
          findings: [{ path: '/broken', kind: 'broken-images', count: 2 }],
        },
      }),
    ],
  });
  expect(pages.map((page) => page.path)).toEqual(['/changed', '/broken', '/never-run', '/fine']);
  expect(pages.map((page) => page.status)).toEqual(['needs-review', 'problem', 'untested', 'ok']);
});

it('says what passed as well as what failed, so a clean page differs from an unchecked one', () => {
  const [clean, unchecked] = buildPageInventory({
    projects: [project({ paths: ['/clean', '/unchecked'] })],
    runs: [
      run({
        result: { outcome: 'observed', summary: '', captures: [capture({ path: '/clean' })] },
      }),
    ],
  }).sort((left, right) => left.path.localeCompare(right.path));
  expect(clean!.passing.map((check) => check.term)).toEqual([
    'broken-images',
    'unlabeled-inputs',
    'undecodable-images',
    'script-errors',
    'http-errors',
    'horizontal-overflow',
  ]);
  expect(unchecked!.passing).toEqual([]);
  expect(unchecked!.status).toBe('untested');
});

it('never claims a check passed when the capture could not settle', () => {
  // An unstable capture measured nothing reliably; "nothing runs off the side
  // of the screen" would be an assertion the evidence does not support.
  const [page] = buildPageInventory({
    projects: [project({ paths: ['/moving'] })],
    runs: [
      run({
        result: {
          outcome: 'observed',
          summary: '',
          captures: [capture({ path: '/moving', status: 'unstable' })],
        },
      }),
    ],
  });
  expect(page!.passing.map((check) => check.term)).not.toContain('horizontal-overflow');
  expect(page!.status).toBe('problem');
});

it('never claims text contrast passed, because it is not always measured', () => {
  const [page] = buildPageInventory({
    projects: [project({ paths: ['/text'] })],
    runs: [
      run({ result: { outcome: 'observed', summary: '', captures: [capture({ path: '/text' })] } }),
    ],
  });
  expect(page!.passing.map((check) => check.term)).not.toContain('text-contrast');
});

it('collects a page’s states into one filmstrip with the normal frame first', () => {
  const [page] = buildPageInventory({
    projects: [project({ paths: ['/login'] })],
    runs: [
      run({
        result: {
          outcome: 'observed',
          summary: '',
          captures: [
            capture({ path: '/login', stateVariant: 'error' }),
            capture({ path: '/login' }),
            capture({ path: '/login', stateVariant: 'empty' }),
          ],
        },
      }),
    ],
  });
  expect(page!.shots.map((shot) => shot.state)).toEqual(['', 'error', 'empty']);
  expect(page!.thumbnail!.state).toBe('');
});

it('keeps an isolated component out of the page grid but on the page’s evidence', () => {
  const [page] = buildPageInventory({
    projects: [project({ paths: ['/'] })],
    runs: [
      run({
        result: {
          outcome: 'observed',
          summary: '',
          captures: [
            capture({ path: '/' }),
            capture({ path: '/', isolatedRegion: { key: '.nav', kind: 'component' } }),
          ],
        },
      }),
    ],
  });
  expect(page!.captures).toHaveLength(1);
  expect(page!.shots).toHaveLength(1);
});

it('reads the newest run that produced screenshots, not the newest run', () => {
  const pages = buildPageInventory({
    projects: [project({ paths: ['/'] })],
    runs: [
      run({
        id: 'discovery-today',
        mode: 'discovery',
        result: { outcome: 'observed', summary: '' },
      }),
      run({
        id: 'visual-yesterday',
        finishedAt: '2025-12-31T00:00:00.000Z',
        result: { outcome: 'observed', summary: '', captures: [capture({ path: '/' })] },
      }),
    ],
  });
  expect(pages[0]!.runId).toBe('visual-yesterday');
  expect(pages[0]!.checkedAt).toBe('2025-12-31T00:00:00.000Z');
});

it('disambiguates two pages that would otherwise share a name', () => {
  const pages = buildPageInventory({
    projects: [project({ paths: ['/settings/profile', '/team/profile'] })],
    runs: [],
  });
  expect(pages.map((page) => page.title).sort()).toEqual(['Settings · Profile', 'Team · Profile']);
});

it('records the browsers, themes and sizes a page was seen in', () => {
  const [page] = buildPageInventory({
    projects: [project({ paths: ['/'] })],
    runs: [
      run({
        result: {
          outcome: 'observed',
          summary: '',
          captures: [
            capture({ path: '/', environment: { browser: 'webkit', colorScheme: 'dark' } }),
            capture({
              path: '/',
              environment: { browser: 'chromium', colorScheme: 'light' },
              viewport: { width: 390, height: 844 },
            }),
          ],
        },
      }),
    ],
  });
  expect(page!.browsers).toEqual(['chromium', 'webkit']);
  expect(page!.themes).toEqual(['dark', 'light']);
  expect(page!.sizes).toEqual([
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]);
});

it('builds the review queue from every page that has a pending decision', () => {
  const pages = buildPageInventory({
    projects: [project({ paths: ['/a', '/b'] })],
    runs: [
      run({
        result: {
          outcome: 'observed',
          summary: '',
          captures: [
            capture({ path: '/a', status: 'changed' }),
            capture({ path: '/a', status: 'changed', stateVariant: 'error' }),
            capture({ path: '/b' }),
          ],
        },
      }),
    ],
  });
  const queue = pendingChanges(pages);
  expect(queue).toHaveLength(2);
  expect(new Set(queue.map((item) => item.page.path))).toEqual(new Set(['/a']));
  expect(queue.every((item) => item.runId === 'r1')).toBe(true);
});

it('keeps two projects’ pages apart even when the paths are identical', () => {
  const pages = buildPageInventory({
    projects: [project(), project({ id: 'p2', name: 'Shop', paths: ['/login'] })],
    runs: [],
  });
  expect(new Set(pages.map((page) => page.key)).size).toBe(pages.length);
  expect(pages.filter((page) => page.path === '/login')).toHaveLength(2);
});

it('narrows to one project when the operator has filtered to it', () => {
  const pages = buildPageInventory({
    projects: [project(), project({ id: 'p2', name: 'Shop', paths: ['/shop'] })],
    runs: [],
    projectId: 'p2',
  });
  expect(pages.map((page) => page.projectId)).toEqual(['p2']);
});

it('builds the address a person would type, and omits it when there is none', () => {
  const [withOrigin] = buildPageInventory({
    projects: [project({ origin: 'https://koel.test/', paths: ['/login'] })],
    runs: [],
  });
  const [without] = buildPageInventory({
    projects: [project({ origin: '', paths: ['/login'] })],
    runs: [],
  });
  expect(withOrigin!.url).toBe('https://koel.test/login');
  expect(without!.url).toBe('');
});

it('reports a check once per page, not once per screenshot', () => {
  // The same page photographed on desktop and on a phone reports the same
  // defect twice; two identical sentences read as two separate problems.
  const [page] = buildPageInventory({
    projects: [project({ paths: ['/login'] })],
    runs: [
      run({
        result: {
          outcome: 'observed',
          summary: '',
          captures: [
            capture({ path: '/login' }),
            capture({ path: '/login', viewport: { width: 390, height: 844 } }),
          ],
          findings: [
            { path: '/login', kind: 'unlabeled-inputs', count: 1 },
            { path: '/login', kind: 'unlabeled-inputs', count: 2 },
          ],
        },
      }),
    ],
  });
  expect(page!.failing).toHaveLength(1);
  // The worst measurement survives; a page is as broken as its worst screenshot.
  expect(page!.failing[0]!.label).toBe('2 fields have no label');
});

it('stops asking about a change once someone has approved it', () => {
  // Approving IS the decision. The capture keeps `status: 'changed'` for ever
  // — it records what that run measured — so a queue keyed on status alone
  // would put the same question back after it had been answered.
  const decided = capture({ path: '/a', status: 'changed' });
  const open = capture({ path: '/b', status: 'changed' });
  const build = (baselines: Array<{ run_id: string; capture_id: string }>) =>
    buildPageInventory({
      projects: [project({ paths: ['/a', '/b'] })],
      runs: [run({ result: { outcome: 'observed', summary: '', captures: [decided, open] } })],
      baselines,
    });
  expect(pendingChanges(build([]))).toHaveLength(2);
  const after = build([{ run_id: 'r1', capture_id: decided.id }]);
  expect(pendingChanges(after).map((item) => item.capture.id)).toEqual([open.id]);
  expect(after.find((page) => page.path === '/a')!.needsReview).toBe(0);
  expect(after.find((page) => page.path === '/a')!.status).not.toBe('needs-review');
});

it('does not credit an approval from a different run', () => {
  const shot = capture({ path: '/a', status: 'changed' });
  const pages = buildPageInventory({
    projects: [project({ paths: ['/a'] })],
    runs: [run({ result: { outcome: 'observed', summary: '', captures: [shot] } })],
    baselines: [{ run_id: 'some-older-run', capture_id: shot.id }],
  });
  expect(pendingChanges(pages)).toHaveLength(1);
});
