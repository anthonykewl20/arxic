import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Workbench } from '../workbench';

const root = resolve(import.meta.dirname, '../../../..');
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function workbench() {
  const state = await mkdtemp(join(tmpdir(), 'arxic-page-run-'));
  const wb = await Workbench.open(state, [root]);
  cleanup.push(async () => {
    await wb.close();
    await rm(state, { recursive: true, force: true });
  });
  return wb;
}

/**
 * Testing one page must mean one page.
 *
 * The button on a page card starts a run scoped to that page; a whole-project
 * run to re-check the sign-in screen is minutes of browsers for one
 * screenshot. The queued run carries its own project snapshot, so the scope is
 * whatever `paths` that snapshot ends up holding.
 */
it('narrows a run to the pages a person asked for', async () => {
  const wb = await workbench();
  const project = await wb.saveProject({
    name: 'Scoped',
    folder: root,
    paths: ['/', '/login', '/pricing'],
  });
  const run = wb.enqueue(project.id, 'visual', ['/login']);
  expect(run.project.paths).toEqual(['/login']);
});

it('leaves an unscoped run covering everything the project covers', async () => {
  const wb = await workbench();
  const project = await wb.saveProject({
    name: 'Whole',
    folder: root,
    paths: ['/', '/login', '/pricing'],
  });
  expect(wb.enqueue(project.id, 'visual').project.paths).toEqual(['/', '/login', '/pricing']);
});

it('refuses to point a run at a path the project does not cover', async () => {
  // The scope narrows; it never substitutes. Otherwise this parameter would be
  // a way to make the server fetch a path nobody configured.
  const wb = await workbench();
  const project = await wb.saveProject({ name: 'Scoped', folder: root, paths: ['/'] });
  expect(() => wb.enqueue(project.id, 'visual', ['/admin'])).toThrow(
    /None of those pages belong to this project/u,
  );
  expect(() => wb.enqueue(project.id, 'visual', ['/', '/admin'])).not.toThrow();
});

it('refuses a scope that is not a list of paths', async () => {
  const wb = await workbench();
  const project = await wb.saveProject({ name: 'Scoped', folder: root, paths: ['/'] });
  expect(() => wb.enqueue(project.id, 'visual', '/login')).toThrow(
    /must be a list of paths/u,
  );
  expect(() => wb.enqueue(project.id, 'visual', [1])).toThrow(/must be a list of paths/u);
});

it('scopes a discovering project against what discovery actually found', async () => {
  // In discover mode the coverage is the merged set, not the configured one,
  // so a page found by discovery is scopeable and a stale one is not.
  const wb = await workbench();
  const project = await wb.saveProject({
    name: 'Discovering',
    folder: root,
    paths: ['/'],
    pageMode: 'discover',
  });
  expect(wb.enqueue(project.id, 'visual', ['/']).project.paths).toEqual(['/']);
  expect(() => wb.enqueue(project.id, 'visual', ['/never-discovered'])).toThrow(
    /None of those pages belong to this project/u,
  );
});
