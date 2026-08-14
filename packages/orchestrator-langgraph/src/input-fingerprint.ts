import { artifactHash, canonicalJson } from './checkpointer';

/**
 * Pure service mechanic for binding persisted runs to their semantic inputs.
 * The caller decides how a mismatch changes run state.
 */
export type RunInputFingerprintInput = Readonly<{
  sourceRevision: unknown;
  origin: string;
  policy: unknown;
  config: unknown;
}>;

export type RunInputFingerprint = Readonly<{ sha256: string }>;

export function createRunInputFingerprint(input: RunInputFingerprintInput): RunInputFingerprint {
  return {
    sha256: artifactHash({
      sourceRevision: input.sourceRevision,
      origin: input.origin,
      policy: input.policy,
      config: normalizeConfig(input.config),
    }),
  };
}

function normalizeConfig(config: unknown): unknown {
  if (!isRecord(config)) return config;
  return {
    ...config,
    credentialBytes: normalizeStringList(config.credentialBytes),
    features: normalizeStringList(config.features),
    languages: normalizeStringList(config.languages),
    oracleRules: normalizeOracleRules(config.oracleRules),
    personas: normalizeStringList(config.personas),
  };
}

function normalizeStringList(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (value.length === 0) return undefined;
  return [...value].sort((left, right) => String(left).localeCompare(String(right)));
}

function normalizeOracleRules(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (value.length === 0) return undefined;
  return [...value].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
