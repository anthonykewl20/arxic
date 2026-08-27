import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunRequest } from '../executor';
import { configuredModel, toOrchestratorInput } from '../local-executor';
import { VALID_CONFIG } from './fixtures';

describe('toOrchestratorInput', () => {
  it('resolves HEAD to the repository full commit SHA', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'arxic-local-executor-'));
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: repository });
    await writeFile(join(repository, 'tracked.txt'), 'committed\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: repository });
    execFileSync('git', ['commit', '-m', 'fixture'], {
      cwd: repository,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Arxic Test',
        GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
        GIT_COMMITTER_NAME: 'Arxic Test',
        GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
      },
    });
    const expected = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim();
    const request: RunRequest = {
      runId: 'resolve-head',
      config: {
        ...VALID_CONFIG,
        source: { ...VALID_CONFIG.source, repository, revision: 'HEAD' },
      },
      runDirectory: join(repository, 'runs'),
      rulepacksDir: join(repository, 'rulepacks'),
    };

    expect(toOrchestratorInput(request).revision.commit).toBe(expected);
    expect(toOrchestratorInput(request).revision.commit).toMatch(/^[0-9a-f]{40}$/u);
  });

  // DG-297 E2 (#297): a declared replayPersona + env persona authenticate the
  // stage-5 crawl; EITHER missing keeps the crawl anonymous (baseline).
  it('flows the declared replayPersona into the orchestrator input only with an env persona', async () => {
    const declaration = {
      mode: 'per-pass-login' as const,
      login: {
        route: '/login',
        fields: [
          { label: 'Email', inputRef: 'persona.email' as const },
          { label: 'Password', inputRef: 'persona.password' as const },
        ],
        submit: { label: 'Login' },
      },
    };
    const request: RunRequest = {
      runId: 'replay-crawl-input',
      config: {
        ...VALID_CONFIG,
        fixtures: { ...VALID_CONFIG.fixtures, replayPersona: declaration },
      },
      runDirectory: join(tmpdir(), 'arxic-local-executor-replay'),
      rulepacksDir: join(tmpdir(), 'arxic-local-executor-replay-rulepacks'),
    };
    const previousEmail = process.env.ARXIC_INPUT_PERSONA_EMAIL;
    const previousPassword = process.env.ARXIC_INPUT_PERSONA_PASSWORD;
    try {
      process.env.ARXIC_INPUT_PERSONA_EMAIL = 'crawl@example.test';
      process.env.ARXIC_INPUT_PERSONA_PASSWORD = 'CrawlPersona1!';
      const withPersona = toOrchestratorInput(request);
      expect(withPersona.replayPersona).toEqual({
        declaration,
        persona: { email: 'crawl@example.test', password: 'CrawlPersona1!' },
      });

      delete process.env.ARXIC_INPUT_PERSONA_EMAIL;
      delete process.env.ARXIC_INPUT_PERSONA_PASSWORD;
      const withoutPersona = toOrchestratorInput({
        ...request,
        config: { ...request.config },
      });
      expect(withoutPersona.replayPersona).toBeUndefined();
    } finally {
      if (previousEmail === undefined) delete process.env.ARXIC_INPUT_PERSONA_EMAIL;
      else process.env.ARXIC_INPUT_PERSONA_EMAIL = previousEmail;
      if (previousPassword === undefined) delete process.env.ARXIC_INPUT_PERSONA_PASSWORD;
      else process.env.ARXIC_INPUT_PERSONA_PASSWORD = previousPassword;
    }
  });
});

