import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { DomainInventory } from '@arxic/domain-inventory';
import type { FrontendInventory } from '@arxic/source-ua-adapter';
import { validateIntentLedger } from '../../../../packages/intent/src/ledger';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';
import { Workbench } from '../workbench';
import { declaredRouteRules, unionIntentCoverage } from '../route-coverage';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const STATIC_ABOUT = `export default function AboutPage() {
  return (
    <main>
      <h1>About</h1>
      <p>Static informational page.</p>
    </main>
  );
}
`;

/**
 * Declared business rules per route (refs #402): the deterministic rule
 * inventory — validation (control attributes) and authorization (session,
 * csrf, rate-limit, lockout conditions) — grounded in the real discovery's
 * line evidence, with zero-rule routes exposed as omissions.
 */
it('inventories declared validation and authorization rules per route with evidence', async () => {
  const repo = await makeRepository('reference-auth-app', { 'app/about/page.tsx': STATIC_ABOUT });
  cleanups.push(() => rm(repo.root, { recursive: true, force: true }));
  const directory = await mkdtemp(join(tmpdir(), 'arxic-declared-rules-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Declared rules',
    folder: repo.root,
    origin: 'http://127.0.0.1:1',
  });
  const discovery = wb.enqueue(project.id, 'discovery');
  await wb.idle();
  const result = wb.store.run(discovery.id)!.result!;
  const rules = declaredRouteRules(
    result.inventory as DomainInventory,
    result.frontend as FrontendInventory,
  );
  const byPath = new Map(rules.map((route) => [route.path, route]));

  // The real /login route declares validation (required inputs) AND
  // authorization (csrf/session/rate-limit in its page and actions).
  const login = byPath.get('/login')!;
  expect(login.omission).toBe(false);
  const validation = login.rules.find(({ kind }) => kind === 'rule:validation')!;
  expect(validation.evidence.some(({ path }) => path === 'app/login/page.tsx')).toBe(true);
  expect(validation.evidence.some(({ label }) => label.includes('required'))).toBe(true);
  const authorization = login.rules.find(({ kind }) => kind === 'rule:authorization')!;
  expect(
    authorization.evidence.some(({ label }) => /csrf/iu.test(label)),
    'the enriched condition text must carry the csrf guard',
  ).toBe(true);
  expect(
    authorization.evidence.some(
      ({ label }) => /rate.?limit/iu.test(label) || /locked/iu.test(label),
    ),
  ).toBe(true);

  // The home route's session ternary ("Logged out") declares authorization;
  // its single logout form has no required input → no validation rule.
  const home = byPath.get('/')!;
  expect(home.rules.some(({ kind }) => kind === 'rule:authorization')).toBe(true);
  expect(home.rules.some(({ kind }) => kind === 'rule:validation')).toBe(false);

  // The static overlay route declares nothing — an honest omission.
  expect(byPath.get('/about')).toMatchObject({ omission: true, rules: [] });

  // Deterministic ordering and pure derivation.
  expect(rules.map(({ path }) => path)).toEqual(
    [...rules.map(({ path }) => path)].sort((left, right) => left.localeCompare(right)),
  );
  expect(
    declaredRouteRules(result.inventory as DomainInventory, result.frontend as FrontendInventory),
  ).toEqual(rules);
}, 120_000);

const ledgerRow = (path: string, truthState: string, intents: number) => ({
  inventoryKey: `GET ${path}`,
  domain: 'authentication',
  surface: { kind: 'page', method: 'GET', path },
  disposition: 'extracted',
  reason: '',
  verbs: ['get'],
  evidence: {
    sourceRefs: [
      {
        kind: 'source',
        repo: 'https://example.invalid/repo',
        commit: 'a'.repeat(40),
        path: `app${path === '/' ? '' : path}/page.tsx`,
        startLine: 1,
        endLine: 1,
        blobSha256: 'b'.repeat(64),
        extractor: 'test',
      },
    ],
    runtimeUrls: [],
    runtimeForms: [],
    runtimeObservationCount: 0,
  },
  oracleKinds: ['repository-specification'],
  truthState,
  replayStatus: 'not-attempted',
  intents: Array.from({ length: intents }, (_, index) => ({
    proposalId: `prop:${(index + 1).toString(16).padStart(16, '0')}`,
    domain: 'authentication',
    intent: `intent ${index}`,
    action: 'navigate',
    persona: 'anonymous',
    fromState: 'a',
    toState: 'b',
    evidenceRefIds: ['src:page.tsx:1-1'],
    oracleKinds: ['repository-specification'],
    truthState,
    replayStatus: 'not-attempted',
    isCandidate: true,
  })),
});

