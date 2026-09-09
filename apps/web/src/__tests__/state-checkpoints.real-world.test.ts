import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  referenceAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { Workbench } from '../workbench';
import { stateCheckpointCoverage } from '../route-coverage';
import type { FrontendInventory } from '@arxic/source-ua-adapter';
import type { DomainInventory } from '@arxic/domain-inventory';

const root = resolve(import.meta.dirname, '../../../..');
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * State checkpoints (refs #402): operator-declared state provocations become
 * first-class visual checkpoints — captured, tagged and baselined
 * independently of the plain path, so error/empty/authenticated states stop
 * being invisible to the visual lane.
 */
it('captures and independently identities a declared error-state checkpoint', async () => {
  const target = await bootFixtureApp(root, referenceAuthApp, 'web-state-checkpoints');
  cleanups.push(() => stopApp(target.child));
  const state = await mkdtemp(join(tmpdir(), 'arxic-state-checkpoints-'));
  cleanups.push(() => rm(state, { recursive: true, force: true }));
  const wb = await Workbench.open(state, [root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'State checkpoints',
    folder: join(root, 'test-fixtures/reference-auth-app'),
    origin: target.origin,
    paths: ['/login'],
    viewports: [{ width: 800, height: 600 }],
    captureConsent: true,
    stateCaptures: [{ path: '/login', state: 'error', query: 'error=Invalid%20credentials' }],
  });
  expect(project.stateCaptures).toEqual([
    { path: '/login', state: 'error', query: 'error=Invalid%20credentials' },
  ]);

  const run = wb.enqueue(project.id, 'visual');
  await wb.idle();
  const result = wb.store.run(run.id)!.result!;
  if (result.outcome !== 'observed')
    console.log('BLOCKED-DEBUG:', result.summary, JSON.stringify(result.findings));
  expect(result.outcome).toBe('observed');
  const captures = result.captures!;
  const plain = captures.find((capture) => capture.path === '/login' && !capture.stateVariant);
  const variant = captures.find(
    (capture) => capture.path === '/login' && capture.stateVariant === 'error',
  );
  expect(plain).toBeDefined();
  expect(variant).toBeDefined();
  // Independent identity: distinct spec hashes give the state checkpoint its
  // own versioned baseline through the unchanged baseline machinery.
  expect(variant!.specHash).not.toBe(plain!.specHash);
  // The real fixture renders its error paragraph under the query — the
  // variant's pixels must differ from the plain capture.
  const plainBytes = await readFile(join(state, 'runs', run.id, plain!.file));
  const variantBytes = await readFile(join(state, 'runs', run.id, variant!.file));
  expect(variantBytes.equals(plainBytes)).toBe(false);
  // The run summary names the state checkpoints.
  expect(result.summary).toContain('1 state checkpoint');

  // State-checkpoint coverage matrix: /login declares error (#509 source
  // tier) and the project covers it; forgot-password declares nothing here
  // (not in this project's discovery) — the matrix is per declared state.
  const discovery = wb.enqueue(project.id, 'discovery');
  await wb.idle();
  const discoveryResult = wb.store.run(discovery.id)!.result!;
  const matrix = stateCheckpointCoverage(
    discoveryResult.inventory as DomainInventory,
    discoveryResult.frontend as FrontendInventory,
    project.stateCaptures ?? [],
  );
  const login = matrix.find((entry) => entry.path === '/login');
  if (!login)
    console.log(
      'MATRIX-DIAG:',
      JSON.stringify({
        inventoryPaths: (discoveryResult.inventory as DomainInventory).rows.map((row) => row.path),
        matrixPaths: matrix.map((entry) => entry.path),
        stateCaptures: project.stateCaptures,
        loginConditions: (discoveryResult.frontend as FrontendInventory).rows
          .filter((row) => row.source.path.startsWith('app/login'))
          .slice(0, 8)
          .map((row) => [row.kind, row.label.slice(0, 60)]),
      }),
    );
  expect(login?.dimensions).toEqual([
    { name: 'state:loading', declared: false, checkpoint: false },
    { name: 'state:error', declared: true, checkpoint: true },
    { name: 'state:empty', declared: false, checkpoint: false },
  ]);
  expect(matrix.map(({ path }) => path)).toEqual(
    [...matrix.map(({ path }) => path)].sort((left, right) => left.localeCompare(right)),
  );
}, 240_000);

it('refuses malformed state checkpoint declarations with distinct 400s', async () => {
  const state = await mkdtemp(join(tmpdir(), 'arxic-state-checkpoints-invalid-'));
  cleanups.push(() => rm(state, { recursive: true, force: true }));
  const wb = await Workbench.open(state, [root]);
  cleanups.push(() => wb.close());
  const base = {
    name: 'Invalid state checkpoints',
    folder: join(root, 'test-fixtures/vulnerable-auth-app'),
    origin: 'http://127.0.0.1:1',
    captureConsent: true,
  };
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    // path without a leading slash / carrying a query itself
    [
      { ...base, stateCaptures: [{ path: 'login', state: 'error' }] },
      /relative page paths without query/u,
    ],
    [
      { ...base, stateCaptures: [{ path: '/login?x=1', state: 'error' }] },
      /relative page paths without query/u,
    ],
    // state slug violations
    [
      { ...base, stateCaptures: [{ path: '/login', state: 'Error State' }] },
      /State checkpoint names use lowercase/u,
    ],
    [{ ...base, stateCaptures: [{ path: '/login' }] }, /state checkpoint requires a state name/u],
    // duplicate triples
    [
      {
        ...base,
        stateCaptures: [
          { path: '/login', state: 'error' },
          { path: '/login', state: 'error' },
        ],
      },
      /unique/u,
    ],
    // budget
    [
      {
        ...base,
        stateCaptures: Array.from({ length: 21 }, (_, index) => ({
          path: '/login',
          state: `s-${index}`,
        })),
      },
      /at most 20 state checkpoints/u,
    ],
  ];
  for (const [input, message] of cases)
    await expect(wb.saveProject(input as never)).rejects.toThrow(message);
});
