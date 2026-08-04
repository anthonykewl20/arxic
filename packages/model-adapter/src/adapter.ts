import type { Diagnostic } from '@arxic/contracts';
import {
  postStructuredCompletion,
  schemaNameFromVersion,
  type OpenAICompletion,
  type OpenAIMessage,
} from './client';
import {
  ARXIC_MODEL_PROVIDER_ERROR,
  ARXIC_MODEL_PROVIDER_TIMEOUT,
  ARXIC_MODEL_RETRIES_EXHAUSTED,
  ARXIC_MODEL_SCHEMA_VERSION_DRIFT,
  ARXIC_MODEL_STRUCTURED_OUTPUT_INVALID,
  modelDiagnostic,
  type ModelDiagnosticCode,
} from './diagnostics';
import {
  buildRunRecord,
  computeSchemaSha256,
  redactionGate,
  sanitizeRunRecord,
  type ModelRunRecord,
  type ProviderMeta,
} from './run-record';
import { assertSchemaVersion, compileSchema, validateStructuredOutput } from './validator';

export type CredentialResolver = () => Promise<string> | string;

export type ModelAdapterOptions = {
  credentials: string | CredentialResolver;
  baseUrl: string;
  timeoutMs?: number;
  canaries?: string[];
  providerMeta?: ProviderMeta;
  now?: () => string;
};

export type StructuredOutputRequest = {
  model: string;
  messages: OpenAIMessage[];
  schema: object;
  schemaVersion: string;
  maxRetries?: number;
};

export type StructuredOutputResult =
  | { ok: true; output: unknown; runRecord: ModelRunRecord }
  | { ok: false; diagnostics: Diagnostic[]; runRecord: ModelRunRecord };

const RETRY_SYSTEM_NOTE: OpenAIMessage = {
  role: 'system',
  content:
    'Prior structured output was invalid. Return only JSON that strictly conforms to the requested schema and schemaVersion.',
};

const INSTRUCTION_LIKE_OUTPUT =
  /(?:ignore|disregard).*(?:instructions?|policy|rules|origin)|(?:change|set).*action class|exfiltrate/iu;

export class ModelAdapter {
  private readonly options: ModelAdapterOptions;

  constructor(options: ModelAdapterOptions) {
    this.options = options;
  }

