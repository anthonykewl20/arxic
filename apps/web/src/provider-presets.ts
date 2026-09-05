import { fileURLToPath } from 'node:url';

const bridge = fileURLToPath(new URL('../../../scripts/model-agent-bridge.mjs', import.meta.url));
const native = (
  id: string,
  label: string,
  agent: 'codex' | 'claude' | 'opencode' | 'opencode-go',
  models: string[],
  billing: 'subscription' | 'operator-managed',
) => ({
  id,
  label,
  transport: 'host-cli' as const,
  billing,
  command: process.execPath,
  args: [bridge, agent],
  modelArgs: ['--model', '{model}'],
  imageArgs: ['--image', '{image}'],
  isolatedCwd: true,
  catalogAgent: agent,
  models: models.map((id) => ({ id })),
});
export const subscriptionPresets = () => [
  native('claude-account', 'Claude Pro / Max account', 'claude', [], 'subscription'),
  native('codex-account', 'Codex · ChatGPT account', 'codex', [], 'subscription'),
  native('opencode-account', 'OpenCode connected accounts', 'opencode', [], 'operator-managed'),
  native('opencode-go', 'OpenCode Go plan', 'opencode-go', [], 'subscription'),
  {
    id: 'kimi-coding',
    label: 'Kimi Coding membership',
    transport: 'http' as const,
    billing: 'subscription' as const,
    baseUrl: 'https://api.kimi.com/coding/v1',
    credentialRef: 'ARXIC_SECRET_KIMI_CODING_KEY',
    models: [],
  },
  {
    id: 'grok-account',
    label: 'Grok / SuperGrok via OpenClaw',
    transport: 'openclaw' as const,
    billing: 'subscription' as const,
    baseUrl: 'http://127.0.0.1:18789/v1',
    agentId: 'arxic',
    catalogAgent: 'openclaw' as const,
    catalogProvider: 'xai',
    credentialRef: 'ARXIC_SECRET_OPENCLAW_TOKEN',
    models: [],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter API',
    transport: 'http' as const,
    billing: 'api' as const,
    baseUrl: 'https://openrouter.ai/api/v1',
    credentialRef: 'ARXIC_SECRET_OPENROUTER_KEY',
    models: [],
  },
];

export const providerSetup = [
  {
    id: 'claude-account',
    name: 'Claude Pro / Max',
    method: 'Existing Claude Code account',
    command: 'claude auth login',
    url: 'https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan',
    detail:
      'Sign in as the Arxic server user. The native bridge checks for a Claude account and removes API-key overrides for this invocation.',
  },
  {
    id: 'codex-account',
    name: 'OpenAI Codex',
    method: 'ChatGPT subscription',
    command: 'codex login --device-auth',
    url: 'https://learn.chatgpt.com/docs/auth',
    detail:
      'Use the account login on this server. Codex owns token storage and refresh; Arxic checks the login method without reading tokens.',
  },
  {
    id: 'grok-account',
    name: 'Grok / SuperGrok',
    method: 'OpenClaw OAuth connection',
    command: 'openclaw models auth login --provider xai --method oauth',
    url: 'https://docs.openclaw.ai/providers/xai',
    detail:
      'Eligible subscription accounts use device-code sign-in. Connect a dedicated OpenClaw agent and select a model discovered from the connected provider.',
  },
  {
    id: 'kimi-coding',
    name: 'Kimi membership',
    method: 'Kimi Coding plan key',
    url: 'https://www.kimi.com/code/docs/en/kimi-code/membership.html',
    detail:
      'Use the Kimi Coding endpoint and membership key, distinct from a Moonshot API account.',
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    method: 'Coding plan',
    command: 'opencode auth login',
    url: 'https://opencode.ai/docs/go/',
    detail:
      'Connect Go in OpenCode and select an opencode-go/model ID. Its native adapter handles the different protocols used by Go models.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    method: 'API key',
    url: 'https://openrouter.ai/docs/quickstart',
    detail:
      'Use a server secret reference, the compatible API endpoint and your selected model rates. Custom provider/model IDs remain supported.',
  },
];
