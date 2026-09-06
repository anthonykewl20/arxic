import { HttpError } from './errors';
import type { Store } from './store';
import type { Run } from './types';

export type RunHistoryPage = { runs: Run[]; total: number; offset: number; limit: number };
/** Search policy belongs here; SQLite retrieval is a Store capability. */
export function searchRunHistory(store: Store, params: URLSearchParams): RunHistoryPage {
  const query = (params.get('query') ?? '').trim();
  const project = params.get('project') ?? '';
  const mode = params.get('mode') ?? '';
  const status = params.get('status') ?? '';
  const limit = Number(params.get('limit') ?? 25);
  const offset = Number(params.get('offset') ?? 0);
  if (
    query.length > 200 ||
    (project && !/^[a-f0-9-]{36}$/u.test(project)) ||
    (mode && !['discovery', 'visual', 'agent', 'review'].includes(mode)) ||
    (status && !['queued', 'running', 'completed', 'blocked', 'cancelled'].includes(status)) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 1_000_000
  )
    throw new HttpError(400, 'Invalid run search or page bounds');
  return store.searchRuns({ query, project, mode, status, limit, offset });
}
