import type { Diagnostic } from '@arxic/contracts';
import { ARXIC_AGENT_SCHEMA_DRIFT, ARXIC_AGENT_TOOL_MISSING, agentDiagnostic } from './diagnostics';

export const EXPECTED_SERVER_NAME = 'Playwright Test Runner' as const;
export const EXPECTED_SERVER_VERSION = '1.62.1' as const;

export const REQUIRED_TOOLS = {
  planner_setup_page: ['project', 'seedFile'],
  planner_submit_plan: ['overview', 'suites'],
  planner_save_plan: ['overview', 'suites', 'name', 'fileName'],
  generator_setup_page: ['plan', 'project', 'seedFile'],
  generator_read_log: [],
  generator_write_test: ['fileName', 'code'],
  test_list: [],
  test_run: ['locations', 'projects'],
  test_debug: ['test'],
} as const;

export type McpServerInfo = { name: string; version: string };
export type McpTool = {
  name: string;
  inputSchema?: { properties?: Record<string, unknown> };
};

export type HandshakeValidation = {
  ok: boolean;
  missingTools: string[];
  schemaDrift: string[];
  diagnostics: Diagnostic[];
};

export function validateHandshake(
  serverInfo: McpServerInfo | undefined,
  tools: McpTool[],
): HandshakeValidation {
  const diagnostics: Diagnostic[] = [];
  const missingTools: string[] = [];
  const schemaDrift: string[] = [];
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const [name, keys] of Object.entries(REQUIRED_TOOLS)) {
    const tool = byName.get(name);
    if (!tool) {
      missingTools.push(name);
      diagnostics.push(
        agentDiagnostic(ARXIC_AGENT_TOOL_MISSING, name, `Required tool ${name} is missing`),
      );
      continue;
    }
    const actual = Object.keys(tool.inputSchema?.properties ?? {}).sort();
    const expected = [...keys].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      schemaDrift.push(name);
      diagnostics.push(
        agentDiagnostic(
          ARXIC_AGENT_SCHEMA_DRIFT,
          name,
          `Tool ${name} schema keys changed: expected [${expected.join(', ')}], received [${actual.join(', ')}]`,
        ),
      );
    }
  }
  if (serverInfo?.name !== EXPECTED_SERVER_NAME) {
    schemaDrift.push('serverInfo.name');
    diagnostics.push(
      agentDiagnostic(
        ARXIC_AGENT_SCHEMA_DRIFT,
        'serverInfo.name',
        `Expected server ${EXPECTED_SERVER_NAME}, received ${serverInfo?.name ?? 'none'}`,
      ),
    );
  }
  if (serverInfo?.version !== EXPECTED_SERVER_VERSION) {
    schemaDrift.push('serverInfo.version');
    diagnostics.push(
      agentDiagnostic(
        ARXIC_AGENT_SCHEMA_DRIFT,
        'serverInfo.version',
        `Expected server version ${EXPECTED_SERVER_VERSION}, received ${serverInfo?.version ?? 'none'}`,
      ),
    );
  }
  return { ok: diagnostics.length === 0, missingTools, schemaDrift, diagnostics };
}
