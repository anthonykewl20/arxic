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
});
