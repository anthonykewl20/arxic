import { expect, it } from 'vitest';
import { validateWorkerSecurity } from '../../../worker/src/worker-policy';
import { validateConfig } from '../config/validate';
import { VALID_CONFIG } from './fixtures';
import type { ArxicConfig } from '../../../worker/src/run-spec';

it.each(['', null, 42, [], {}])('refuses malformed provider declarations %j', (value) => {
  for (const field of ['inbox', 'otp', 'personaProvisioner']) {
    const config = {
      ...VALID_CONFIG,
      fixtures: { ...VALID_CONFIG.fixtures, [field]: value },
    } as ArxicConfig;
    expect(validateConfig(config).ok).toBe(false);
    expect(validateWorkerSecurity({ runId: 'fixture-provider-test', config }).ok).toBe(false);
  }
});

it.each(['inbox', 'otp', 'personaProvisioner'] as const)(
  'refuses unsupported %s at CLI and worker boundaries without disclosing its value',
  (field) => {
    const supplied = 'unsupported-provider-private-canary';
    const config = { ...VALID_CONFIG, fixtures: { ...VALID_CONFIG.fixtures, [field]: supplied } };
    const cli = validateConfig(config);
    expect.soft(cli).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'ARXIC-CONFIG-INVALID',
          subject: `config.fixtures.${field}`,
        }),
      ]),
    });
    const worker = validateWorkerSecurity({ runId: 'fixture-provider-test', config });
    expect.soft(worker.ok).toBe(false);
    expect.soft(JSON.stringify(worker)).toContain(`config.fixtures.${field}`);
    expect.soft(JSON.stringify([cli, worker])).not.toContain(supplied);
  },
);

it('retains documented and omitted provider declarations', () => {
  for (const fixtures of [VALID_CONFIG.fixtures, {}, { personaProvisioner: 'boot-seeded-admin' }]) {
    const config = { ...VALID_CONFIG, fixtures };
    expect(validateConfig(config)).toEqual({ ok: true, value: config });
    expect(validateWorkerSecurity({ runId: 'fixture-provider-test', config })).toEqual({
      ok: true,
    });
  }
});
