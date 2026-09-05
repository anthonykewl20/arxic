import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/parse';
import { validateConfig } from '../config/validate';
import { VALID_CONFIG, VALID_YAML } from './fixtures';

describe('CLI configuration sad paths', () => {
  it.each([{ browsers: [] }, { browsers: ['firefox'] }, { browsers: ['chromium', 'webkit'] }])(
    'refuses an unsupported browser selection %j',
    ({ browsers }) => {
      expect(
        validateConfig({ ...VALID_CONFIG, scope: { ...VALID_CONFIG.scope, browsers } }).ok,
      ).toBe(false);
    },
  );
  it.each([{ trace: 'discard' }, { screenshots: 'off' }])(
    'refuses a capture policy that the managed pipeline cannot honor: %j',
    (policy) => {
      expect(
        validateConfig({ ...VALID_CONFIG, policy: { ...VALID_CONFIG.policy, ...policy } }).ok,
      ).toBe(false);
    },
  );

  it('fails closed with a stable diagnostic when the file is missing', async () => {
    const result = await loadConfig(join(tmpdir(), `missing-arxic-${process.pid}.yaml`));
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'ARXIC-CONFIG-MISSING', severity: 'blocked' }],
    });
  });

  it('fails closed when YAML is malformed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-config-'));
    const path = join(directory, 'arxic.yaml');
    await writeFile(path, 'version: [unterminated\n');
    const result = await loadConfig(path);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'ARXIC-CONFIG-PARSE' }] });
  });

  it('rejects an unsupported version', () => {
    expect(codes(validateConfig({ ...VALID_CONFIG, version: 2 }))).toContain(
      'ARXIC-CONFIG-VERSION',
    );
  });

  it('rejects missing model configuration with its dedicated code', () => {
    const withoutModels = Object.fromEntries(
      Object.entries(VALID_CONFIG).filter(([key]) => key !== 'models'),
    );
    expect(codes(validateConfig(withoutModels))).toContain('ARXIC-CONFIG-MODEL-MISSING');
  });

  it('refuses production targets by default', () => {
    const input = {
      ...VALID_CONFIG,
      target: { ...VALID_CONFIG.target, environmentClass: 'production' },
    };
    expect(codes(validateConfig(input))).toContain('ARXIC-CONFIG-INVALID');
  });

  it('rejects a target origin that is not an HTTP URL', () => {
    const input = { ...VALID_CONFIG, target: { ...VALID_CONFIG.target, origin: 'localhost' } };
    const result = validateConfig(input);
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ subject: 'config.target.origin', code: 'ARXIC-CONFIG-INVALID' }],
    });
  });

  it('rejects a target origin containing URL credentials', () => {
    const input = {
      ...VALID_CONFIG,
      target: { ...VALID_CONFIG.target, origin: 'http://alice:secret@127.0.0.1:1' },
    };
    expect(validateConfig(input)).toMatchObject({
      ok: false,
      diagnostics: [{ subject: 'config.target.origin', code: 'ARXIC-CONFIG-INVALID' }],
    });
  });

  it('rejects an allowed origin containing URL credentials', () => {
    const input = {
      ...VALID_CONFIG,
      target: {
        ...VALID_CONFIG.target,
        allowedOrigins: ['http://alice:secret@127.0.0.1:1'],
      },
    };
    expect(validateConfig(input)).toMatchObject({
      ok: false,
      diagnostics: [{ subject: 'config.target.allowedOrigins', code: 'ARXIC-CONFIG-INVALID' }],
    });
  });

  it('rejects an origin that is not listed in allowedOrigins', () => {
    const input = {
      ...VALID_CONFIG,
      target: { ...VALID_CONFIG.target, allowedOrigins: ['http://127.0.0.1:2'] },
    };
    expect(validateConfig(input)).toMatchObject({
      ok: false,
      diagnostics: [
        {
          subject: 'config.target.origin',
          code: 'ARXIC-CONFIG-INVALID',
          message: 'config.target.origin must be listed in config.target.allowedOrigins',
        },
      ],
    });
  });

  it('rejects unsupported external network policy', () => {
    const input = {
      ...VALID_CONFIG,
      policy: { ...VALID_CONFIG.policy, externalNetwork: 'public' },
    };
    expect(codes(validateConfig(input))).toContain('ARXIC-CONFIG-INVALID');
  });

  // #104: these values passed CLI validation but are rejected at run time by the worker's
  // validateWorkerSecurity, and nothing in the pipeline ever read them — so they were
  // silently inert. A safety setting the CLI cannot honour must fail closed at config time.
  it.each([
    ['externalNetwork', 'allow'],
    ['mutation', 'allow'],
    ['mutation', 'deny'],
  ])('rejects policy.%s = %s, which the worker refuses at run time', (field, value) => {
    const input = { ...VALID_CONFIG, policy: { ...VALID_CONFIG.policy, [field]: value } };
    expect(codes(validateConfig(input))).toContain('ARXIC-CONFIG-INVALID');
  });

  it('accepts the ADR §19 policy pair', () => {
    const input = {
      ...VALID_CONFIG,
      policy: {
        ...VALID_CONFIG.policy,
        mutation: 'leased-fixtures-only',
        externalNetwork: 'deny',
      },
    };
    expect(codes(validateConfig(input))).not.toContain('ARXIC-CONFIG-INVALID');
  });

  it('rejects missing source languages', () => {
    const source = Object.fromEntries(
      Object.entries(VALID_CONFIG.source).filter(([key]) => key !== 'languages'),
    );
    expect(codes(validateConfig({ ...VALID_CONFIG, source }))).toContain('ARXIC-CONFIG-INVALID');
  });

  it('rejects an empty frameworks list', () => {
    const input = { ...VALID_CONFIG, scope: { ...VALID_CONFIG.scope, frameworks: [] } };
    expect(validateConfig(input)).toMatchObject({
      ok: false,
      diagnostics: [{ subject: 'config.scope.frameworks', code: 'ARXIC-CONFIG-INVALID' }],
    });
  });

  it.each([0, 1])(
    'rejects %s required verification runs below the two-pass release minimum',
    (requiredVerificationRuns) => {
      const input = {
        ...VALID_CONFIG,
        policy: { ...VALID_CONFIG.policy, requiredVerificationRuns },
      };
      expect(codes(validateConfig(input))).toContain('ARXIC-CONFIG-INVALID');
    },
  );

  it('consistently rejects unknown top-level keys', () => {
    const result = validateConfig({ ...VALID_CONFIG, futurePolicyBypass: true });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'ARXIC-CONFIG-INVALID', subject: 'config.futurePolicyBypass' }],
    });
  });

  it('collects all independent violations', () => {
    const result = validateConfig({ version: 2, models: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.length).toBeGreaterThan(5);
      expect(result.diagnostics.every((diagnostic) => diagnostic.severity === 'blocked')).toBe(
        true,
      );
    }
  });
});

