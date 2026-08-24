import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/parse';
import { validateConfig } from '../config/validate';
import { toOrchestratorInput } from '../local-executor';
import { VALID_CONFIG, VALID_YAML } from './fixtures';
import type { RunRequest } from '../executor';

const TRUE_DIGEST = 'a'.repeat(64);
const TAMPERED_DIGEST = 'b'.repeat(64);

/**
 * #259 — the attestation gate's buildDigest expectation must come from an
 * INDEPENDENT operator source (config `target.expectedBuildDigest`), never
 * from the target's own attestation endpoint (self-referential: the gate
 * then compares the attestation against itself and a tampered digest passes).
 */
describe('attestation buildDigest binding (#259)', () => {
  it('accepts a config-supplied expected build digest and echoes it on the value', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-259-config-'));
    const path = join(directory, 'arxic.yaml');
    await writeFile(
      path,
      VALID_YAML.replace(
        '  attestationPath: /.well-known/arxic-test-target.json\n',
        `  attestationPath: /.well-known/arxic-test-target.json\n  expectedBuildDigest: ${TRUE_DIGEST}\n`,
      ),
    );
    const result = await loadConfig(path);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.target.expectedBuildDigest).toBe(TRUE_DIGEST);
    }
  });

  it.each([
    ['not hex', 'z'.repeat(64)],
    ['wrong length', 'a'.repeat(63)],
    ['empty', ''],
  ])('rejects an expected build digest that is %s', async (_name, value) => {
    const result = validateConfig({
      ...VALID_CONFIG,
      target: { ...VALID_CONFIG.target, expectedBuildDigest: value },
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'ARXIC-CONFIG-INVALID',
          subject: 'config.target.expectedBuildDigest',
        }),
      ],
    });
  });

  it('wires the config expectation into OrchestratorInput.expectedBuildDigest (the gate input)', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'arxic-259-input-'));
    const request: RunRequest = {
      runId: 'wire-expected-digest',
      config: {
        ...VALID_CONFIG,
        source: { ...VALID_CONFIG.source, repository },
        target: {
          ...VALID_CONFIG.target,
          expectedBuildDigest: TRUE_DIGEST,
        },
      },
      runDirectory: join(repository, 'runs'),
      rulepacksDir: join(repository, 'rulepacks'),
    };
    const input = toOrchestratorInput(request);
    expect(input.expectedBuildDigest).toBe(TRUE_DIGEST);
    expect(input.expectedBuildDigest).not.toBe(TAMPERED_DIGEST);
  });

  it('leaves expectedBuildDigest unset when the operator pins nothing (trust-on-first-use local-test, documented)', () => {
    const input = toOrchestratorInput({
      runId: 'no-pin',
      config: VALID_CONFIG,
      runDirectory: '/tmp/unused',
      rulepacksDir: '/tmp/unused',
    });
    expect(input.expectedBuildDigest).toBeUndefined();
  });
});

void execFileSync;
