import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERSIST_REDACTION_PLACEHOLDER, scanTextForSecrets } from '@arxic/bundle-promoter';
import { FileStageCheckpointer, PersistedSecretError } from '..';

describe('FileStageCheckpointer persisted persona redaction (#358)', () => {
  it('redacts replay-persona credential literals before persisting artifacts and checkpoints', async () => {
    const runsDirectory = await mkdtemp(join(tmpdir(), 'arxic-persona-persist-'));
    const email = 'replay.persona@arxic.invalid';
    const password = 'ReplayPersona1!';
    const checkpointer = new FileStageCheckpointer(runsDirectory, {
      redactionValues: [email, password],
    });
    const artifact = {
      config: { fixtures: { replayPersona: { email, password } } },
      echo: `${email}\n${password}`,
    };

    await checkpointer.saveArtifact('persona-redaction', 1, artifact);

    const bytes = await readFile(
      join(runsDirectory, 'persona-redaction', 'artifacts', '01.json'),
      'utf8',
    );
    expect(bytes).not.toContain(email);
    expect(bytes).not.toContain(password);
    expect(bytes).toContain(PERSIST_REDACTION_PLACEHOLDER);
    expect(scanTextForSecrets(bytes)).toEqual([]);
  });

  it('fails closed on password-literal matches in a credential-bearing surface artifact', async () => {
    const runsDirectory = await mkdtemp(join(tmpdir(), 'arxic-persona-persist-fail-'));
    const checkpointer = new FileStageCheckpointer(runsDirectory);

    await expect(
      checkpointer.saveArtifact('persona-redaction-fail', 5, {
        echo: 'password: ReplayPersona1!',
      }),
    ).rejects.toMatchObject({
      name: 'PersistedSecretError',
      code: 'ARXIC-PROMOTION-REDACTION-FAILED',
      patterns: ['password-literal'],
    } satisfies Partial<PersistedSecretError>);
  });

  it('sad path: permits source-bearing stage content that looks like a password literal', async () => {
    const runsDirectory = await mkdtemp(join(tmpdir(), 'arxic-persona-source-content-'));
    const checkpointer = new FileStageCheckpointer(runsDirectory, {
      redactionValues: ['replay.persona@arxic.invalid', 'ReplayPersona1!'],
    });

    await expect(
      checkpointer.saveArtifact('persona-source-content', 1, {
        source: "const seeded = { password: 'Hunter2!' };",
      }),
    ).resolves.toMatchObject({ id: 'stage:1' });
  });
});
