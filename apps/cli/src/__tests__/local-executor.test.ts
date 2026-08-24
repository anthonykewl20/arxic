import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunRequest } from '../executor';
import { toOrchestratorInput } from '../local-executor';
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
