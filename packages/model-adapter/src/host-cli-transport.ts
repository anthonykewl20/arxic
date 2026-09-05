import { execFile, spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ARXIC_MODEL_PROVIDER_ERROR,
  ARXIC_MODEL_PROVIDER_TIMEOUT,
  modelDiagnostic,
} from './diagnostics';
import type {
  ClientResult,
  OpenAICompletion,
  OpenAIMessage,
  StructuredCompletionTransport,
  StructuredCompletionInput,
} from './client';

/**
 * Host-bound CLI transport (#host-bound-model).
 *
 * Binds `ModelAdapter` to a locally installed agent CLI (Claude Code, Codex
 * CLI, opencode, or any other executable that reads a prompt on stdin and
 * writes a completion on stdout) instead of an HTTP endpoint. This is the
 * agnostic seam: the executable and its argv are fully caller-configured —
 * nothing here names a specific vendor.
 *
 * Deliberately narrow contract with the caller:
 * - The prompt is written to the child's STDIN, never argv, so it never
 *   appears in a process listing (`ps`). Any credential the CLI itself
 *   needs is the CLI's own concern (its own env/keychain) — this transport
 *   never forwards `bearerToken` anywhere observable.
 * - The CLI is NOT expected to honour `response_format: json_schema` (the
 *   schema-in-prompt path already carries the schema inside `messages` for
 *   exactly this reason — see intent-proposer's schema-in-prompt framing).
 *   This transport only extracts whatever JSON the CLI printed; it does not
 *   itself append schema instructions.
 * - `usage` is always reported as all-zero: a CLI does not report token
 *   counts, and fabricating plausible-looking numbers would misrepresent
 *   metered cost. Pair this transport with `providerMeta: { provider:
 *   'host-bound' }` on `ModelAdapter` so the run record is unmistakably
 *   marked (see run-record.ts).
 * - `timeoutMs` is enforced on the subprocess; on timeout the process is
 *   killed (SIGKILL) and a provider-timeout `ClientResult` is returned.
 * - Never logs the raw prompt or raw response; failures are reported only
 *   as an opaque `ClientResult` diagnostic, so the fail-closed redaction
 *   gate in `adapter.ts` is the only place prompt/response content can flow
 *   through, exactly as with the HTTP transport.
 */
export type HostCliTransportConfig = {
  /** Executable to spawn — a path or a name resolved via PATH. */
  command: string;
  /** Extra argv passed to the executable, before the prompt is written to stdin. */
  args?: string[];
  /** Repeated per PNG. Must contain a separate literal {image} argument. */
  imageArgs?: string[];
  /** Existing private parent directory owned/cleaned by a supervising job. */
  imageDirectory?: string;
  /** Supervisor owns the process group and kills all remaining descendants. */
  inheritProcessGroup?: boolean;
  /** Working directory for the spawned process. Defaults to process.cwd(). */
  cwd?: string;
};

function providerFailure(timeout: boolean): ClientResult {
  return {
    ok: false,
    raw: undefined,
    diagnostics: [
      modelDiagnostic(
        timeout ? ARXIC_MODEL_PROVIDER_TIMEOUT : ARXIC_MODEL_PROVIDER_ERROR,
        'model-provider',
        timeout ? 'Host-bound model CLI timed out' : 'Host-bound model CLI request failed',
      ),
    ],
  };
}

function renderPrompt(messages: OpenAIMessage[]): string {
  return messages.map((message) => `[${message.role}]\n${message.content}`).join('\n\n');
}

/**
 * Strip markdown fences / preamble prose and extract the first parseable
 * JSON value from `text`. Fails closed (returns `undefined`) rather than
 * guessing when nothing in the text parses as JSON.
 */
export function extractJsonPayload(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;

  const attempts: string[] = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  if (fenced?.[1] !== undefined) attempts.push(fenced[1].trim());

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    attempts.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    attempts.push(trimmed.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Reads `ARXIC_MODEL_HOST_CLI` (the executable) and `ARXIC_MODEL_HOST_CLI_ARGS`
 * (extra argv, either a JSON array of strings or a whitespace-split string —
 * whitespace-split has no quoting support, so an argument containing a space
 * must go through the JSON-array form) from `env`. Returns `undefined` when
 * `ARXIC_MODEL_HOST_CLI` is unset/blank so callers can fall back to "not
 * configured" rather than guessing a default vendor CLI.
 */
export function hostCliConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): HostCliTransportConfig | undefined {
  const command = env.ARXIC_MODEL_HOST_CLI?.trim();
  if (!command) return undefined;

  const rawArgs = env.ARXIC_MODEL_HOST_CLI_ARGS?.trim();
  const imageArgs = parseImageArgs(env.ARXIC_MODEL_HOST_CLI_IMAGE_ARGS);
  const images = imageArgs === undefined ? {} : { imageArgs };
  if (!rawArgs) return { command, ...images };

  if (rawArgs.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawArgs) as unknown;
    } catch {
      throw new Error('ARXIC_MODEL_HOST_CLI_ARGS looks like JSON but failed to parse');
    }
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
      throw new Error('ARXIC_MODEL_HOST_CLI_ARGS JSON array must contain only strings');
    }
    return { command, args: parsed, ...images };
  }
  return { command, args: rawArgs.split(/\s+/u), ...images };
}

