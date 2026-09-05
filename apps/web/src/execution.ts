import type { ArxicConfig } from '../../worker/src/run-spec';
import { validateConfig } from '../../cli/src/config/validate';
import { HttpError } from './errors';
import { modelEnvironment, validateConnection } from './model-connections';

export type ExecutionSettings = {
  modelConnection?: string;
  model: string;
  modelSecretRef: string;
  modelBudgetUsd: number;
  frameworks: string[];
  domains: string[];
  languages: string[];
  featureFlags: Record<string, boolean>;
  environmentClass: 'local-test' | 'preview' | 'staging';
  attestationPath: string;
  maxUrls: number;
  maxDepth: number;
  maxRuntimeMinutes: number;
  persona: {
    mode: 'anonymous' | 'seed-api' | 'per-pass-login';
    emailRef: string;
    passwordRef: string;
    newPasswordRef: string;
    loginPath: string;
    emailLabel: string;
    passwordLabel: string;
    submitLabel: string;
  };
};

const object = (input: unknown, keys: string[]): Record<string, unknown> => {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    throw new HttpError(400, 'Unknown or malformed AI execution setting');
  return input as Record<string, unknown>;
};
const string = (value: unknown, fallback = ''): string => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > 200)
    throw new HttpError(400, 'Invalid AI execution text setting');
  return value.trim();
};
export const secretRef = (value: unknown): string => {
  const ref = string(value);
  if (ref && !/^ARXIC_SECRET_[A-Z][A-Z0-9_]{0,80}$/u.test(ref))
    throw new HttpError(
      400,
      'Secret references must name an ARXIC_SECRET_ environment variable; credential values are not accepted',
    );
  return ref;
};
const number = (value: unknown, fallback: number, max: number, integer = true): number => {
  const selected = value ?? fallback;
  if (
    typeof selected !== 'number' ||
    !Number.isFinite(selected) ||
    selected < (integer ? 1 : 0) ||
    selected > max ||
    (integer && !Number.isInteger(selected))
  )
    throw new HttpError(400, 'AI execution budget is outside the supported range');
  return selected;
};
const strings = (value: unknown, fallback: string[]): string[] => {
  if (value === undefined) return fallback;
  if (
    !Array.isArray(value) ||
    value.length > 30 ||
    value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 100)
  )
    throw new HttpError(400, 'Invalid AI execution scope');
  return [...new Set(value.map((item) => item.trim()))];
};

export function validateExecution(
  value: unknown,
  folder: string,
  origin: string,
): ExecutionSettings | undefined {
  if (value === undefined || value === null) return undefined;
  if (!origin) throw new HttpError(400, 'AI execution requires a running test app origin');
  const input = object(value, [
    'modelConnection',
    'model',
    'modelSecretRef',
    'modelBudgetUsd',
    'frameworks',
    'domains',
    'languages',
    'featureFlags',
    'environmentClass',
    'attestationPath',
    'maxUrls',
    'maxDepth',
    'maxRuntimeMinutes',
    'persona',
  ]);
  const persona = object(input.persona ?? {}, [
    'mode',
    'emailRef',
    'passwordRef',
    'newPasswordRef',
    'loginPath',
    'emailLabel',
    'passwordLabel',
    'submitLabel',
  ]);
  const mode = persona.mode ?? 'anonymous';
  if (mode !== 'anonymous' && mode !== 'seed-api' && mode !== 'per-pass-login')
    throw new HttpError(400, 'Choose anonymous, seed-api or per-pass-login persona mode');
  const emailRef = secretRef(persona.emailRef);
  const passwordRef = secretRef(persona.passwordRef);
  const newPasswordRef = secretRef(persona.newPasswordRef);
  if (mode !== 'anonymous' && (!emailRef || !passwordRef))
    throw new HttpError(400, 'A test persona requires email and password secret references');
  if (mode === 'anonymous' && (emailRef || passwordRef || newPasswordRef))
    throw new HttpError(400, 'Anonymous execution cannot select persona secrets');
  const environmentClass = input.environmentClass ?? 'local-test';
  if (
    environmentClass !== 'local-test' &&
    environmentClass !== 'preview' &&
    environmentClass !== 'staging'
  )
    throw new HttpError(400, 'Choose a local-test, preview or staging environment');
  const flags = input.featureFlags ?? {};
  if (
    !flags ||
    typeof flags !== 'object' ||
    Array.isArray(flags) ||
    Object.entries(flags).length > 30 ||
    Object.entries(flags).some(
      ([key, flag]) => !/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/u.test(key) || typeof flag !== 'boolean',
    )
  )
    throw new HttpError(
      400,
      'Feature flags must be named boolean declarations matching the deployment',
    );
  const settings: ExecutionSettings = {
    modelConnection: validateConnection(input.modelConnection),
    model: string(input.model),
    modelSecretRef: secretRef(input.modelSecretRef),
    modelBudgetUsd: number(input.modelBudgetUsd, 0.025, 100, false),
    frameworks: strings(input.frameworks, []),
    domains: strings(input.domains, []),
    languages: strings(input.languages, ['typescript', 'javascript']),
    featureFlags: flags as Record<string, boolean>,
    environmentClass,
    attestationPath: string(input.attestationPath, '/.well-known/arxic-test-target.json'),
    maxUrls: number(input.maxUrls, 20, 500),
    maxDepth: number(input.maxDepth, 2, 10),
    maxRuntimeMinutes: number(input.maxRuntimeMinutes, 10, 30),
    persona: {
      mode,
      emailRef,
      passwordRef,
      newPasswordRef,
      loginPath: string(persona.loginPath, '/login'),
      emailLabel: string(persona.emailLabel, 'Email'),
      passwordLabel: string(persona.passwordLabel, 'Password'),
      submitLabel: string(persona.submitLabel, 'Login'),
    },
  };
  // The engine-owned validator remains authoritative for configuration policy.
  executionConfig(settings, folder, origin);
  return settings;
}

