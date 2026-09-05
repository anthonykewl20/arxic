import { expect, it } from 'vitest';
import { agentInvocation, agentResult, subscriptionEnvironment } from './model-agent-bridge.mjs';

it('refuses failed native results instead of treating an error envelope as a completion', () => {
  expect(() => agentResult('claude', '{"is_error":true,"result":"not logged in"}')).toThrow();
  expect(() =>
    agentResult('codex', '{"type":"turn.failed","error":{"message":"quota"}}'),
  ).toThrow();
  expect(() => agentResult('opencode', '{"type":"error","error":{"name":"AuthError"}}')).toThrow();
});
it('uses subscription credentials without inherited API or alternate-cloud routing', () => {
  const env = subscriptionEnvironment('claude', {
    PATH: '/bin',
    ANTHROPIC_API_KEY: 'wrong',
    ANTHROPIC_AUTH_TOKEN: 'wrong',
    CLAUDE_CODE_USE_BEDROCK: '1',
    OPENAI_API_KEY: 'wrong',
    CODEX_API_KEY: 'wrong',
  });
  expect(env.PATH).toBe('/bin');
  expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
  expect(env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
  expect(env).not.toHaveProperty('CLAUDE_CODE_USE_BEDROCK');
  expect(subscriptionEnvironment('codex', env)).not.toHaveProperty('OPENAI_API_KEY');
});
it('uses ephemeral stdin calls and extracts only the final native text', () => {
  const call = agentInvocation('codex', 'custom-model', 'private prompt', []);
  expect(call.args).toContain('--ephemeral');
  expect(call.args).toContain('--ignore-user-config');
  expect(call.args).toContain('custom-model');
  expect(call.args).not.toContain('private prompt');
  expect(call.stdin).toBe('private prompt');
  expect(
    agentResult(
      'codex',
      '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"answer\\":42}"}}\n{"type":"turn.completed"}',
    ),
  ).toBe('{"answer":42}');
  expect(agentResult('claude', '{"is_error":false,"result":"{\\"answer\\":42}"}')).toBe(
    '{"answer":42}',
  );
  expect(agentInvocation('claude', 'sonnet', 'private prompt', []).args).not.toContain('--bare');
});
