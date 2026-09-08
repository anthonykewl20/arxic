import { rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
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
import { Workbench } from '../workbench';
import { configurationOmissions, routeStateCoverage } from '../route-coverage';
import type { Project } from '../types';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * Configuration omission exposure (refs #402): the dimensions the operator
 * already configures — feature flags and the persona's login route — are
 * fused deterministically with what discovery actually found. A declared flag
 * no source file reads, a source flag no deployment declares, and a persona
 * login route that does not exist are all oissions; runtime VALUES stay
 * unobserved.
 */
it('exposes flag, persona and action omissions fusing real settings with the real discovery stack', async () => {
  const repo = await makeRepository('reference-auth-app', {
    'app/billing/page.tsx': `export default function BillingPage() {
  const showNewCheckout = flags.newCheckout;
  const betaUi = process.env.NEXT_PUBLIC_BETA_UI === '1';
  return (
    <main>
      <h1>Billing</h1>
      {showNewCheckout ? <p>New checkout</p> : <p>Legacy checkout</p>}
      {betaUi ? <p>Beta UI enabled</p> : null}
    </main>
  );
}
`,
    'app/about/page.tsx': `export default function AboutPage() {
  return (
    <main>
      <h1>About</h1>
      <p>Static informational page.</p>
    </main>
  );
}
`,
  });
  cleanups.push(() => rm(repo.root, { recursive: true, force: true }));
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-config-omissions-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Config omissions',
    folder: repo.root,
    origin: 'http://127.0.0.1:1',
    execution: {
      model: 'gpt-4o-mini',
      frameworks: ['nextjs'],
      domains: ['authentication'],
      featureFlags: { newCheckout: true, orphanFlag: false },
      persona: {
        mode: 'per-pass-login',
        emailRef: 'ARXIC_SECRET_PERSONA_EMAIL',
        passwordRef: 'ARXIC_SECRET_PERSONA_PASSWORD',
        loginPath: '/login',
      },
    },
  });
  const discovery = wb.enqueue(project.id, 'discovery');
  await wb.idle();
  const run = wb.store.run(discovery.id)!;
  const inventory = run.result?.inventory as DomainInventory;
  const frontend = run.result?.frontend as FrontendInventory;
  const stored = wb.store.project(project.id)!;

  const entry = (key: string) =>
    configurationOmissions(stored, inventory, frontend).find((candidate) => candidate.key === key);

  // The declared flag the overlay reads is aligned, with line evidence.
  const aligned = entry('flag:newCheckout');
  expect(aligned?.status).toBe('aligned');
  expect(aligned?.evidence[0]?.path).toBe('app/billing/page.tsx');
  expect(aligned?.evidence[0]?.startLine).toBeGreaterThan(0);
  // The declared flag nothing reads is an omission.
  expect(entry('flag:orphanFlag')).toMatchObject({ status: 'declared-unreferenced' });
  // The source-read flag no deployment declares is an omission.
  const undeclared = entry('flag:NEXT_PUBLIC_BETA_UI');
  expect(undeclared?.status).toBe('referenced-undeclared');
  expect(undeclared?.evidence[0]?.path).toBe('app/billing/page.tsx');
  // The configured persona login route exists in the real inventory.
  expect(entry('persona:login-route')).toMatchObject({ status: 'referenced' });

  // A persona pointed at a route the app does not have is an honest omission.
  const portalPersona: Project = {
    ...stored,
    execution: {
      ...stored.execution!,
      persona: { ...stored.execution!.persona, loginPath: '/portal' },
    },
  };
  expect(
    configurationOmissions(portalPersona, inventory, frontend).find(
      (candidate) => candidate.key === 'persona:login-route',
    ),
  ).toMatchObject({ status: 'missing' });

  // seed-api mode requires a seed-capable endpoint; the real fixture has one.
  const seedPersona: Project = {
    ...stored,
    execution: {
      ...stored.execution!,
      persona: { ...stored.execution!.persona, mode: 'seed-api' },
    },
  };
  const seed = configurationOmissions(seedPersona, inventory, frontend).find(
    (candidate) => candidate.key === 'persona:seed-endpoint',
  );
  expect(seed?.status).toBe('referenced');
  expect(seed?.evidence[0]?.path).toContain('seed');

  // Action dimension: the home route's real logout form declares actions; the
  // static overlay route declares none.
  const byPath = new Map(
    routeStateCoverage(inventory, frontend).map((route) => [route.path, route]),
  );
  expect(byPath.get('/')?.dimensions.find(({ name }) => name === 'actions')?.status).toBe(
    'referenced',
  );
  expect(byPath.get('/about')?.dimensions.find(({ name }) => name === 'actions')?.status).toBe(
    'absent',
  );

  // Pure derivation: identical inputs produce identical output.
  expect(configurationOmissions(stored, inventory, frontend)).toEqual(
    configurationOmissions(stored, inventory, frontend),
  );
}, 120_000);

/**
 * Direct-stack variant (no Workbench): the same fusion over the raw adapters,
 * keeping the service honest about its true inputs.
 */
it('derives the same omissions over the raw discovery adapters', async () => {
  const repo = await makeRepository('reference-auth-app', {
    'app/billing/page.tsx':
      'export default function BillingPage() {\n  const show = flags.newCheckout;\n  return <main>{show ? <p>New</p> : null}</main>;\n}\n',
  });
  cleanups.push(() => rm(repo.root, { recursive: true, force: true }));
  const adapter = new SourceUaAdapter();
  const request = {
    revision: {
      repository: pathToFileURL(repo.root).href,
      commit: repo.commit,
      dirty: false,
    },
  };
  const sourceIndex = await adapter.collect(request);
  const inventory = buildSourceInventory({
    sourceIndex,
    interchanges: await adapter.collectRouteInventories(request),
  }) as DomainInventory;
  const frontend = (await collectFrontendInventory(repo.root, sourceIndex)) as FrontendInventory;
  const project = {
    execution: {
      model: 'm',
      frameworks: [],
      domains: [],
      featureFlags: { newCheckout: true },
      persona: { mode: 'anonymous' },
    },
  } as unknown as Project;
  const omissions = configurationOmissions(project, inventory, frontend);
  expect(omissions.find((candidate) => candidate.key === 'flag:newCheckout')?.status).toBe(
    'aligned',
  );
  expect(omissions.find((candidate) => candidate.key === 'persona:login-route')).toBeUndefined();
});
