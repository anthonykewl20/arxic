import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { toProposalConsumerInventory, type DomainInventory } from '@arxic/domain-inventory';
import { MailpitContainer } from '../../../../packages/environment/src/mailpit-container';
import type { IntentLedger } from '../../../../packages/intent/src/ledger';
import {
  bootFixtureApp,
  referenceAuthApp,
  stopApp,
} from '../../../../packages/real-world-testkit/src';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';
import { Workbench } from '../workbench';

it.each(['file', 'guided', 'stale-selection', 'selected-login', 'selected-reset'] as const)(
  'runs the actual AI/compiler/verifier pipeline from a %s web project and exposes its validated intent ledger',
  async (mode) => {
    const root = resolve(import.meta.dirname, '../../../..');
    const helpersPath = pathToFileURL(join(root, 'scripts/human-flow-e2e.mjs')).href;
    const { createConfig, modelStubOutput } = await import(helpersPath);
    const mailpit = mode === 'selected-reset' ? await new MailpitContainer().start() : undefined;
    if (mailpit) {
      vi.stubEnv('ARXIC_MAILPIT_SMTP', mailpit.smtp);
      vi.stubEnv('ARXIC_MAILPIT_API', mailpit.api);
    }
    let selectedRowId: string | undefined;
    let projectId: string | undefined;
    const requestedRows: string[] = [];
    const target = await bootFixtureApp(root, referenceAuthApp, 'web-agent-reference');
    const repo = await makeRepository('reference-auth-app');
    const state = await mkdtemp(join(tmpdir(), 'web-agent-state-'));
    let requests = 0;
    const model = createServer(async (req, res) => {
      if (req.headers.authorization !== 'Bearer web-agent-test-key') {
        res.statusCode = 401;
        res.end();
        return;
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body);
      requests++;
      for (const message of data.messages) {
        const payload = message.content.match(
          /INVENTORY_DATA[^\n]*\n([\s\S]*?)\nEND_INVENTORY_DATA/u,
        )?.[1];
        if (payload)
          requestedRows.push(...JSON.parse(payload).map((row: { id: string }) => row.id));
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id: `web-agent-${requests}`,
          model: 'test-provider-boundary',
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify(
                  modelStubOutput(
                    data.messages,
                    mode === 'selected-reset'
                      ? {
                          path: '/forgot-password',
                          intent: 'request a password reset',
                          fromState: 'signed-out',
                          toState: 'reset-requested',
                          rationale:
                            'Password-reset hypothesis grounded in the supplied inventory row',
                        }
                      : undefined,
                  ),
                ),
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
    await new Promise<void>((done) => model.listen(0, '127.0.0.1', done));
    const address = model.address() as { port: number };
    vi.stubEnv('ARXIC_MODEL_PROVIDER', 'http');
    vi.stubEnv('ARXIC_MODEL_BASE_URL', `http://127.0.0.1:${address.port}`);
    vi.stubEnv('ARXIC_MODEL_API_KEY', mode !== 'guided' ? 'web-agent-test-key' : '');
    vi.stubEnv('ARXIC_INPUT_PERSONA_EMAIL', mode !== 'guided' ? 'web-agent@example.test' : '');
    vi.stubEnv('ARXIC_INPUT_PERSONA_PASSWORD', mode !== 'guided' ? 'WebAgentTest9!' : '');
    const workbench = await Workbench.open(state, [repo.root]);
    try {
      if (mode.startsWith('selected-')) {
        const connected = await workbench.saveProject({
          name: 'Selected reference',
          folder: repo.root,
          origin: target.origin,
        });
        projectId = connected.id;
        const discovery = workbench.enqueue(connected.id, 'discovery');
        await workbench.idle();
        const inventory = toProposalConsumerInventory(
          workbench.store.run(discovery.id)!.result!.inventory as DomainInventory,
        );
        selectedRowId = inventory.rows.find(
          (row) =>
            row.method === 'GET' &&
            row.path === (mode === 'selected-reset' ? '/forgot-password' : '/login'),
        )?.id;
        expect(selectedRowId).toBeDefined();
      }
      if (mode !== 'guided') {
        const config = parseYaml(
          createConfig({ origin: target.origin, repository: repo.root, revision: 'HEAD' }),
        );
        if (mode === 'stale-selection')
          config.scope.inventoryRowIds = ['inv:page:GET:000000000000'];
        if (selectedRowId) config.scope.inventoryRowIds = [selectedRowId];
        await writeFile(join(repo.root, 'arxic.yaml'), JSON.stringify(config));
        await promisify(execFile)('git', ['add', 'arxic.yaml'], { cwd: repo.root });
        await promisify(execFile)(
          'git',
          [
            '-c',
            'user.name=Arxic Test',
            '-c',
            'user.email=test@arxic.invalid',
            'commit',
            '-m',
            'test app configuration',
          ],
          { cwd: repo.root },
        );
      }
      vi.stubEnv('ARXIC_SECRET_WEB_EMAIL', 'web-agent@example.test');
      vi.stubEnv('ARXIC_SECRET_WEB_PASSWORD', 'WebAgentTest9!');
      vi.stubEnv('ARXIC_SECRET_WEB_MODEL', 'web-agent-test-key');
      const project = await workbench.saveProject(
        {
          name: 'Agent reference',
          folder: repo.root,
          origin: target.origin,
          ...(mode !== 'guided'
            ? { configPath: 'arxic.yaml' }
            : {
                execution: {
                  model: 'gpt-4o-mini',
                  modelSecretRef: 'ARXIC_SECRET_WEB_MODEL',
                  frameworks: ['nextjs'],
                  domains: ['authentication'],
                  featureFlags: { passwordReset: true },
                  maxUrls: 8,
                  maxDepth: 1,
                  maxRuntimeMinutes: 5,
                  persona: {
                    mode: 'seed-api',
                    emailRef: 'ARXIC_SECRET_WEB_EMAIL',
                    passwordRef: 'ARXIC_SECRET_WEB_PASSWORD',
                  },
                },
              }),
        },
        projectId,
      );
      const run = workbench.enqueue(project.id, 'agent');
      await workbench.idle();
      const result = workbench.store.run(run.id)!.result!;
      if (mode === 'stale-selection') {
        expect(result).toMatchObject({
          outcome: 'blocked',
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ code: 'ARXIC-ORCH-WORKFLOW-SCOPE' }),
          ]),
        });
        expect(requests).toBe(0);
        return;
      }
      expect(result, JSON.stringify(result.diagnostics)).toMatchObject({
        outcome: 'verified',
        ledger: { verification: { outcome: 'verified', passedRuns: 2, runs: 2 } },
      });
      expect(requests).toBeGreaterThan(0);
      const promoted = JSON.parse(
        await readFile(
          join(state, 'runs', run.id, 'engine', 'promoted', `${run.id}.bundle.json`),
          'utf8',
        ),
      );
      if (mode !== 'selected-reset')
        expect(promoted.workflow.transitions).toEqual(
          expect.arrayContaining([expect.objectContaining({ from: 'login-page', to: 'home' })]),
        );
      if (selectedRowId) {
        expect(new Set(requestedRows)).toEqual(new Set([selectedRowId]));
        const ledger = result.ledger as IntentLedger;
        expect(
          ledger.rows.find((row) => row.inventoryRowId === selectedRowId)?.intents,
        ).toContainEqual(
          expect.objectContaining({
            isCandidate: true,
            truthState: 'verified',
            replayStatus: 'attempted:passed',
          }),
        );
        expect(
          ledger.rows
            .filter((row) => row.inventoryRowId !== selectedRowId)
            .flatMap((row) => row.intents)
            .some((intent) => intent.isCandidate),
        ).toBe(false);
        expect(ledger.inventory.totalRows).toBeGreaterThan(1);
      }
      if (mailpit)
        expect(
          ((await (await fetch(mailpit.api + '/api/v1/messages')).json()) as { total: number })
            .total,
        ).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(result)).not.toContain('web-agent-test-key');
      expect(JSON.stringify(result)).not.toContain('WebAgentTest9!');
      // Inspect persisted settings, SQLite/WAL, engine records and safe evidence.
      for (const entry of await readdir(state, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const bytes = await readFile(join(entry.parentPath, entry.name));
        for (const value of ['web-agent-test-key', 'WebAgentTest9!', 'web-agent@example.test'])
          expect(bytes.includes(Buffer.from(value)), `Credential persisted in ${entry.name}`).toBe(
            false,
          );
      }
    } finally {
      await workbench.close();
      await mailpit?.stop();
      vi.unstubAllEnvs();
      model.closeAllConnections();
      await new Promise<void>((done) => model.close(() => done()));
      await stopApp(target.child);
      await rm(state, { recursive: true, force: true });
      await rm(repo.root, { recursive: true, force: true });
      await rm(target.runtimeDirectory, { recursive: true, force: true });
    }
  },
  300_000,
);
