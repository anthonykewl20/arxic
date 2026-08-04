import type { Diagnostic } from '@arxic/contracts';
import {
  ARXIC_MODEL_PROVIDER_ERROR,
  ARXIC_MODEL_PROVIDER_TIMEOUT,
  modelDiagnostic,
} from './diagnostics';

export type OpenAIMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type OpenAICompletion = {
  id: string;
  model: string;
  choices: Array<{
    message: { role: string; content: string };
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export type ClientResult =
  | { ok: true; raw: OpenAICompletion; diagnostics: Diagnostic[] }
  | { ok: false; raw: unknown; diagnostics: Diagnostic[] };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isOpenAICompletion(input: unknown): input is OpenAICompletion {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (
    typeof value.id !== 'string' ||
    typeof value.model !== 'string' ||
    !Array.isArray(value.choices) ||
    value.choices.length === 0 ||
    typeof value.usage !== 'object' ||
    value.usage === null ||
    Array.isArray(value.usage)
  ) {
    return false;
  }
  const usage = value.usage as Record<string, unknown>;
  if (
    !isFiniteNumber(usage.prompt_tokens) ||
    !isFiniteNumber(usage.completion_tokens) ||
    !isFiniteNumber(usage.total_tokens)
  ) {
    return false;
  }
  return value.choices.every((choice) => {
    if (typeof choice !== 'object' || choice === null || Array.isArray(choice)) return false;
    const item = choice as Record<string, unknown>;
    if (typeof item.message !== 'object' || item.message === null || Array.isArray(item.message)) {
      return false;
    }
    const message = item.message as Record<string, unknown>;
    return typeof message.role === 'string' && typeof message.content === 'string';
  });
}

function providerFailure(timeout: boolean): ClientResult {
  return {
    ok: false,
    raw: undefined,
    diagnostics: [
      modelDiagnostic(
        timeout ? ARXIC_MODEL_PROVIDER_TIMEOUT : ARXIC_MODEL_PROVIDER_ERROR,
        'model-provider',
        timeout ? 'Model provider request timed out' : 'Model provider request failed',
      ),
    ],
  };
}

export function schemaNameFromVersion(schemaVersion: string): string {
  return schemaVersion
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export async function postStructuredCompletion(input: {
  baseUrl: string;
  bearerToken: string;
  model: string;
  messages: OpenAIMessage[];
  schema: object;
  schemaName: string;
  timeoutMs?: number;
}): Promise<ClientResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);
  try {
    const response = await fetch(`${input.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.bearerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        response_format: {
          type: 'json_schema',
          json_schema: { name: input.schemaName, schema: input.schema, strict: true },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return providerFailure(false);
    const raw: unknown = await response.json();
    if (!isOpenAICompletion(raw)) return providerFailure(false);
    return { ok: true, raw, diagnostics: [] };
  } catch {
    return providerFailure(controller.signal.aborted);
  } finally {
    clearTimeout(timeout);
  }
}
