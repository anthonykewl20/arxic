/**
 * Paid-inference proof campaign (refs #402, owner-unblocked).
 *
 * Runs ONE bounded campaign through the real engine against the REAL
 * reference-auth-app using the owner's funded GLM Coding credential —
 * real paid proposals, real compilation, two real verifier replays. The
 * credential is read in-process from the live workbench's secret store and
 * never printed or written. Evidence output is sanitized JSON.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');

// --- funded credential: read in-process, never logged ----------------------
const Database = (
  await import('/home/soultransit/devtony/arxic/node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/lib/index.js')
).default as typeof import('better-sqlite3');
const live = new Database('/home/soultransit/.arxic/web/workbench.sqlite', { readonly: true });
const row = live
  .prepare('SELECT value FROM provider_secrets WHERE ref = ?')
  .get('ARXIC_SECRET_GLM_CODING_KEY') as { value: string } | undefined;
live.close();
if (!row?.value) throw new Error('Funded credential ARXIC_SECRET_GLM_CODING_KEY not present');
process.env.ARXIC_SECRET_GLM_CODING_KEY = row.value;
console.log(
  'credential: loaded from live store (value withheld), fingerprint',
  createHash('sha256').update(row.value).digest('hex').slice(0, 12),
);

// --- real target ------------------------------------------------------------
const { bootFixtureApp, referenceAuthApp, seedFixture, stopApp } =
  await import('/home/soultransit/devtony/arxic/packages/real-world-testkit/src/index.ts');
const app = await bootFixtureApp(root, referenceAuthApp, 'paid-inference-proof');
const PERSONA = {
  email: 'paid-proof@example.test',
  password: 'PaidProof9!',
  newPassword: 'PaidProofReplacement9!',
};
await seedFixture(app.origin, 'paid-proof', PERSONA);
console.log('target:', app.origin);

const state = await mkdtemp(join(tmpdir(), 'arxic-paid-proof-'));
const repo = await (
  await import('/home/soultransit/devtony/arxic/packages/source-ua-adapter/src/__tests__/test-repo.ts')
).makeRepository('reference-auth-app');

process.env.ARXIC_SECRET_PAID_PERSONA_EMAIL = PERSONA.email;
process.env.ARXIC_SECRET_PAID_PERSONA_PASSWORD = PERSONA.password;

const { Workbench } = await import('/home/soultransit/devtony/arxic/apps/web/src/workbench.ts');
const wb = await Workbench.open(state, [repo.root]);
try {
  const project = await wb.saveProject({
    name: 'Paid inference proof',
    folder: repo.root,
    origin: app.origin,
    execution: {
      model: 'glm-4.7',
      modelConnection: 'glm-coding',
      modelBudgetUsd: 0.025,
      frameworks: ['nextjs'],
      domains: ['authentication'],
      persona: {
        mode: 'per-pass-login',
        emailRef: 'ARXIC_SECRET_PAID_PERSONA_EMAIL',
        passwordRef: 'ARXIC_SECRET_PAID_PERSONA_PASSWORD',
        loginPath: '/login',
        emailLabel: 'Email',
        passwordLabel: 'Password',
        submitLabel: 'Login',
      },
    },
  });
  const discovery = wb.enqueue(project.id, 'discovery');
  await wb.idle();
  const { campaignRows } =
    await import('/home/soultransit/devtony/arxic/apps/web/src/campaigns.ts');
  const inventory = wb.store.run(discovery.id)?.result?.inventory as Parameters<
    typeof campaignRows
  >[0];
  const loginRow = campaignRows(inventory).find(
    (r) => r.method === 'GET' && r.path === '/login' && r.inventoryRowId,
  );
  if (!loginRow?.inventoryRowId) throw new Error('GET /login row missing from discovery');
  const campaign = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: [loginRow.inventoryRowId!],
  });
  await wb.idle();

  const run = wb.store.run(campaign.runIds[0]!)!;
  const result = run.result as {
    outcome: string;
    summary: string;
    ledger?: unknown;
    engineRun?: { modelRuns?: unknown };
  };
  const engineDir = join(state, 'runs', run.id, 'engine');
  let runJson: unknown;
  try {
    runJson = JSON.parse(await readFile(join(engineDir, 'run.json'), 'utf8'));
  } catch {
    runJson = null;
  }
  let ledgerJson: unknown = result.ledger ?? null;
  if (!ledgerJson) {
    try {
      ledgerJson = JSON.parse(await readFile(join(engineDir, 'intents.json'), 'utf8'));
    } catch {
      ledgerJson = null;
    }
  }
  const sanitized = JSON.stringify(
    { run: { id: run.id, state: run.state }, result, runJson, ledgerJson },
    (key, value) =>
      typeof value === 'string' && process.env.ARXIC_SECRET_GLM_CODING_KEY?.includes(value)
        ? '<redacted>'
        : value,
  );
  const evidence = join(root, 'docs/evidence/WEB-402-PAID-INFERENCE');
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, 'campaign-record.json'), sanitized, { mode: 0o600 });
  console.log('CAMPAIGN RESULT:', run.state, result.outcome, '|', result.summary);
  console.log('record:', join(evidence, 'campaign-record.json'));
} finally {
  await wb.close();
  await rm(repo.root, { recursive: true, force: true });
  await rm(state, { recursive: true, force: true });
  await stopApp(app.child);
}
