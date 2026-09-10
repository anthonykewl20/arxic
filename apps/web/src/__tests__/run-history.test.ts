import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Store } from '../store';
import { validateProject } from '../projects';
import { searchRunHistory } from '../run-history';

it('rejects invalid search bounds and searches persisted history beyond the recent window', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'run-history-'));
  const store = await Store.open(dir);
  try {
    for (const query of [
      'limit=1000',
      'offset=-1',
      'mode=unknown',
      'status=green',
      'query=' + 'x'.repeat(201),
      'project=not-a-uuid',
      'project=' + '00000000-0000-4000-8000-000000000000,nope',
    ])
      expect(() => searchRunHistory(store, new URLSearchParams(query))).toThrow();
    const project = await validateProject({ name: 'Archived reference', folder: dir }, [dir]);
    const old = store.enqueue(project, 'visual')!;
    store.finish(old, { outcome: 'blocked', summary: 'No capture consent; no execution claimed.' });
    for (let i = 0; i < 205; i++) {
      const run = store.enqueue({ ...project, name: 'Recent reference' }, 'discovery')!;
      store.finish(run, { outcome: 'blocked', summary: 'History fixture, no execution claimed.' });
    }
    expect(
      searchRunHistory(store, new URLSearchParams('query=Archived&mode=visual&status=blocked')),
    ).toMatchObject({ total: 1, runs: [{ id: old.id }] });
    expect(searchRunHistory(store, new URLSearchParams('query=Archived&offset=500'))).toMatchObject(
      { offset: 0, total: 1, runs: [{ id: old.id }] },
    );
    expect(searchRunHistory(store, new URLSearchParams('query=%25')).total).toBe(0);
    const first = searchRunHistory(store, new URLSearchParams('limit=25'));
    const next = searchRunHistory(store, new URLSearchParams('limit=25&offset=25'));
    expect(first.total).toBe(206);
    expect(first.runs).toHaveLength(25);
    expect(next.runs).toHaveLength(25);
    expect(new Set([...first.runs, ...next.runs].map((r) => r.id)).size).toBe(50);

    // The dashboard's scope can name an environment, which is a SET of
    // projects; a history narrowed to one of them would contradict the scope
    // it was asked for.
    const other = await validateProject({ name: 'Second reference', folder: dir }, [dir]);
    const otherRun = store.enqueue(other, 'visual')!;
    store.finish(otherRun, { outcome: 'blocked', summary: 'Second project, no execution.' });
    expect(searchRunHistory(store, new URLSearchParams(`project=${project.id}`)).total).toBe(206);
    expect(searchRunHistory(store, new URLSearchParams(`project=${other.id}`)).total).toBe(1);
    expect(
      searchRunHistory(store, new URLSearchParams(`project=${project.id},${other.id}`)).total,
    ).toBe(207);
    // An empty value narrows nothing, exactly as one absent id did.
    expect(searchRunHistory(store, new URLSearchParams('project=')).total).toBe(207);
  } finally {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
