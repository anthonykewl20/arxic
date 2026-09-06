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
  } finally {
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
