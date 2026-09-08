import { rm } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import {
  collectFrontendInventory,
  SourceUaAdapter,
} from '../../../../packages/source-ua-adapter/src/index';
import {
  buildSourceInventory,
  type DomainInventory,
} from '../../../../packages/domain-inventory-spike/src/index';
import type { FrontendInventory } from '@arxic/source-ua-adapter';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';
import { routeStateCoverage } from '../route-coverage';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true });
});

/**
 * Route omission coverage (refs #402): associates the REAL discovery stack's
 * route rows with frontend declarations and exposes per-route omissions —
 * which conditional states (loading/error/empty) the route's own source
 * references, whether any test declaration covers its files, and whether any
 * documentation requirement does. Absence of a source marker is an omission
 * signal, never proof of absent behavior.
 */
it('exposes per-route state/test/docs omissions from the real discovery stack', async () => {
  const repo = await makeRepository('reference-auth-app', {
    'app/status/page.tsx': `export default function StatusPage() {
  const loading = false;
  return (
    <main>
      <h1>Status</h1>
      {loading ? <p>Loading dashboard…</p> : <p>Ready</p>}
    </main>
  );
}
`,
    'app/status/page.test.tsx': `import { expect, it } from 'vitest';
it('renders the status page', () => {
  expect(true).toBe(true);
});
`,
  });
  roots.push(repo.root);
  const adapter = new SourceUaAdapter();
  const request = {
    revision: {
      repository: pathToFileURL(repo.root).href,
      commit: repo.commit,
      dirty: false,
    },
  };
  const sourceIndex = await adapter.collect(request);
  const interchanges = await adapter.collectRouteInventories(request);
  const inventory = buildSourceInventory({ sourceIndex, interchanges }) as DomainInventory;
  const frontend = (await collectFrontendInventory(repo.root, sourceIndex)) as FrontendInventory;

  const coverage = routeStateCoverage(inventory, frontend);

  const byPath = new Map(coverage.map((route) => [route.path, route]));
  const dimension = (path: string, name: string) =>
    byPath.get(path)?.dimensions.find((dimension) => dimension.name === name);

  // The overlay /status route references a loading state through its own real
  // ternary and carries a colocated test file — both must surface as
  // referenced with line-anchored evidence in the route's own files.
  const loading = dimension('/status', 'state:loading');
  expect(loading?.status).toBe('referenced');
  expect(loading?.evidence[0]?.path).toBe('app/status/page.tsx');
  expect(loading?.evidence[0]?.startLine).toBeGreaterThan(0);
  expect(dimension('/status', 'state:error')?.status).toBe('absent');
  expect(dimension('/status', 'state:empty')?.status).toBe('absent');
  const statusTests = dimension('/status', 'tests');
  expect(statusTests?.status).toBe('referenced');
  expect(statusTests?.evidence.some(({ path }) => path === 'app/status/page.test.tsx')).toBe(true);
  expect(dimension('/status', 'docs')?.status).toBe('absent');

  // The REAL /login route references an error state through its real
  // `{error ? …}` ternary; loading/empty/tests/docs are absent — the fixture's
  // only tests are the global __tests__/boot.test.ts, which covers no route.
  // Directory association is by design: the sibling actions.ts also references
  // error states (`redirect('/login?error=…')`) and counts as evidence.
  const loginError = dimension('/login', 'state:error');
  expect(loginError?.status).toBe('referenced');
  expect(loginError?.evidence.some(({ path }) => path === 'app/login/page.tsx')).toBe(true);
  expect(dimension('/login', 'state:loading')?.status).toBe('absent');
  expect(dimension('/login', 'state:empty')?.status).toBe('absent');
  expect(dimension('/login', 'tests')?.status).toBe('absent');
  expect(dimension('/login', 'docs')?.status).toBe('absent');

  // The home route's only conditional is the session ternary — every state
  // dimension is an honest omission.
  expect(dimension('/', 'state:loading')?.status).toBe('absent');
  expect(dimension('/', 'state:error')?.status).toBe('absent');
  expect(dimension('/', 'state:empty')?.status).toBe('absent');

  // Fixed dimension order on every route and stable route ordering.
  for (const route of coverage)
    expect(route.dimensions.map(({ name }) => name)).toEqual([
      'state:loading',
      'state:error',
      'state:empty',
      'tests',
      'docs',
    ]);
  expect(coverage.map(({ path }) => path)).toEqual(
    [...coverage.map(({ path }) => path)].sort((left, right) => left.localeCompare(right)),
  );

  // Pure derivation: identical inputs produce identical output.
  expect(routeStateCoverage(inventory, frontend)).toEqual(coverage);
});
