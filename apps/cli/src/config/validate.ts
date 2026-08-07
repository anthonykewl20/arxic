import type { Diagnostic } from '@arxic/contracts';
import type { ArxicConfig } from '@arxic/worker';
import {
  ARXIC_CONFIG_INVALID,
  ARXIC_CONFIG_MODEL_MISSING,
  ARXIC_CONFIG_VERSION,
  cliDiagnostic,
} from '../diagnostics';

type ValidationResult = { ok: true; value: ArxicConfig } | { ok: false; diagnostics: Diagnostic[] };

const TOP_LEVEL_KEYS = new Set([
  'version',
  'source',
  'scope',
  'target',
  'policy',
  'fixtures',
  'models',
]);

export function validateConfig(input: unknown): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  if (!isPlainObject(input)) {
    invalid(diagnostics, 'config', 'must be a plain object');
    return { ok: false, diagnostics };
  }

  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_KEYS.has(key)) invalid(diagnostics, `config.${key}`, 'is not a recognized key');
  }
  if (input.version !== 1) {
    diagnostics.push(
      cliDiagnostic(
        ARXIC_CONFIG_VERSION,
        'blocked',
        'config.version',
        'config.version must equal 1',
      ),
    );
  }

  const source = objectField(input, 'source', diagnostics);
  const repository = nonEmptyString(source?.repository, 'config.source.repository', diagnostics);
  const revision =
    source?.revision === undefined
      ? 'HEAD'
      : stringField(source.revision, 'config.source.revision', diagnostics);
  const languages = stringArray(source?.languages, 'config.source.languages', diagnostics, true);

  const scope = objectField(input, 'scope', diagnostics);
  const domains = stringArray(scope?.domains, 'config.scope.domains', diagnostics, true);
  const frameworks = stringArray(scope?.frameworks, 'config.scope.frameworks', diagnostics, true);
  const browsers = stringArray(scope?.browsers, 'config.scope.browsers', diagnostics);
  const personas = stringArray(scope?.personas, 'config.scope.personas', diagnostics);
  const featureFlags = recordOfBooleans(
    scope?.featureFlags,
    'config.scope.featureFlags',
    diagnostics,
  );

  const target = objectField(input, 'target', diagnostics);
  const origin = httpUrl(target?.origin, 'config.target.origin', diagnostics);
  const environmentClass = nonEmptyString(
    target?.environmentClass,
    'config.target.environmentClass',
    diagnostics,
  );
  if (
    environmentClass !== undefined &&
    !['local-test', 'preview', 'staging'].includes(environmentClass)
  ) {
    invalid(
      diagnostics,
      'config.target.environmentClass',
      'must be one of local-test, preview, or staging; production is refused by default',
    );
  }
  const attestationPath = nonEmptyString(
    target?.attestationPath,
    'config.target.attestationPath',
    diagnostics,
  );
  if (attestationPath !== undefined && !attestationPath.startsWith('/')) {
    invalid(diagnostics, 'config.target.attestationPath', 'must start with /');
  }
  const allowedOrigins = urlArray(
    target?.allowedOrigins,
    'config.target.allowedOrigins',
    diagnostics,
  );
  if (origin !== undefined && allowedOrigins !== undefined && !allowedOrigins.includes(origin)) {
    invalid(diagnostics, 'config.target.origin', 'must be listed in config.target.allowedOrigins');
  }

  const policy = objectField(input, 'policy', diagnostics);
  const maxUrls = positiveInteger(policy?.maxUrls, 'config.policy.maxUrls', diagnostics);
  const maxDepth = positiveInteger(policy?.maxDepth, 'config.policy.maxDepth', diagnostics);
  const maxRuntimeMinutes = positiveInteger(
    policy?.maxRuntimeMinutes,
    'config.policy.maxRuntimeMinutes',
    diagnostics,
  );
  const requiredVerificationRuns =
    policy?.requiredVerificationRuns === undefined
      ? 2
      : positiveInteger(
          policy.requiredVerificationRuns,
          'config.policy.requiredVerificationRuns',
          diagnostics,
        );
  const mutation = nonEmptyString(policy?.mutation, 'config.policy.mutation', diagnostics);
  if (mutation !== undefined && !['leased-fixtures-only', 'deny', 'allow'].includes(mutation)) {
    invalid(diagnostics, 'config.policy.mutation', 'must be leased-fixtures-only, deny, or allow');
  }
  const externalNetwork = nonEmptyString(
    policy?.externalNetwork,
    'config.policy.externalNetwork',
    diagnostics,
  );
  if (externalNetwork !== undefined && !['deny', 'allow'].includes(externalNetwork)) {
    invalid(diagnostics, 'config.policy.externalNetwork', 'must be deny or allow');
  }
  const screenshots = nonEmptyString(policy?.screenshots, 'config.policy.screenshots', diagnostics);
  const trace = nonEmptyString(policy?.trace, 'config.policy.trace', diagnostics);
  const humanApproval = stringArray(
    policy?.humanApproval,
    'config.policy.humanApproval',
    diagnostics,
  );

  const fixtures = objectField(input, 'fixtures', diagnostics);
  const inbox = optionalString(fixtures?.inbox, 'config.fixtures.inbox', diagnostics);
  const otp = optionalString(fixtures?.otp, 'config.fixtures.otp', diagnostics);
  const personaProvisioner = optionalString(
    fixtures?.personaProvisioner,
    'config.fixtures.personaProvisioner',
    diagnostics,
  );

  const models = isPlainObject(input.models) ? input.models : undefined;
  if (!models) {
    diagnostics.push(
      cliDiagnostic(
        ARXIC_CONFIG_MODEL_MISSING,
        'blocked',
        'config.models',
        'config.models is required',
      ),
    );
  }
  const provider = models
    ? nonEmptyString(
        models.provider,
        'config.models.provider',
        diagnostics,
        ARXIC_CONFIG_MODEL_MISSING,
      )
    : undefined;
  const sourceRetention = models
    ? nonEmptyString(models.sourceRetention, 'config.models.sourceRetention', diagnostics)
    : undefined;
  if (sourceRetention !== undefined && !['disabled', 'retained'].includes(sourceRetention)) {
    invalid(diagnostics, 'config.models.sourceRetention', 'must be disabled or retained');
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return {
    ok: true,
    value: {
      version: 1,
      source: { repository: repository!, revision: revision!, languages: languages! },
      scope: {
        domains: domains!,
        frameworks: frameworks!,
        browsers: browsers!,
        personas: personas!,
        ...(featureFlags === undefined ? {} : { featureFlags }),
      },
      target: {
        origin: origin!,
        environmentClass: environmentClass!,
        attestationPath: attestationPath!,
        allowedOrigins: allowedOrigins!,
      },
      policy: {
        maxUrls: maxUrls!,
        maxDepth: maxDepth!,
        maxRuntimeMinutes: maxRuntimeMinutes!,
        mutation: mutation!,
        externalNetwork: externalNetwork!,
        requiredVerificationRuns: requiredVerificationRuns!,
        screenshots: screenshots!,
        trace: trace!,
        humanApproval: humanApproval!,
      },
      fixtures: {
        ...(inbox === undefined ? {} : { inbox }),
        ...(otp === undefined ? {} : { otp }),
        ...(personaProvisioner === undefined ? {} : { personaProvisioner }),
      },
      models: { provider: provider!, sourceRetention: sourceRetention! },
    } as ArxicConfig,
  };
}

