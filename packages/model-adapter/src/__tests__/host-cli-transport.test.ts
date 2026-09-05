import { describe, expect, it } from 'vitest';
import { ModelAdapter } from '..';
import {
  createHostCliTransport,
  extractJsonPayload,
  hostCliConfigFromEnv,
  type HostCliTransportConfig,
} from '../host-cli-transport';
import { adapterRequest, EXPECTED_SCHEMA_VERSION, validOutput } from './stub';

/**
 * #host-bound-model — sad-path-first, real-subprocess coverage for the
 * host-bound CLI transport. Every test spawns a REAL `node` subprocess (the
 * "agent CLI" is a trivial one-liner script), never a mock, so a genuine
 * spawn/stdin/stdout/timeout/kill path is exercised.
 */

const NODE = process.execPath;

function echoScript(payload: unknown): HostCliTransportConfig {
  return {
    command: NODE,
    args: ['-e', `process.stdout.write(${JSON.stringify(JSON.stringify(payload))})`],
  };
}

function rawScript(text: string): HostCliTransportConfig {
  return { command: NODE, args: ['-e', `process.stdout.write(${JSON.stringify(text)})`] };
}

function hangingScript(): HostCliTransportConfig {
  // Never exits on its own; only a SIGKILL from the transport's timeout
  // should end it.
  return { command: NODE, args: ['-e', 'setInterval(() => {}, 1000)'] };
}

describe('extractJsonPayload', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonPayload('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips a markdown fence with a json tag', () => {
    const text = 'Here you go:\n```json\n{"a":1}\n```\nHope that helps.';
    expect(extractJsonPayload(text)).toEqual({ a: 1 });
  });

  it('strips a bare markdown fence', () => {
    const text = '```\n{"a":1}\n```';
    expect(extractJsonPayload(text)).toEqual({ a: 1 });
  });

  it('recovers a JSON object embedded in preamble prose', () => {
    const text = 'Sure, the structured result is {"a":1} — let me know if you need more.';
    expect(extractJsonPayload(text)).toEqual({ a: 1 });
  });

  it('fails closed on unparseable text (no fabricated payload)', () => {
    expect(extractJsonPayload('I cannot help with that request.')).toBeUndefined();
  });

  it('fails closed on empty output', () => {
    expect(extractJsonPayload('   ')).toBeUndefined();
  });
});

describe('hostCliConfigFromEnv', () => {
  it('requires explicit per-image argument configuration without changing text-only argv', () => {
    expect(
      hostCliConfigFromEnv({
        ARXIC_MODEL_HOST_CLI: 'agent',
        ARXIC_MODEL_HOST_CLI_IMAGE_ARGS: '["--image","{image}"]',
      }),
    ).toEqual({ command: 'agent', imageArgs: ['--image', '{image}'] });
    for (const value of ['--image {image}', '["--image"]', '[1,"{image}"]', '["prefix{image}"]']) {
      expect(() =>
        hostCliConfigFromEnv({
          ARXIC_MODEL_HOST_CLI: 'agent',
          ARXIC_MODEL_HOST_CLI_IMAGE_ARGS: value,
        }),
      ).toThrow();
    }
  });
  it('is undefined when ARXIC_MODEL_HOST_CLI is unset', () => {
    expect(hostCliConfigFromEnv({})).toBeUndefined();
  });

  it('is undefined when ARXIC_MODEL_HOST_CLI is blank', () => {
    expect(hostCliConfigFromEnv({ ARXIC_MODEL_HOST_CLI: '  ' })).toBeUndefined();
  });

  it('splits whitespace-separated args', () => {
    expect(
      hostCliConfigFromEnv({
        ARXIC_MODEL_HOST_CLI: 'claude',
        ARXIC_MODEL_HOST_CLI_ARGS: '-p --json',
      }),
    ).toEqual({ command: 'claude', args: ['-p', '--json'] });
  });

  it('parses a JSON array of args', () => {
    expect(
      hostCliConfigFromEnv({
        ARXIC_MODEL_HOST_CLI: 'codex',
        ARXIC_MODEL_HOST_CLI_ARGS: '["exec", "--full-auto"]',
      }),
    ).toEqual({ command: 'codex', args: ['exec', '--full-auto'] });
  });

  it('throws on a non-string-array JSON value (fail closed on misconfiguration)', () => {
    expect(() =>
      hostCliConfigFromEnv({ ARXIC_MODEL_HOST_CLI: 'codex', ARXIC_MODEL_HOST_CLI_ARGS: '[1, 2]' }),
    ).toThrow();
  });

  it('command-only config when no args var is set', () => {
    expect(hostCliConfigFromEnv({ ARXIC_MODEL_HOST_CLI: 'opencode' })).toEqual({
      command: 'opencode',
    });
  });
});

