import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PERSIST_REDACTED_LABEL,
  PERSIST_REDACTION_PLACEHOLDER,
  scanTextForSecrets,
} from '@arxic/bundle-promoter';
import { FileStageCheckpointer, PersistedSecretError } from '..';

/**
 * Issue #474: real-world apps put `placeholder="you@example.com"` on email
 * inputs, and the DG-297 label-first chain persists that placeholder as the
 * control's `label`. The label-first/placeholder text is UI copy, not user
 * data — it must be MASKED on persist, never block the whole stage-5 surface
 * artifact (which killed every mightybox campaign run). Every pattern-class
 * match OUTSIDE a label value keeps the fail-closed refusal.
 */
describe('FileStageCheckpointer label UI-copy masking (#474)', () => {
  it('masks an email-placeholder-derived label instead of blocking the stage-5 surface artifact', async () => {
    const runsDirectory = await mkdtemp(join(tmpdir(), 'arxic-label-mask-'));
    const checkpointer = new FileStageCheckpointer(runsDirectory);
    // The exact DG-297 control shape from the live dogfood run: a
    // placeholder-only email input whose placeholder becomes the label.
    const surface = {
      routes: [
        {
          path: '/login',
          forms: [
            {
              action: 'http://127.0.0.1:1/login',
              method: 'POST',
              destructive: true,
              controls: [
                {
                  tag: 'input',
                  type: 'email',
                  name: 'email',
                  label: 'you@example.com',
                  required: true,
                },
                {
                  tag: 'input',
                  type: 'password',
                  name: 'password',
                  label: 'Password',
                  required: true,
                },
              ],
            },
          ],
        },
      ],
    };

    await checkpointer.saveArtifact('label-mask', 5, surface);

    const bytes = await readFile(join(runsDirectory, 'label-mask', 'artifacts', '05.json'), 'utf8');
    expect(bytes).not.toContain('you@example.com');
    expect(bytes).toContain(PERSIST_REDACTED_LABEL);
    expect(scanTextForSecrets(bytes)).toEqual([]);
    // Sibling labels without pattern hits keep their text verbatim.
    expect(bytes).toContain('"label":"Password"');
  });

  it('sad path: the same email outside a label value still refuses to persist', async () => {
    const runsDirectory = await mkdtemp(join(tmpdir(), 'arxic-label-refuse-'));
    const checkpointer = new FileStageCheckpointer(runsDirectory);

    await expect(
      checkpointer.saveArtifact('label-refuse', 5, {
        echo: 'contact admin@mightybox.internal',
      }),
    ).rejects.toMatchObject({
      name: 'PersistedSecretError',
      patterns: ['email-address'],
    } satisfies Partial<PersistedSecretError>);
  });

  it('persona values inside a label keep the known-value redaction precedence', async () => {
    const runsDirectory = await mkdtemp(join(tmpdir(), 'arxic-label-persona-'));
    const email = 'replay.persona@arxic.invalid';
    const checkpointer = new FileStageCheckpointer(runsDirectory, {
      redactionValues: [email],
    });

    await checkpointer.saveArtifact('label-persona', 5, {
      routes: [
        {
          path: '/',
          forms: [{ controls: [{ tag: 'input', type: 'email', label: email }] }],
        },
      ],
    });

    const bytes = await readFile(
      join(runsDirectory, 'label-persona', 'artifacts', '05.json'),
      'utf8',
    );
    expect(bytes).not.toContain(email);
    expect(bytes).toContain(PERSIST_REDACTION_PLACEHOLDER);
  });
});