function validImageArgs(input: unknown): input is string[] {
  return (
    Array.isArray(input) &&
    input.length > 0 &&
    input.length <= 20 &&
    input.every((item) => typeof item === 'string' && !item.includes('\0')) &&
    input.includes('{image}')
  );
}

function parseImageArgs(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'ARXIC_MODEL_HOST_CLI_IMAGE_ARGS must be a JSON string array containing {image}',
    );
  }
  if (!validImageArgs(parsed))
    throw new Error(
      'ARXIC_MODEL_HOST_CLI_IMAGE_ARGS must be a JSON string array containing {image}',
    );
  return parsed;
}

export function createHostCliTransport(
  config: HostCliTransportConfig,
): StructuredCompletionTransport {
  return async (input) => {
    if (input.images === undefined) return runHostCli(config, input);
    if (!validImageArgs(config.imageArgs)) return providerFailure(false);
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(config.imageDirectory ?? tmpdir(), 'arxic-model-images-'));
      const args = [...(config.args ?? [])];
      for (const [index, image] of input.images.entries()) {
        const file = join(directory, `image-${index + 1}.png`);
        await writeFile(file, image.bytes, { mode: 0o600, flag: 'wx' });
        args.push(...config.imageArgs.map((arg) => (arg === '{image}' ? file : arg)));
      }
      const result = await runHostCli({ ...config, args }, input);
      // Temporary attachment paths are transport internals, never model artifacts.
      if (
        result.ok &&
        result.raw.choices.some((choice) =>
          choice.message.content.includes(JSON.stringify(directory).slice(1, -1)),
        )
      )
        return providerFailure(false);
      return result;
    } catch {
      return providerFailure(false);
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  };
}

function runHostCli(
  config: HostCliTransportConfig,
  input: StructuredCompletionInput,
): Promise<ClientResult> {
  return new Promise<ClientResult>((resolve) => {
    const prompt = renderPrompt(input.messages);
    const timeoutMs = input.timeoutMs ?? 30_000;

    let child;
    try {
      child = spawn(config.command, config.args ?? [], {
        cwd: config.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32' && !config.inheritProcessGroup,
      });
    } catch {
      resolve(providerFailure(false));
      return;
    }

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    const maximumOutputBytes = 8 * 1024 * 1024;
    let settled = false;
    let timedOut = false;

    const finish = (result: ClientResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const stop = () => {
      if (child.pid) {
        if (process.platform === 'win32') {
          execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => undefined);
        } else if (config.inheritProcessGroup) {
          child.kill('SIGKILL');
        } else {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
      }
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
      finish(providerFailure(true));
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maximumOutputBytes) {
        stop();
        finish(providerFailure(false));
        return;
      }
      stdoutChunks.push(chunk);
    });
    // stderr is intentionally not captured into any diagnostic message —
    // it may echo the prompt back, and diagnostics must not carry raw
    // prompt/response content outside the redaction gate.
    child.stderr?.resume();
    // Pipe writes fail asynchronously when a provider exits before reading
    // a large prompt. An unhandled EPIPE must not crash the caller process.
    child.stdin?.on('error', () => {
      stop();
      finish(providerFailure(timedOut));
    });

    child.on('error', () => finish(providerFailure(timedOut)));
    child.on('close', (code) => {
      if (timedOut) {
        finish(providerFailure(true));
        return;
      }
      if (code !== 0) {
        finish(providerFailure(false));
        return;
      }
      // A pipe chunk can end inside a UTF-8 code point. Decode only after
      // collecting the bounded byte stream so model text is not corrupted.
      const parsed = extractJsonPayload(Buffer.concat(stdoutChunks).toString('utf8'));
      if (parsed === undefined) {
        finish(providerFailure(false));
        return;
      }
      const raw: OpenAICompletion = {
        id: `host-cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        model: input.model,
        choices: [{ message: { role: 'assistant', content: JSON.stringify(parsed) } }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      finish({ ok: true, raw, diagnostics: [] });
    });

    try {
      child.stdin?.end(prompt);
    } catch {
      stop();
      finish(providerFailure(false));
    }
  });
}
