import type { DomainCluster, InventoryDisposition, InventoryRow } from './types';

/**
 * Deterministic domain clustering (issue #246 deliverable 2): resource/noun +
 * verb heuristics. NO LLM. The ledger always exposes raw inventory rows
 * regardless of clustering quality (ADR-008 risk "Domain clustering quality"),
 * so a weak grouping never hides the denominator.
 *
 * Heuristics (documented in docs/spikes/dg-02-domain-inventory.md):
 * - Domain label = the first STATIC (non-param) path segment after dropping
 *   the `api` prefix and version segments (`v1`, `v2`, …), singularized by
 *   deterministic English rules. `/` → `root`; gap/symbolic paths →
 *   `uncategorized`.
 * - Verbs = CRUD derivation from method × parameterization (GET collection →
 *   read-list, GET item → read-one, POST → create, PUT/PATCH → update,
 *   DELETE → delete), overridden by a fixed action-segment lexicon when a path
 *   segment names a known action (login, logout, search, upload, …).
 */

const ACTION_LEXICON: Record<string, string> = {
  login: 'login',
  logout: 'logout',
  signin: 'login',
  signout: 'logout',
  register: 'register',
  signup: 'register',
  verify: 'verify',
  reset: 'reset',
  forgot: 'reset',
  search: 'search',
  upload: 'upload',
  download: 'download',
  export: 'export',
  import: 'import',
  publish: 'publish',
  approve: 'approve',
  reject: 'reject',
  cancel: 'cancel',
  confirm: 'confirm',
  accept: 'accept',
  invite: 'invite',
  clone: 'clone',
  duplicate: 'duplicate',
  move: 'move',
  toggle: 'toggle',
  play: 'play',
  stream: 'stream',
  scrobble: 'scrobble',
  favorite: 'favorite',
  like: 'like',
  rate: 'rate',
};

const IRREGULAR_SINGULARS: Record<string, string> = {
  people: 'person',
  children: 'child',
  men: 'man',
  women: 'woman',
  media: 'media',
  data: 'data',
  news: 'news',
  series: 'series',
  status: 'status',
};

export function domainOf(row: InventoryRow): string {
  if (!row.path.startsWith('/') || row.path === '/')
    return row.path === '/' ? 'root' : 'uncategorized';
  const segments = row.path.split('/').slice(1);
  const statics = segments.filter((segment) => !segment.startsWith(':'));
  const meaningful = statics.filter((segment) => segment !== 'api' && !/^v\d+$/u.test(segment));
  const first = meaningful[0];
  if (first === undefined) return statics.length === 0 ? 'root' : 'uncategorized';
  return singularize(first);
}

export function verbsOf(row: InventoryRow): string[] {
  const verbs = new Set<string>();
  const segments = row.path
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/^:param\??$/u, ''));
  for (const segment of segments) {
    const action = ACTION_LEXICON[segment.replace(/-/gu, '')];
    if (action) verbs.add(action);
  }
  const hasParam = row.path.includes(':param');
  switch (row.method) {
    case 'GET':
      verbs.add(hasParam ? 'read-one' : 'read-list');
      break;
    case 'HEAD':
      verbs.add('read-one');
      break;
    case 'POST':
      verbs.add('create');
      break;
    case 'PUT':
    case 'PATCH':
      verbs.add('update');
      break;
    case 'DELETE':
      verbs.add('delete');
      break;
    default:
      break;
  }
  return [...verbs].sort(codepointCompare);
}

export function clusterInventory(rows: InventoryRow[]): DomainCluster[] {
  const grouped = new Map<string, InventoryRow[]>();
  for (const row of rows) {
    const domain = domainOf(row);
    row.domain = domain;
    row.verbs = verbsOf(row);
    const bucket = grouped.get(domain) ?? [];
    bucket.push(row);
    grouped.set(domain, bucket);
  }
  const clusters: DomainCluster[] = [...grouped.entries()]
    .sort(([a], [b]) => codepointCompare(a, b))
    .map(([domain, bucket]) => ({
      domain,
      rowKeys: bucket.map((row) => row.key).sort(codepointCompare),
      verbs: [...new Set(bucket.flatMap((row) => row.verbs))].sort(codepointCompare),
      methods: [...new Set(bucket.map((row) => row.method))].sort(codepointCompare),
      dispositions: countDispositions(bucket),
    }));
  return clusters;
}

function countDispositions(rows: InventoryRow[]): Record<InventoryDisposition, number> {
  const counts = Object.fromEntries(
    (['extracted', 'unsupported', 'unsafe', 'unextracted-with-reason'] as const).map((key) => [
      key,
      0,
    ]),
  ) as Record<InventoryDisposition, number>;
  for (const row of rows) counts[row.disposition] += 1;
  return counts;
}

function singularize(word: string): string {
  if (IRREGULAR_SINGULARS[word]) return IRREGULAR_SINGULARS[word]!;
  if (word.endsWith('ies') && word.length > 3) return `${word.slice(0, -3)}y`;
  if (/(?:ses|xes|zes|ches|shes)$/u.test(word) && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 1) return word.slice(0, -1);
  return word;
}

function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
