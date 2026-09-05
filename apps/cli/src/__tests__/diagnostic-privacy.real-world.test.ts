import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { expect, it, vi } from 'vitest';
import { LocalRunExecutor } from '../local-executor';
import { runAction } from '../run';
import { VALID_CONFIG } from './fixtures';

it('redacts configured persona values from real attestation failures, even without replayPersona (refs #398)', async () => {
  const secret = 'Canary398!';
  const directory = await mkdtemp(join(tmpdir(), 'arxic-diagnostic-privacy-'));
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(secret);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected ephemeral TCP port');
  const origin = `http://127.0.0.1:${address.port}`;
  const emitted: unknown[] = [];
  try {
    vi.stubEnv('ARXIC_INPUT_PERSONA_EMAIL', 'release-probe@example.test');
    vi.stubEnv('ARXIC_INPUT_PERSONA_PASSWORD', secret);
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ dependencies: { next: '16.3.3' } }),
    );
    await writeFile(
      join(directory, 'arxic.yaml'),
      stringify({
        ...VALID_CONFIG,
        scope: { ...VALID_CONFIG.scope, frameworks: ['nextjs'] },
        source: { ...VALID_CONFIG.source, repository: directory, revision: 'a'.repeat(40) },
        target: { ...VALID_CONFIG.target, origin, allowedOrigins: [origin] },
        models: { provider: 'none', sourceRetention: 'disabled' },
      }),
    );
    const result = await runAction({
      configPath: join(directory, 'arxic.yaml'),
      out: join(directory, 'runs'),
      runId: 'private-diagnostics',
      rulepacksDir: resolve(import.meta.dirname, '../../../../rulepacks'),
      executor: new LocalRunExecutor(),
      sink: { emit: (diagnostic) => emitted.push(diagnostic) },
    });
    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'ARXIC-ATTESTATION-FETCH-FAILED' }),
    );
    expect(JSON.stringify(emitted)).not.toContain(secret);
    expect(
      await readFile(join(directory, 'runs/private-diagnostics/diagnostics.jsonl'), 'utf8'),
    ).not.toContain(secret);
    expect(
      await readFile(join(directory, 'runs/private-diagnostics/run.json'), 'utf8'),
    ).not.toContain(secret);
  } finally {
    vi.unstubAllEnvs();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});