describe('configuredModel timeout', () => {
  const request = {
    runId: 'model-timeout',
    config: VALID_CONFIG,
    runDirectory: join(tmpdir(), 'arxic-model-timeout'),
    rulepacksDir: join(tmpdir(), 'arxic-model-timeout-rulepacks'),
  } as const;

  function withModelEnv(timeout: string | undefined, callback: () => void): void {
    const previousBaseUrl = process.env.ARXIC_MODEL_BASE_URL;
    const previousApiKey = process.env.ARXIC_MODEL_API_KEY;
    const previousTimeout = process.env.ARXIC_MODEL_TIMEOUT_MS;
    try {
      process.env.ARXIC_MODEL_BASE_URL = 'https://model.example.test';
      process.env.ARXIC_MODEL_API_KEY = 'test-key';
      if (timeout === undefined) delete process.env.ARXIC_MODEL_TIMEOUT_MS;
      else process.env.ARXIC_MODEL_TIMEOUT_MS = timeout;
      callback();
    } finally {
      if (previousBaseUrl === undefined) delete process.env.ARXIC_MODEL_BASE_URL;
      else process.env.ARXIC_MODEL_BASE_URL = previousBaseUrl;
      if (previousApiKey === undefined) delete process.env.ARXIC_MODEL_API_KEY;
      else process.env.ARXIC_MODEL_API_KEY = previousApiKey;
      if (previousTimeout === undefined) delete process.env.ARXIC_MODEL_TIMEOUT_MS;
      else process.env.ARXIC_MODEL_TIMEOUT_MS = previousTimeout;
    }
  }

  function adapterTimeout(): number | undefined {
    const model = configuredModel(request);
    expect(model).toBeDefined();
    return (model!.adapter as unknown as { options: { timeoutMs?: number } }).options.timeoutMs;
  }

  it('uses 30000ms when ARXIC_MODEL_TIMEOUT_MS is unset', () => {
    withModelEnv(undefined, () => expect(adapterTimeout()).toBe(30_000));
  });

  it('passes 60000ms from ARXIC_MODEL_TIMEOUT_MS to ModelAdapter', () => {
    withModelEnv('60000', () => expect(adapterTimeout()).toBe(60_000));
  });

  it.each(['', 'not-a-number', '0', '-1', '1.5'])(
    'refuses invalid timeout %j before adapter construction',
    (timeout) => {
      withModelEnv(timeout, () =>
        expect(() => configuredModel(request)).toThrow(
          'ARXIC_MODEL_TIMEOUT_MS must be a positive integer within the Node timer range',
        ),
      );
    },
  );
});

describe('configuredModel host-bound CLI transport (#host-bound-model)', () => {
  const request = {
    runId: 'model-host-cli',
    config: VALID_CONFIG,
    runDirectory: join(tmpdir(), 'arxic-model-host-cli'),
    rulepacksDir: join(tmpdir(), 'arxic-model-host-cli-rulepacks'),
  } as const;

  async function withHostCliEnv(
    vars: Record<string, string | undefined>,
    callback: () => void | Promise<void>,
  ): Promise<void> {
    const keys = [
      'ARXIC_MODEL_PROVIDER',
      'ARXIC_MODEL_HOST_CLI',
      'ARXIC_MODEL_HOST_CLI_ARGS',
      'ARXIC_MODEL_BASE_URL',
      'ARXIC_MODEL_API_KEY',
    ] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      for (const key of keys) {
        const value = vars[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await callback();
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  }

  it('does NOT require ARXIC_MODEL_BASE_URL / ARXIC_MODEL_API_KEY when ARXIC_MODEL_PROVIDER=host-cli', async () => {
    await withHostCliEnv(
      { ARXIC_MODEL_PROVIDER: 'host-cli', ARXIC_MODEL_HOST_CLI: process.execPath },
      () => {
        const model = configuredModel(request);
        expect(model).toBeDefined();
        expect(model?.prices).toEqual({ promptPerMillion: 0, completionPerMillion: 0 });
      },
    );
  });

  it('fails closed when ARXIC_MODEL_PROVIDER=host-cli but ARXIC_MODEL_HOST_CLI is unset', async () => {
    await withHostCliEnv({ ARXIC_MODEL_PROVIDER: 'host-cli' }, () => {
      expect(() => configuredModel(request)).toThrow(/ARXIC_MODEL_HOST_CLI/);
    });
  });

  it('produces a host-bound run record with zero tokens end-to-end', async () => {
    await withHostCliEnv(
      {
        ARXIC_MODEL_PROVIDER: 'host-cli',
        ARXIC_MODEL_HOST_CLI: process.execPath,
        ARXIC_MODEL_HOST_CLI_ARGS: JSON.stringify([
          '-e',
          'process.stdout.write(JSON.stringify({schemaVersion:"arxic-stage4-inference-v1",candidates:[]}))',
        ]),
      },
      async () => {
        const model = configuredModel(request);
        expect(model).toBeDefined();
        const result = await model!.adapter.requestStructuredOutput({
          model: 'host-cli',
          messages: [{ role: 'user', content: 'produce bounded candidate data' }],
          schema: {
            type: 'object',
            required: ['schemaVersion', 'candidates'],
            additionalProperties: false,
            properties: {
              schemaVersion: { type: 'string' },
              candidates: { type: 'array' },
            },
          },
          schemaVersion: 'arxic-stage4-inference-v1',
        });
        expect(result.ok).toBe(true);
        expect(result.runRecord.provider).toBe('host-bound');
        expect(result.runRecord.tokens).toEqual({ prompt: 0, completion: 0, total: 0 });
      },
    );
  });
});
