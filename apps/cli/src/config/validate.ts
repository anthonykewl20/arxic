import type { Diagnostic } from '@arxic/contracts';
import type { ArxicConfig } from '@arxic/worker';
import {
  validateReplayPersonaDeclaration,
  replayPersonaProductionRefusal,
  type ReplayPersonaDeclaration,
  REPLAY_PERSONA_DECLARATION_KEYS,
} from '@arxic/verifier';
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
  // #288 (C-3 / SP-2): a declared replay persona on a production-shaped
  // target is refused with its own frozen code BEFORE any provisioning could
  // run — zero login attempts, regardless of anything else in the config.
  const declaresReplayPersona =
    typeof input.fixtures === 'object' &&
    input.fixtures !== null &&
    'replayPersona' in input.fixtures;
  if (environmentClass === 'production' && declaresReplayPersona) {
    diagnostics.push(replayPersonaProductionRefusal('config.fixtures.replayPersona'));
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
  // #259: the operator-side expected build digest — the independent
  // expectation source for the stage-0 attestation gate. 64 hex chars.
  const expectedBuildDigest = optionalHex64(
    target?.expectedBuildDigest,
    'config.target.expectedBuildDigest',
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
  // ADR §19's example config and §575's lease-scoped-mutation invariant admit exactly one
  // value each here, and `validateWorkerSecurity` enforces the same pair at run time. The
  // CLI previously also accepted 'allow' (and, for mutation, 'deny') — values the worker
  // rejects with ARXIC-WORKER-CONFIG-UNSAFE and that nothing in the pipeline ever read, so
  // they were silently inert rather than dangerous. Accepting a safety setting that cannot
  // be honoured is its own defect: fail closed here instead (#104).
  const mutation = nonEmptyString(policy?.mutation, 'config.policy.mutation', diagnostics);
  if (mutation !== undefined && mutation !== 'leased-fixtures-only') {
    invalid(diagnostics, 'config.policy.mutation', 'must be leased-fixtures-only');
  }
  const externalNetwork = nonEmptyString(
    policy?.externalNetwork,
    'config.policy.externalNetwork',
    diagnostics,
  );
  if (externalNetwork !== undefined && externalNetwork !== 'deny') {
    invalid(diagnostics, 'config.policy.externalNetwork', 'must be deny');
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
  // #288: the frozen `fixtures.replayPersona` declaration — validated with
  // its own frozen ARXIC-VERIFY-FIXTURE-* family (C-5 / SP-4), no silent
  // defaults. Unknown sibling keys inside the declaration are rejected so a
  // typo'd field cannot silently no-op the per-pass login.
  let replayPersona: ReplayPersonaDeclaration | undefined;
  if (fixtures !== undefined && 'replayPersona' in fixtures) {
    const validated = validateReplayPersonaDeclaration(fixtures.replayPersona);
    if (validated.ok) {
      replayPersona = validated.value;
      const known = new Set<string>(REPLAY_PERSONA_DECLARATION_KEYS);
      for (const key of Object.keys(fixtures.replayPersona as Record<string, unknown>)) {
        if (!known.has(key)) {
          diagnostics.push(
            cliDiagnostic(
              ARXIC_CONFIG_INVALID,
              'blocked',
              `config.fixtures.replayPersona.${key}`,
              `config.fixtures.replayPersona.${key} is not a recognized key`,
            ),
          );
        }
      }
    } else {
      diagnostics.push(...validated.diagnostics);
    }
  }

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
        ...(expectedBuildDigest === undefined ? {} : { expectedBuildDigest }),
      },
      policy: {
        maxUrls: maxUrls!,
        maxDepth: maxDepth!,
        maxRuntimeMinutes: maxRuntimeMinutes!,
        // Reaching here proves both: any other value pushed a diagnostic above, and
        // `diagnostics.length > 0` already returned. Scoped assertions rather than a
        // whole-object `as ArxicConfig`, so every other field stays structurally checked.
        mutation: mutation as 'leased-fixtures-only',
        externalNetwork: externalNetwork as 'deny',
        requiredVerificationRuns: requiredVerificationRuns!,
        screenshots: screenshots!,
        trace: trace!,
        humanApproval: humanApproval!,
      },
      fixtures: {
        ...(inbox === undefined ? {} : { inbox }),
        ...(otp === undefined ? {} : { otp }),
        ...(personaProvisioner === undefined ? {} : { personaProvisioner }),
        ...(replayPersona === undefined ? {} : { replayPersona }),
      },
      models: {
        provider: provider!,
        // Same reasoning as policy.mutation above: line 169 pushed a diagnostic for any
        // other value, and line 173 already returned on a non-empty diagnostics list.
        sourceRetention: sourceRetention as 'disabled' | 'retained',
      },
    },
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

function optionalHex64(
  value: unknown,
  subject: string,
  diagnostics: Diagnostic[],
): string | undefined {
  if (value === undefined) return undefined;
  const string = nonEmptyString(value, subject, diagnostics);
  if (string !== undefined && !/^[0-9a-f]{64}$/iu.test(string)) {
    invalid(diagnostics, subject, 'must be 64 hexadecimal characters (SHA-256)');
    return undefined;
  }
  return string?.toLowerCase();
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
