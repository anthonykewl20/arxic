import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it, vi } from 'vitest';
import {
  bootFixtureApp,
  referenceAuthApp,
  stopApp,
} from '../../../../packages/real-world-testkit/src';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';
import { Workbench } from '../workbench';

it('runs the actual AI/compiler/verifier pipeline from a saved web project and exposes its validated intent ledger', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const helpersPath = pathToFileURL(join(root, 'scripts/human-flow-e2e.mjs')).href;
  const { createConfig, modelStubOutput } = await import(helpersPath);
  const target = await bootFixtureApp(root, referenceAuthApp, 'web-agent-reference');
  const repo = await makeRepository('reference-auth-app');
  const state = await mkdtemp(join(tmpdir(), 'web-agent-state-'));
  let requests = 0;
  const model = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    requests++;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        id: `web-agent-${requests}`,
        model: 'test-provider-boundary',
        choices: [
          {
            message: { role: 'assistant', content: JSON.stringify(modelStubOutput(data.messages)) },
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
  vi.stubEnv('ARXIC_MODEL_API_KEY', 'web-agent-test-key');
  vi.stubEnv('ARXIC_INPUT_PERSONA_EMAIL', 'web-agent@example.test');
  vi.stubEnv('ARXIC_INPUT_PERSONA_PASSWORD', 'WebAgentTest9!');
  const workbench = await Workbench.open(state, [repo.root]);
  try {
    await writeFile(
      join(repo.root, 'arxic.yaml'),
      createConfig({ origin: target.origin, repository: repo.root, revision: 'HEAD' }),
    );
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
    const project = await workbench.saveProject({
      name: 'Agent reference',
      folder: repo.root,
      origin: target.origin,
      configPath: 'arxic.yaml',
    });
    const run = workbench.enqueue(project.id, 'agent');
    await workbench.idle();
    const result = workbench.store.run(run.id)!.result!;
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
    expect(promoted.workflow.transitions).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: 'login-page', to: 'home' })]),
    );
    expect(JSON.stringify(result)).not.toContain('web-agent-test-key');
    expect(JSON.stringify(result)).not.toContain('WebAgentTest9!');
  } finally {
    await workbench.close();
    vi.unstubAllEnvs();
    model.closeAllConnections();
    await new Promise<void>((done) => model.close(() => done()));
    await stopApp(target.child);
    await rm(state, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
    await rm(target.runtimeDirectory, { recursive: true, force: true });
  }
}, 300_000);
