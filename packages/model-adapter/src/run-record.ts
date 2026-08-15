import { canonicalJson, sha256 } from '@arxic/contracts';
import type { Diagnostic } from '@arxic/contracts';
import type { OpenAICompletion } from './client';
import { ARXIC_MODEL_CREDENTIAL_LEAK_DETECTED, modelDiagnostic } from './diagnostics';

export type ModelRunRecord = {
  requestId: string;
  schemaVersion: string;
  schemaSha256: string;
  model: string;
  tokens: { prompt: number; completion: number; total: number };
  cost?: Record<string, unknown>;
  retention?: string;
  region?: string;
  sourceSharing?: string;
  timestamp: string;
};

export type ProviderMeta = { retention?: string; region?: string; sourceSharing?: string };

export function computeSchemaSha256(schema: object): string {
  return sha256(canonicalJson(schema, { mode: 'legacy' }));
}

export function buildRunRecord(input: {
  schema: object;
  schemaVersion: string;
  model: string;
  response?: OpenAICompletion;
  provider?: ProviderMeta;
  now: () => string;
}): ModelRunRecord {
  const record: ModelRunRecord = {
    requestId: input.response?.id ?? '',
    schemaVersion: input.schemaVersion,
    schemaSha256: computeSchemaSha256(input.schema),
    model: input.response?.model ?? input.model,
    tokens: input.response
      ? {
          prompt: input.response.usage.prompt_tokens,
          completion: input.response.usage.completion_tokens,
          total: input.response.usage.total_tokens,
        }
      : { prompt: 0, completion: 0, total: 0 },
    timestamp: input.now(),
  };
  if (input.provider?.retention !== undefined) record.retention = input.provider.retention;
  if (input.provider?.region !== undefined) record.region = input.provider.region;
  if (input.provider?.sourceSharing !== undefined) {
    record.sourceSharing = input.provider.sourceSharing;
  }
  return record;
}

export function canonicalizeRecord(record: ModelRunRecord): string {
  return canonicalJson(record, { mode: 'legacy' });
}

function sanitizeValue(value: unknown, forbidden: string[]): unknown {
  if (typeof value === 'string') {
    return forbidden.reduce(
      (sanitized, substring) =>
        substring ? sanitized.replaceAll(substring, '[REDACTED]') : sanitized,
      value,
    );
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, forbidden));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sanitizeValue(item, forbidden)]),
  );
}

export function sanitizeRunRecord(record: ModelRunRecord, forbidden: string[]): ModelRunRecord {
  return sanitizeValue(record, forbidden) as ModelRunRecord;
}

export function redactionGate(
  input: { record: ModelRunRecord; output?: unknown; diagnostics?: Diagnostic[] },
  forbidden: string[],
): { ok: true } | { ok: false; diagnostics: Diagnostic[] } {
  const artifacts = [
    canonicalizeRecord(input.record),
    ...(input.output !== undefined ? [JSON.stringify(input.output)] : []),
    ...(input.diagnostics ?? []).map((diagnostic) => diagnostic.message),
  ];
  if (!forbidden.some((substring) => artifacts.some((artifact) => artifact.includes(substring)))) {
    return { ok: true };
  }
  return {
    ok: false,
    diagnostics: [
      modelDiagnostic(
        ARXIC_MODEL_CREDENTIAL_LEAK_DETECTED,
        'redaction-gate',
        'Credential or prompt canary detected in model run artifacts; emission blocked.',
      ),
    ],
  };
}