/**
 * Intent-ledger fusion (refs #402): every campaign run's ledger rows union per
 * surface with a documented truth-state ranking, so routes without any
 * grounded proposal are exposed next to their source/runtime omissions.
 */
it('unions ledger rows across runs with truth ranking and exposes intent omissions', async () => {
  const first = [ledgerRow('/login', 'hypothesized', 2)];
  const second = [ledgerRow('/login', 'observed', 1), ledgerRow('/forgot-password', 'verified', 3)];
  const union = unionIntentCoverage([...first, ...second]);
  expect(union.get('GET /login')).toMatchObject({
    intents: 3,
    bestTruthState: 'observed',
    rows: 2,
  });
  expect(union.get('GET /forgot-password')).toMatchObject({
    intents: 3,
    bestTruthState: 'verified',
  });
  expect(union.get('GET /about')).toBeUndefined();

  // The ranking is total: verified > observed > hypothesized > contradicted > blocked.
  const ranked = unionIntentCoverage([
    ledgerRow('/r1', 'contradicted', 1),
    ledgerRow('/r1', 'hypothesized', 1),
    ledgerRow('/r2', 'blocked', 1),
    ledgerRow('/r2', 'contradicted', 1),
    ledgerRow('/r3', 'observed', 1),
    ledgerRow('/r3', 'verified', 1),
  ]);
  expect(ranked.get('GET /r1')?.bestTruthState).toBe('hypothesized');
  expect(ranked.get('GET /r2')?.bestTruthState).toBe('contradicted');
  expect(ranked.get('GET /r3')?.bestTruthState).toBe('verified');
  expect(unionIntentCoverage([...second, ...first])).toEqual(union);
});

/**
 * End-to-end fusion through the real workbench: a ledger validated by the
 * real validateIntentLedger, seeded onto a finished run in the real store,
 * surfaces through intentOutcomes() keyed by surface.
 */
it('fuses real validated ledgers onto route surfaces through the workbench', async () => {
  const repo = await makeRepository('reference-auth-app', { 'app/about/page.tsx': STATIC_ABOUT });
  cleanups.push(() => rm(repo.root, { recursive: true, force: true }));
  const directory = await mkdtemp(join(tmpdir(), 'arxic-declared-rules-fusion-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Declared rules fusion',
    folder: repo.root,
    origin: 'http://127.0.0.1:1',
  });
  wb.enqueue(project.id, 'discovery');
  await wb.idle();

  const ledger = {
    schemaVersion: 'arxic-intent-ledger-v1',
    generatedAt: '2026-09-09T00:00:00.000Z',
    source: { repository: repo.root, commit: repo.commit },
    inventory: {
      totalRows: 2,
      byDisposition: {
        extracted: 2,
        unsupported: 0,
        unsafe: 0,
        'unextracted-with-reason': 0,
      },
    },
    rows: [ledgerRow('/login', 'hypothesized', 2), ledgerRow('/forgot-password', 'observed', 1)],
  };
  const validated = validateIntentLedger(ledger);
  expect(validated.ok).toBe(true);

  const run = wb.store.enqueue(project, 'agent')!;
  wb.store.finish(run, {
    outcome: 'blocked',
    summary: 'seeded ledger run',
    ledger: validated.ok ? validated.value : undefined,
  } as Parameters<typeof wb.store.finish>[1]);

  const outcomes = wb.intentOutcomes()[project.id] ?? {};
  expect(outcomes['GET /login']).toMatchObject({ intents: 2, bestTruthState: 'hypothesized' });
  expect(outcomes['GET /forgot-password']).toMatchObject({
    intents: 1,
    bestTruthState: 'observed',
  });
  expect(outcomes['GET /about']).toBeUndefined();
}, 120_000);