  async requestStructuredOutput(request: StructuredOutputRequest): Promise<StructuredOutputResult> {
    try {
      const now = this.options.now ?? (() => new Date().toISOString());
      const schemaSha256 = computeSchemaSha256(request.schema);
      const recordFrom = (response?: OpenAICompletion): ModelRunRecord => {
        const record = buildRunRecord({
          schema: request.schema,
          schemaVersion: request.schemaVersion,
          model: request.model,
          response,
          provider: this.options.providerMeta,
          now,
        });
        if (record.schemaSha256 !== schemaSha256)
          throw new Error('Schema hash changed during request');
        return record;
      };
      const blocked = (
        code: ModelDiagnosticCode,
        subject: string,
        message: string,
        response?: OpenAICompletion,
      ): StructuredOutputResult => ({
        ok: false,
        diagnostics: [modelDiagnostic(code, subject, message)],
        runRecord: recordFrom(response),
      });

      let credential: string;
      try {
        credential =
          typeof this.options.credentials === 'string'
            ? this.options.credentials
            : await this.options.credentials();
      } catch {
        return blocked(ARXIC_MODEL_PROVIDER_ERROR, 'credentials', 'Credential resolution failed');
      }
      if (!credential.trim()) {
        return blocked(ARXIC_MODEL_PROVIDER_ERROR, 'credentials', 'Credential resolution failed');
      }

      const compiled = compileSchema(request.schema);
      if (!compiled.ok) {
        return blocked(
          ARXIC_MODEL_STRUCTURED_OUTPUT_INVALID,
          'structured-output-schema',
          'Structured output schema could not be compiled',
        );
      }

      const forbidden = [
        credential,
        ...request.messages.map((message) => message.content),
        ...(this.options.canaries ?? []),
      ].filter(Boolean);
      const finalize = (
        candidate: StructuredOutputResult,
        gateOutput?: unknown,
      ): StructuredOutputResult => {
        const output = gateOutput ?? (candidate.ok ? candidate.output : undefined);
        const gate = redactionGate(
          {
            record: candidate.runRecord,
            output,
            diagnostics: candidate.ok ? undefined : candidate.diagnostics,
          },
          forbidden,
        );
        if (gate.ok) return candidate;
        return {
          ok: false,
          diagnostics: gate.diagnostics,
          runRecord: sanitizeRunRecord(candidate.runRecord, forbidden),
        };
      };
      const maxRetries = request.maxRetries ?? 2;
      if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
        return blocked(
          ARXIC_MODEL_STRUCTURED_OUTPUT_INVALID,
          'structured-output.maxRetries',
          'maxRetries must be a non-negative safe integer',
        );
      }
      const totalAttempts = 1 + maxRetries;
      const messages = [...request.messages];
      let lastResponse: OpenAICompletion | undefined;

      for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
        const result = await postStructuredCompletion({
          baseUrl: this.options.baseUrl,
          bearerToken: credential,
          model: request.model,
          messages,
          schema: request.schema,
          schemaName: schemaNameFromVersion(request.schemaVersion),
          timeoutMs: this.options.timeoutMs,
        });
        if (!result.ok) {
          if (result.diagnostics[0]?.code === ARXIC_MODEL_PROVIDER_TIMEOUT) {
            return finalize(
              blocked(
                ARXIC_MODEL_PROVIDER_TIMEOUT,
                'model-provider',
                'Model provider request timed out',
                lastResponse,
              ),
            );
          }
          return finalize(
            blocked(
              ARXIC_MODEL_PROVIDER_ERROR,
              'model-provider',
              'Model provider request failed',
              lastResponse,
            ),
          );
        }

        lastResponse = result.raw;
        let parsed: unknown;
        try {
          parsed = JSON.parse(result.raw.choices[0].message.content) as unknown;
        } catch {
          if (attempt < totalAttempts) {
            messages.push({ ...RETRY_SYSTEM_NOTE });
            continue;
          }
          return finalize(
            blocked(
              ARXIC_MODEL_RETRIES_EXHAUSTED,
              'structured-output',
              'Structured output remained invalid; retries exhausted',
              lastResponse,
            ),
          );
        }

        const version = assertSchemaVersion(parsed, request.schemaVersion);
        if (!version.ok) {
          if (attempt < totalAttempts) {
            messages.push({ ...RETRY_SYSTEM_NOTE });
            continue;
          }
          return finalize(
            blocked(
              ARXIC_MODEL_SCHEMA_VERSION_DRIFT,
              'structured-output.schemaVersion',
              'Model output schema version does not match the expected version',
              lastResponse,
            ),
            parsed,
          );
        }

        const validation = validateStructuredOutput(compiled.validate, parsed);
        if (!validation.ok) {
          if (attempt < totalAttempts) {
            messages.push({ ...RETRY_SYSTEM_NOTE });
            continue;
          }
          return finalize(
            blocked(
              ARXIC_MODEL_RETRIES_EXHAUSTED,
              'structured-output',
              'Structured output remained invalid; retries exhausted',
              lastResponse,
            ),
            parsed,
          );
        }

        const record = recordFrom(lastResponse);
        if (INSTRUCTION_LIKE_OUTPUT.test(JSON.stringify(parsed))) {
          const candidate: StructuredOutputResult = {
            ok: false,
            diagnostics: [
              modelDiagnostic(
                ARXIC_MODEL_STRUCTURED_OUTPUT_INVALID,
                'structured-output',
                'Instruction-like provider output was treated as data and blocked',
              ),
            ],
            runRecord: record,
          };
          return finalize(candidate, parsed);
        }
        return finalize({ ok: true, output: parsed, runRecord: record }, parsed);
      }

      return finalize(
        blocked(
          ARXIC_MODEL_RETRIES_EXHAUSTED,
          'structured-output',
          'Structured output remained invalid; retries exhausted',
          lastResponse,
        ),
      );
    } catch {
      let timestamp: string;
      try {
        timestamp = (this.options.now ?? (() => new Date().toISOString()))();
      } catch {
        timestamp = new Date().toISOString();
      }
      let schemaSha256: string;
      try {
        schemaSha256 = computeSchemaSha256(request.schema);
      } catch {
        schemaSha256 = '0'.repeat(64);
      }
      return {
        ok: false,
        diagnostics: [
          modelDiagnostic(
            ARXIC_MODEL_PROVIDER_ERROR,
            'model-provider',
            'Unexpected model provider failure',
          ),
        ],
        runRecord: {
          requestId: '',
          schemaVersion: request.schemaVersion,
          schemaSha256,
          model: request.model,
          tokens: { prompt: 0, completion: 0, total: 0 },
          timestamp,
        },
      };
    }
  }
}
