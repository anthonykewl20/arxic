import { createRequire } from 'node:module';
import { access } from 'node:fs/promises';
import type { Diagnostic } from '@arxic/contracts';
import {
  ARXIC_AGENT_HANDSHAKE_FAILED,
  ARXIC_AGENT_PROCESS_ERROR,
  agentDiagnostic,
} from './diagnostics';
import { type McpServerInfo, type McpTool, validateHandshake } from './handshake';
import { McpStdioClient } from './protocol';

const require = createRequire(import.meta.url);

function resolveCliPath(): string {
  try {
    return require.resolve('@playwright/test/cli.js');
  } catch {
    return require.resolve('@playwright/test/cli');
  }
}

export type PlaywrightAgentAdapterOptions = {
  configPath: string;
  headless?: boolean;
  cliPath?: string;
  timeoutMs?: number;
  now?: () => string;
};
export type AgentHandshakeResult = {
  ok: boolean;
  serverInfo?: McpServerInfo;
  tools: McpTool[];
  diagnostics: Diagnostic[];
};
export type AgentToolResult = { ok: boolean; output: string; diagnostics: Diagnostic[] };

type InitializeResult = { serverInfo?: McpServerInfo };
type ToolListResult = { tools?: McpTool[] };
type ToolCallResult = { content?: Array<{ type?: string; text?: string }>; isError?: boolean };

export class PlaywrightAgentAdapter {
  private readonly client: McpStdioClient;
  private negotiated?: AgentHandshakeResult;

  constructor(private readonly options: PlaywrightAgentAdapterOptions) {
    this.client = new McpStdioClient({
      cliPath: options.cliPath ?? resolveCliPath(),
      configPath: options.configPath,
      headless: options.headless ?? true,
      timeoutMs: options.timeoutMs ?? 30_000,
    });
  }

  async handshake(): Promise<AgentHandshakeResult> {
    if (this.negotiated?.ok) return this.negotiated;
    try {
      await access(this.options.configPath);
    } catch (error) {
      return this.handshakeFailure([
        agentDiagnostic(
          ARXIC_AGENT_PROCESS_ERROR,
          this.options.configPath,
          error instanceof Error ? error.message : String(error),
        ),
      ]);
    }
    const initialized = await this.client.request<InitializeResult>('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: '@arxic/playwright-agent-adapter', version: '0.0.0' },
    });
    if (!initialized.ok) return this.handshakeFailure(initialized.diagnostics);
    const notification = this.client.notify('notifications/initialized');
    if (!notification.ok) return this.handshakeFailure(notification.diagnostics);
    const listed = await this.client.request<ToolListResult>('tools/list');
    if (!listed.ok) return this.handshakeFailure(listed.diagnostics);
    const tools = listed.value.tools ?? [];
    const validation = validateHandshake(initialized.value.serverInfo, tools);
    this.negotiated = {
      ok: validation.ok,
      serverInfo: initialized.value.serverInfo,
      tools,
      diagnostics: validation.diagnostics,
    };
    return this.negotiated;
  }

  async listTests(): Promise<AgentToolResult> {
    return this.callTool('test_list', {});
  }

  async runTests(
    input: { locations?: string[]; projects?: string[] } = {},
  ): Promise<AgentToolResult> {
    return this.callTool('test_run', {
      locations: input.locations ?? [],
      projects: input.projects ?? [],
    });
  }

  close(): Promise<void> {
    return this.client.close();
  }

  private async callTool(
    name: string,
    arguments_: Record<string, unknown>,
  ): Promise<AgentToolResult> {
    const handshake = await this.handshake();
    if (!handshake.ok) return { ok: false, output: '', diagnostics: handshake.diagnostics };
    const called = await this.client.request<ToolCallResult>('tools/call', {
      name,
      arguments: arguments_,
    });
    if (!called.ok) return { ok: false, output: '', diagnostics: called.diagnostics };
    const output = (called.value.content ?? [])
      .filter((item) => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n');
    if (called.value.isError)
      return {
        ok: false,
        output,
        diagnostics: [
          agentDiagnostic(ARXIC_AGENT_PROCESS_ERROR, name, output || `Tool ${name} failed`),
        ],
      };
    return { ok: true, output, diagnostics: [] };
  }

  private handshakeFailure(diagnostics: Diagnostic[]): AgentHandshakeResult {
    return {
      ok: false,
      tools: [],
      diagnostics: [
        ...diagnostics,
        agentDiagnostic(
          ARXIC_AGENT_HANDSHAKE_FAILED,
          this.options.configPath,
          'Playwright agent capability handshake failed closed',
        ),
      ],
    };
  }
}