describe('CLI configuration happy path', () => {
  it('accepts a target origin listed in allowedOrigins', () => {
    expect(validateConfig(VALID_CONFIG)).toEqual({ ok: true, value: VALID_CONFIG });
  });

  it('loads the real ADR section 19 YAML shape from a real file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-config-real-'));
    const path = join(directory, 'arxic.yaml');
    await writeFile(path, VALID_YAML);
    const result = await loadConfig(path);
    expect(result).toEqual({ ok: true, value: VALID_CONFIG });
    if (result.ok) {
      expect(result.value.source.languages).toEqual(['typescript', 'javascript']);
      expect(result.value.policy.requiredVerificationRuns).toBe(2);
      expect(result.value.target.origin).toBe('http://127.0.0.1:1');
    }
  });
});

describe('CLI configuration: fixtures.replayPersona (#288 frozen contract)', () => {
  const DECLARED_CONFIG = {
    ...VALID_CONFIG,
    fixtures: {
      ...VALID_CONFIG.fixtures,
      replayPersona: {
        mode: 'per-pass-login',
        login: {
          route: '/login',
          fields: [
            { label: 'Email', inputRef: 'persona.email' },
            { label: 'Password', inputRef: 'persona.password' },
          ],
          submit: { label: 'Login' },
        },
      },
    },
  };

  it('accepts the frozen per-pass-login declaration and echoes it on the value', () => {
    const result = validateConfig(DECLARED_CONFIG);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.fixtures.replayPersona).toEqual({
        mode: 'per-pass-login',
        login: {
          route: '/login',
          fields: [
            { label: 'Email', inputRef: 'persona.email' },
            { label: 'Password', inputRef: 'persona.password' },
          ],
          submit: { label: 'Login' },
        },
      });
    }
  });

  it('loads the declaration from a real YAML file (env-only credentials, locator metadata only)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-config-replay-'));
    const path = join(directory, 'arxic.yaml');
    await writeFile(
      path,
      VALID_YAML.replace(
        '  personaProvisioner: app-seed-api\n',
        `  personaProvisioner: app-seed-api
  replayPersona:
    mode: per-pass-login
    login:
      route: /login
      fields:
        - { label: Email, inputRef: persona.email }
        - { label: Password, inputRef: persona.password }
      submit: { label: Login }
`,
      ),
    );
    const result = await loadConfig(path);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.fixtures.replayPersona).toEqual({
        mode: 'per-pass-login',
        login: {
          route: '/login',
          fields: [
            { label: 'Email', inputRef: 'persona.email' },
            { label: 'Password', inputRef: 'persona.password' },
          ],
          submit: { label: 'Login' },
        },
      });
    }
  });

  it.each([
    ['unknown mode', { mode: 'per-pass-reset' }],
    ['missing mode', 'missing'],
  ])('rejects a declaration with %s (closed enum)', (_name, modeOverride) => {
    const declared = DECLARED_CONFIG.fixtures.replayPersona as Record<string, unknown>;
    const replayPersona =
      modeOverride === 'missing'
        ? Object.fromEntries(Object.entries(declared).filter(([key]) => key !== 'mode'))
        : { ...declared, mode: modeOverride };
    const result = validateConfig({
      ...DECLARED_CONFIG,
      fixtures: { ...DECLARED_CONFIG.fixtures, replayPersona },
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'ARXIC-VERIFY-FIXTURE-DECLARATION-INVALID',
          severity: 'blocked',
          subject: 'config.fixtures.replayPersona.mode',
        }),
      ],
    });
  });

  it('rejects a malformed login route', () => {
    for (const route of ['', 'login', 'http://evil.example/login']) {
      const result = validateConfig({
        ...DECLARED_CONFIG,
        fixtures: {
          ...DECLARED_CONFIG.fixtures,
          replayPersona: {
            mode: 'per-pass-login',
            login: { ...DECLARED_CONFIG.fixtures.replayPersona.login, route },
          },
        },
      });
      expect(result).toMatchObject({
        ok: false,
        diagnostics: [
          expect.objectContaining({
            code: 'ARXIC-VERIFY-FIXTURE-DECLARATION-INVALID',
            subject: 'config.fixtures.replayPersona.login.route',
          }),
        ],
      });
    }
  });

  it.each([
    ['an unknown inputRef', [{ label: 'Email', inputRef: 'env.ADMIN_PASSWORD' }]],
    ['a field missing its label', [{ label: '', inputRef: 'persona.email' }]],
    ['a field missing its inputRef', [{ label: 'Email' }]],
  ])('rejects login fields with %s', (_name, fields) => {
    const result = validateConfig({
      ...DECLARED_CONFIG,
      fixtures: {
        ...DECLARED_CONFIG.fixtures,
        replayPersona: {
          mode: 'per-pass-login',
          login: { ...DECLARED_CONFIG.fixtures.replayPersona.login, fields },
        },
      },
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'ARXIC-VERIFY-FIXTURE-DECLARATION-INVALID',
          subject: 'config.fixtures.replayPersona.login.fields',
        }),
      ],
    });
  });

  it('rejects an empty login fields list', () => {
    const result = validateConfig({
      ...DECLARED_CONFIG,
      fixtures: {
        ...DECLARED_CONFIG.fixtures,
        replayPersona: {
          mode: 'per-pass-login',
          login: { ...DECLARED_CONFIG.fixtures.replayPersona.login, fields: [] },
        },
      },
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'ARXIC-VERIFY-FIXTURE-DECLARATION-INVALID',
          subject: 'config.fixtures.replayPersona.login.fields',
        }),
      ],
    });
  });

  it.each([
    ['a missing submit block', undefined],
    ['an empty submit label', { label: '' }],
  ])('rejects a login block with %s', (_name, submit) => {
    const login = { ...DECLARED_CONFIG.fixtures.replayPersona.login } as Record<string, unknown>;
    delete login.submit;
    if (submit !== undefined) login.submit = submit;
    const result = validateConfig({
      ...DECLARED_CONFIG,
      fixtures: {
        ...DECLARED_CONFIG.fixtures,
        replayPersona: { mode: 'per-pass-login', login },
      },
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'ARXIC-VERIFY-FIXTURE-DECLARATION-INVALID',
          subject: 'config.fixtures.replayPersona.login.submit',
        }),
      ],
    });
  });

  it('rejects a missing login block outright', () => {
    const result = validateConfig({
      ...DECLARED_CONFIG,
      fixtures: { ...DECLARED_CONFIG.fixtures, replayPersona: { mode: 'per-pass-login' } },
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'ARXIC-VERIFY-FIXTURE-DECLARATION-INVALID',
          subject: 'config.fixtures.replayPersona.login',
        }),
      ],
    });
  });

  it('refuses a production-shaped target carrying the declaration with PROD-REFUSED', () => {
    const result = validateConfig({
      ...DECLARED_CONFIG,
      target: { ...DECLARED_CONFIG.target, environmentClass: 'production' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'ARXIC-VERIFY-FIXTURE-PROD-REFUSED',
          severity: 'blocked',
        }),
      );
      // The default production refusal stays in force alongside the specific code.
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'ARXIC-CONFIG-INVALID',
          subject: 'config.target.environmentClass',
        }),
      );
    }
  });
});

function codes(result: ReturnType<typeof validateConfig>): string[] {
  return result.ok ? [] : result.diagnostics.map((diagnostic) => diagnostic.code);
}
