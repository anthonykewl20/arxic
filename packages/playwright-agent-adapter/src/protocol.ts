import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Diagnostic } from '@arxic/contracts';
import { ARXIC_AGENT_PROCESS_ERROR, agentDiagnostic } from './diagnostics';

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};
export type ProtocolResult<T> = { ok: true; value: T } | { ok: false; diagnostics: Diagnostic[] };

export class McpStdioClient {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buffer = '';
  private processError?: string;
  private readonly pending = new Map<
    number,
    { resolve: (value: ProtocolResult<unknown>) => void; timer: NodeJS.Timeout }
  >();

  constructor(
    private readonly options: {
      cliPath: string;
      configPath: string;
      headless: boolean;
      timeoutMs: number;
    },
  ) {}

  start(): ProtocolResult<undefined> {
    if (this.child) return { ok: true, value: undefined };
    try {
      const args = [
        this.options.cliPath,
        'run-test-mcp-server',
        '--config',
        this.options.configPath,
        ...(this.options.headless ? ['--headless'] : []),
      ];
      this.child = spawn(process.execPath, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child.stdout.setEncoding('utf8');
      this.child.stdout.on('data', (chunk: string) => this.onData(chunk));
      this.child.stderr.setEncoding('utf8');
      this.child.stderr.on('data', (chunk: string) => {
        this.processError = `${this.processError ?? ''}${chunk}`.trim();
      });
      this.child.on('error', (error) => this.failAll(error.message));
      this.child.on('exit', (code, signal) => {
        if (this.pending.size > 0)
          this.failAll(
            this.processError ||
              `process exited with code ${String(code)} signal ${String(signal)}`,
          );
      });
      return { ok: true, value: undefined };
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : String(error));
    }
  }

  request<T>(method: string, params?: unknown): Promise<ProtocolResult<T>> {
    const started = this.start();
    if (!started.ok) return Promise.resolve(started);
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(this.failure(`request ${method} timed out after ${this.options.timeoutMs}ms`));
      }, this.options.timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: ProtocolResult<unknown>) => void, timer });
      const written = this.write({
        jsonrpc: '2.0',
        id,
        method,
        ...(params === undefined ? {} : { params }),
      });
      if (!written.ok) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(written);
      }
    });
  }

  notify(method: string, params?: unknown): ProtocolResult<undefined> {
    const started = this.start();
    if (!started.ok) return started;
    return this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
    this.child = undefined;
  }

  private write(message: unknown): ProtocolResult<undefined> {
    if (!this.child || this.child.stdin.destroyed)
      return this.failure(this.processError || 'agent process is unavailable');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    return { ok: true, value: undefined };
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.onLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private onLine(line: string) {
    let response: JsonRpcResponse;
    try {
      response = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }
    if (typeof response.id !== 'number') return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    if (response.error)
      pending.resolve(
        this.failure(response.error.message ?? `JSON-RPC error ${String(response.error.code)}`),
      );
    else pending.resolve({ ok: true, value: response.result });
  }

  private failAll(message: string) {
    this.processError = message;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve(this.failure(message));
      this.pending.delete(id);
    }
  }

  private failure(message: string): { ok: false; diagnostics: Diagnostic[] } {
    return {
      ok: false,
      diagnostics: [agentDiagnostic(ARXIC_AGENT_PROCESS_ERROR, this.options.cliPath, message)],
    };
  }
}