describe('createHostCliTransport (real subprocess)', () => {
  it('preserves Unicode when stdout splits a multibyte character between pipe writes', async () => {
    const payload = { label: 'é日本🙂' };
    const transport = createHostCliTransport({
      command: NODE,
      args: [
        '-e',
        `
        const bytes = Buffer.from(${JSON.stringify(JSON.stringify(payload))});
        const split = bytes.indexOf(0xc3) + 1;
        process.stdout.write(bytes.subarray(0, split));
        setTimeout(() => process.stdout.write(bytes.subarray(split)), 100);
      `,
      ],
    });
    const result = await transport({
      baseUrl: 'unused',
      bearerToken: 'unused',
      model: 'test-model-v1',
      messages: [{ role: 'user', content: 'hi' }],
      schema: {},
      schemaName: 'x',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(JSON.parse(result.raw.choices[0].message.content)).toEqual(payload);
  });

  it('bounds timeout even when a descendant retains the provider output pipe', async () => {
    const transport = createHostCliTransport({
      command: NODE,
      args: [
        '-e',
        `require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 2500)'], { stdio: ['ignore', 1, 2] }); setInterval(() => {}, 1000);`,
      ],
    });
    const started = Date.now();
    const result = await transport({
      baseUrl: 'unused',
      bearerToken: 'unused',
      model: 'test',
      messages: [],
      schema: {},
      schemaName: 'x',
      timeoutMs: 300,
    });
    expect(result.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(1500);
  });
  it('refuses a provider response larger than the bounded output budget', async () => {
    const transport = createHostCliTransport({
      command: NODE,
      args: ['-e', `process.stdout.write(JSON.stringify({ value: 'x'.repeat(9 * 1024 * 1024) }))`],
    });
    const result = await transport({
      baseUrl: 'unused',
      bearerToken: 'unused',
      model: 'test',
      messages: [],
      schema: {},
      schemaName: 'x',
    });
    expect(result.ok).toBe(false);
  });

  it('classifies a child closing its input pipe without an unhandled parent error', async () => {
    const transport = createHostCliTransport({
      command: NODE,
      args: ['-e', 'process.stdin.destroy(); process.exit(1)'],
    });
    const result = await transport({
      baseUrl: 'unused',
      bearerToken: 'unused',
      model: 'test-model',
      messages: [{ role: 'user', content: 'large input '.repeat(200_000) }],
      schema: {},
      schemaName: 'x',
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('ARXIC-MODEL-PROVIDER-ERROR');
  });
  it('returns a valid ClientResult for a bare-JSON echo script', async () => {
    const transport = createHostCliTransport(echoScript(validOutput()));
    const result = await transport({
      baseUrl: 'unused',
      bearerToken: 'unused',
      model: 'test-model-v1',
      messages: [{ role: 'user', content: 'hi' }],
      schema: {},
      schemaName: 'x',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(JSON.parse(result.raw.choices[0].message.content)).toEqual(validOutput());
    expect(result.raw.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });

  it('parses a fenced/prose-wrapped response', async () => {
    const wrapped = `Sure, here is the JSON:\n\`\`\`json\n${JSON.stringify(validOutput())}\n\`\`\`\n`;
    const transport = createHostCliTransport(rawScript(wrapped));
    const result = await transport({
      baseUrl: 'unused',
      bearerToken: 'unused',
      model: 'test-model-v1',
      messages: [{ role: 'user', content: 'hi' }],
      schema: {},
      schemaName: 'x',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(JSON.parse(result.raw.choices[0].message.content)).toEqual(validOutput());
  });

  it('fails closed when the CLI prints no parseable JSON', async () => {
    const transport = createHostCliTransport(rawScript('I refuse to answer that.'));
    const result = await transport({
      baseUrl: 'unused',
      bearerToken: 'unused',
      model: 'test-model-v1',
      messages: [{ role: 'user', content: 'hi' }],
      schema: {},
      schemaName: 'x',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected blocked');
    expect(result.diagnostics[0]?.code).toBe('ARXIC-MODEL-PROVIDER-ERROR');
  });

  it('fails closed when the executable does not exist', async () => {
    const transport = createHostCliTransport({ command: '/nonexistent/definitely-not-a-cli' });
    const result = await transport({
      baseUrl: 'unused',
      bearerToken: 'unused',
      model: 'test-model-v1',
      messages: [{ role: 'user', content: 'hi' }],
      schema: {},
      schemaName: 'x',
    });
    expect(result.ok).toBe(false);
  });

  it('enforces timeoutMs and kills the subprocess', async () => {
    const pidFile = `${process.env.TMPDIR ?? '/tmp'}/host-cli-transport-pid-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
    const script = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const transport = createHostCliTransport({ command: NODE, args: ['-e', script] });
    const start = Date.now();
    const result = await transport({
      baseUrl: 'unused',
      bearerToken: 'unused',
      model: 'test-model-v1',
      messages: [{ role: 'user', content: 'hi' }],
      schema: {},
      schemaName: 'x',
      timeoutMs: 300,
    });
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected timeout failure');
    expect(result.diagnostics[0]?.code).toBe('ARXIC-MODEL-PROVIDER-TIMEOUT');
    expect(elapsed).toBeLessThan(5_000);

    // Confirm the process was actually killed, not merely disconnected.
    const fs = await import('node:fs');
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
    fs.unlinkSync(pidFile);
  });

  it('never places the bearer token on argv (stdin only)', async () => {
    // The script reports its own argv (a JSON array of strings), proving the
    // transport did not append the bearer token / secret to the child's argv.
    const transport = createHostCliTransport({
      command: NODE,
      args: ['-e', 'process.stdout.write(JSON.stringify(process.argv))'],
    });
    const result = await transport({
      baseUrl: 'unused',
      bearerToken: 'SUPER-SECRET-TOKEN-xyz',
      model: 'test-model-v1',
      messages: [{ role: 'user', content: 'the prompt goes on stdin' }],
      schema: {},
      schemaName: 'x',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.raw.choices[0].message.content).not.toContain('SUPER-SECRET-TOKEN-xyz');
  });
});

describe('ModelAdapter with host-cli transport (full contract)', () => {
  it('completes end-to-end through the schema-in-prompt + AJV + schemaVersion path', async () => {
    const transport = createHostCliTransport(echoScript(validOutput()));
    const adapter = new ModelAdapter({
      baseUrl: 'host-cli://local',
      credentials: () => 'host-bound-local',
      transport,
      providerMeta: { provider: 'host-bound' },
    });
    const result = await adapter.requestStructuredOutput(adapterRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.output).toEqual(validOutput());
    expect(result.runRecord.provider).toBe('host-bound');
    expect(result.runRecord.tokens).toEqual({ prompt: 0, completion: 0, total: 0 });
  });

  it('marks host-bound run records even on a blocked outcome', async () => {
    const transport = createHostCliTransport(rawScript('not json at all'));
    const adapter = new ModelAdapter({
      baseUrl: 'host-cli://local',
      credentials: () => 'host-bound-local',
      transport,
      providerMeta: { provider: 'host-bound' },
    });
    const result = await adapter.requestStructuredOutput(adapterRequest());
    expect(result.ok).toBe(false);
    expect(result.runRecord.provider).toBe('host-bound');
    expect(result.runRecord.tokens).toEqual({ prompt: 0, completion: 0, total: 0 });
  });

  it('still rejects schemaVersion drift over the host-cli transport', async () => {
    const driftedOutput = { ...validOutput(), schemaVersion: 'wrong-version-v9' };
    const transport = createHostCliTransport(echoScript(driftedOutput));
    const adapter = new ModelAdapter({
      baseUrl: 'host-cli://local',
      credentials: () => 'host-bound-local',
      transport,
    });
    const result = await adapter.requestStructuredOutput({ ...adapterRequest(), maxRetries: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected blocked');
    expect(result.diagnostics.map((d) => d.code)).toContain('ARXIC-MODEL-SCHEMA-VERSION-DRIFT');
  });

  it('still rejects an AJV-invalid payload over the host-cli transport', async () => {
    const malformed = { schemaVersion: EXPECTED_SCHEMA_VERSION, candidates: [{ id: 'a' }] };
    const transport = createHostCliTransport(echoScript(malformed));
    const adapter = new ModelAdapter({
      baseUrl: 'host-cli://local',
      credentials: () => 'host-bound-local',
      transport,
    });
    const result = await adapter.requestStructuredOutput({ ...adapterRequest(), maxRetries: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected blocked');
    expect(result.diagnostics.map((d) => d.code)).toContain('ARXIC-MODEL-RETRIES-EXHAUSTED');
  });

  it('fails closed (provider error) rather than retrying forever when the CLI itself times out', async () => {
    const transport = createHostCliTransport(hangingScript());
    const adapter = new ModelAdapter({
      baseUrl: 'host-cli://local',
      credentials: () => 'host-bound-local',
      transport,
      timeoutMs: 300,
    });
    const result = await adapter.requestStructuredOutput({ ...adapterRequest(), maxRetries: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected blocked');
    expect(result.diagnostics.map((d) => d.code)).toContain('ARXIC-MODEL-PROVIDER-TIMEOUT');
  }, 10_000);
});
