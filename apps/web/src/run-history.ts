import { HttpError } from './errors';
import type { Store } from './store';
import type { Run } from './types';

export type RunHistoryPage = { runs: Run[]; total: number; offset: number; limit: number };
/** Search policy belongs here; SQLite retrieval is a Store capability. */
export function searchRunHistory(store: Store, params: URLSearchParams): RunHistoryPage {
  const query = (params.get('query') ?? '').trim();
  // One id, or a comma-separated set when the scope names an environment.
  const projects = (params.get('project') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const mode = params.get('mode') ?? '';
  const status = params.get('status') ?? '';
  const limit = Number(params.get('limit') ?? 25);
  const offset = Number(params.get('offset') ?? 0);
  if (
    query.length > 200 ||
    projects.length > 200 ||
    projects.some((value) => !/^[a-f0-9-]{36}$/u.test(value)) ||
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
  return store.searchRuns({ query, projects, mode, status, limit, offset });
}