function invalid(diagnostics: Diagnostic[], subject: string, detail: string): void {
  diagnostics.push(cliDiagnostic(ARXIC_CONFIG_INVALID, 'blocked', subject, `${subject} ${detail}`));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function objectField(
  parent: Record<string, unknown>,
  key: string,
  diagnostics: Diagnostic[],
): Record<string, unknown> | undefined {
  const value = parent[key];
  if (!isPlainObject(value)) {
    invalid(diagnostics, `config.${key}`, 'must be an object');
    return undefined;
  }
  return value;
}

function nonEmptyString(
  value: unknown,
  subject: string,
  diagnostics: Diagnostic[],
  code: typeof ARXIC_CONFIG_INVALID | typeof ARXIC_CONFIG_MODEL_MISSING = ARXIC_CONFIG_INVALID,
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    diagnostics.push(
      cliDiagnostic(code, 'blocked', subject, `${subject} must be a non-empty string`),
    );
    return undefined;
  }
  return value;
}

function stringField(
  value: unknown,
  subject: string,
  diagnostics: Diagnostic[],
): string | undefined {
  if (typeof value !== 'string') {
    invalid(diagnostics, subject, 'must be a string');
    return undefined;
  }
  return value;
}

function optionalString(
  value: unknown,
  subject: string,
  diagnostics: Diagnostic[],
): string | undefined {
  return value === undefined ? undefined : stringField(value, subject, diagnostics);
}

function stringArray(
  value: unknown,
  subject: string,
  diagnostics: Diagnostic[],
  nonEmpty = false,
): string[] | undefined {
  if (
    !Array.isArray(value) ||
    (nonEmpty && value.length === 0) ||
    value.some((item) => typeof item !== 'string')
  ) {
    invalid(diagnostics, subject, `must be ${nonEmpty ? 'a non-empty ' : 'an '}array of strings`);
    return undefined;
  }
  return [...value] as string[];
}

function recordOfBooleans(
  value: unknown,
  subject: string,
  diagnostics: Diagnostic[],
): Record<string, boolean> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value) || Object.values(value).some((item) => typeof item !== 'boolean')) {
    invalid(diagnostics, subject, 'must be an object with boolean values');
    return undefined;
  }
  return { ...value } as Record<string, boolean>;
}

function positiveInteger(
  value: unknown,
  subject: string,
  diagnostics: Diagnostic[],
): number | undefined {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    invalid(diagnostics, subject, 'must be an integer greater than zero');
    return undefined;
  }
  return value as number;
}

function parseHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function httpUrl(value: unknown, subject: string, diagnostics: Diagnostic[]): string | undefined {
  const string = nonEmptyString(value, subject, diagnostics);
  if (string !== undefined && !parseHttpUrl(string)) {
    invalid(diagnostics, subject, 'must be an absolute http: or https: URL');
    return undefined;
  }
  return string;
}

function urlArray(
  value: unknown,
  subject: string,
  diagnostics: Diagnostic[],
): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || !parseHttpUrl(item))
  ) {
    invalid(diagnostics, subject, 'must be a non-empty array of absolute http: or https: URLs');
    return undefined;
  }
  return [...value] as string[];
}