export function executionConfig(
  settings: ExecutionSettings,
  folder: string,
  origin: string,
): ArxicConfig {
  const { persona } = settings;
  const result = validateConfig({
    version: 1,
    source: { repository: folder, revision: 'HEAD', languages: settings.languages },
    scope: {
      domains: settings.domains,
      frameworks: settings.frameworks,
      browsers: ['chromium'],
      personas: persona.mode === 'anonymous' ? ['anonymous'] : ['anonymous', 'registered-user'],
      featureFlags: settings.featureFlags,
    },
    target: {
      origin,
      environmentClass: settings.environmentClass,
      attestationPath: settings.attestationPath,
      allowedOrigins: [origin],
    },
    policy: {
      maxUrls: settings.maxUrls,
      maxDepth: settings.maxDepth,
      maxRuntimeMinutes: settings.maxRuntimeMinutes,
      mutation: 'leased-fixtures-only',
      externalNetwork: 'deny',
      requiredVerificationRuns: 2,
      screenshots: 'transition-checkpoints',
      trace: 'retain',
      humanApproval: ['destructive', 'external-side-effect'],
    },
    fixtures:
      persona.mode === 'per-pass-login'
        ? {
            replayPersona: {
              mode: 'per-pass-login',
              login: {
                route: persona.loginPath,
                fields: [
                  { label: persona.emailLabel, inputRef: 'persona.email' },
                  { label: persona.passwordLabel, inputRef: 'persona.password' },
                ],
                submit: { label: persona.submitLabel },
              },
            },
          }
        : persona.mode === 'seed-api'
          ? { personaProvisioner: 'app-seed-api' }
          : {},
    models: { provider: settings.model, sourceRetention: 'disabled' },
  });
  if (!result.ok)
    throw new HttpError(
      400,
      'AI execution configuration was refused by the engine; check model, scope and persona settings',
    );
  return result.value;
}

/** Resolves names for a single child only; values never enter project/run JSON. */
export function executionEnvironment(
  settings: ExecutionSettings,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const overrides: NodeJS.ProcessEnv = {
    ARXIC_MODEL_BUDGET_USD: String(settings.modelBudgetUsd),
    ARXIC_INPUT_PERSONA_EMAIL: undefined,
    ARXIC_INPUT_PERSONA_PASSWORD: undefined,
    ARXIC_INPUT_PERSONA_NEWPASSWORD: undefined,
  };
  return {
    ...overrides,
    ...modelEnvironment(settings.modelConnection, settings.model, settings.modelSecretRef, env),
    ...secretEnvironment(
      [
        [settings.persona.emailRef, 'ARXIC_INPUT_PERSONA_EMAIL'],
        [settings.persona.passwordRef, 'ARXIC_INPUT_PERSONA_PASSWORD'],
        [settings.persona.newPasswordRef, 'ARXIC_INPUT_PERSONA_NEWPASSWORD'],
      ],
      env,
    ),
  };
}

/** Resolves an explicitly named binding set; callers choose the destination policy. */
export function secretEnvironment(
  bindings: readonly (readonly [string, string])[],
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const overrides: NodeJS.ProcessEnv = {};
  for (const [ref, name] of bindings) {
    if (!ref) continue;
    const value = env[secretRef(ref)];
    if (!value)
      throw new HttpError(400, 'A selected secret reference is not available on this server');
    overrides[name] = value;
  }
  return overrides;
}
