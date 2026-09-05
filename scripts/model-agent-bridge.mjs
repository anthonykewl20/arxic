import { spawn } from 'node:child_process';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Native CLIs own subscription login/refresh. Never read their credential stores. */
export function subscriptionEnvironment(provider, inherited) {
  const env = { ...inherited };
  const keys =
    provider === 'claude'
      ? [
          'ANTHROPIC_API_KEY',
          'ANTHROPIC_AUTH_TOKEN',
          'ANTHROPIC_BASE_URL',
          'CLAUDE_CODE_OAUTH_TOKEN',
          'CLAUDE_CODE_USE_BEDROCK',
          'CLAUDE_CODE_USE_VERTEX',
          'CLAUDE_CODE_USE_FOUNDRY',
        ]
      : provider === 'codex'
        ? ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL']
        : [];
  for (const key of keys) delete env[key];
  delete env.ARXIC_ADMIN_TOKEN;
  for (const key of Object.keys(env)) if (key.startsWith('ARXIC_SECRET_')) delete env[key];
  return env;
}

export function agentInvocation(provider, model, prompt, images, schema, schemaFile) {
  if (provider === 'codex')
    return {
      args: [
        'exec',
        '--json',
        ...(schemaFile ? ['--output-schema', schemaFile] : []),
        '--ephemeral',
        '--ignore-user-config',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--disable',
        'shell_tool',
        '--disable',
        'multi_agent',
        '--disable',
        'skill_search',
        '--enable',
        'skip_host_skill_discovery',
        '-c',
        'web_search="disabled"',
        '--model',
        model,
        ...images.flatMap((image) => ['--image', image.path]),
        '-',
      ],
      stdin: prompt,
    };
  if (provider === 'claude')
    return {
      args: [
        '--print',
        '--output-format',
        'stream-json',
        '--verbose',
        '--input-format',
        'stream-json',
        '--no-session-persistence',
        ...(schema ? ['--json-schema', JSON.stringify(schema)] : []),
        '--setting-sources',
        '',
        '--settings',
        '{"disableAllHooks":true}',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--tools',
        '',
        '--permission-mode',
        'dontAsk',
        '--model',
        model,
      ],
      stdin:
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...images.map((image) => ({
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: image.base64 },
              })),
            ],
          },
        }) + '\n',
    };
  if (provider === 'opencode')
    return {
      args: [
        'run',
        '--pure',
        '--format',
        'json',
        '--model',
        model,
        ...images.flatMap((image) => ['--file', image.path]),
      ],
      stdin: prompt,
    };
  throw new Error('Unsupported native coding agent');
}

function events(output) {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return {};
      }
    });
}
export function agentResult(provider, output) {
  if (provider === 'claude') {
    let result;
    try {
      result = JSON.parse(output);
    } catch {
      result = events(output).findLast((row) => row.type === 'result');
    }
    if (!result) throw new Error('Native agent returned no result');
    if (
      !result.is_error &&
      result.structured_output &&
      typeof result.structured_output === 'object'
    )
      return JSON.stringify(result.structured_output);
    if (result.is_error || typeof result.result !== 'string' || !result.result.trim())
      throw new Error('Native agent failed');
    return result.result;
  }
  const rows = events(output);
  if (rows.some((row) => ['error', 'turn.failed'].includes(row.type)))
    throw new Error('Native agent failed');
  const text =
    provider === 'codex'
      ? rows
          .filter((row) => row.type === 'item.completed' && row.item?.type === 'agent_message')
          .map((row) => row.item.text)
          .at(-1)
      : rows
          .filter((row) => row.type === 'text')
          .map((row) => row.part?.text ?? '')
          .join('\n');
  if (typeof text !== 'string' || !text.trim())
    throw new Error('Native agent returned no completion');
  return text;
}

function run(command, args, stdin, env, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
    const chunks = [];
    let stderr = '',
      size = 0;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Native agent timed out'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        child.kill('SIGKILL');
        reject(new Error('Native agent output limit'));
      } else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 8192) stderr += chunk;
    });
    child.stdin.on('error', () => undefined);
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('Native agent unavailable'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(chunks).toString('utf8'), stderr });
    });
    child.stdin.end(stdin);
  });
}

export async function runBridge(
  provider,
  model,
  prompt,
  imagePaths = [],
  inherited = process.env,
  schema,
) {
  if (provider === 'opencode-go') {
    if (!model.startsWith('opencode-go/'))
      throw new Error('Select an OpenCode Go model for the Go plan');
    provider = 'opencode';
  }
  if (
    !['claude', 'codex', 'opencode'].includes(provider) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/[\]-]{0,119}$/u.test(model)
  )
    throw new Error('Invalid native agent selection');
  const command = inherited[`ARXIC_${provider.toUpperCase()}_COMMAND`] || provider;
  const env = subscriptionEnvironment(provider, inherited);
  if (provider === 'codex') {
    const status = await run(command, ['login', 'status'], '', env, 10_000);
    if (
      status.code !== 0 ||
      !/^\s*Logged in using ChatGPT(?:\s|$)/m.test(`${status.stdout}${status.stderr}`)
    )
      throw new Error('Sign in to Codex with a ChatGPT account on this server');
  } else if (provider === 'claude') {
    const status = await run(command, ['auth', 'status'], '', env, 10_000);
    let auth;
    try {
      auth = JSON.parse(status.stdout);
    } catch {
      throw new Error('Claude subscription login could not be checked');
    }
    if (status.code !== 0 || auth.loggedIn !== true || auth.authMethod !== 'claude.ai')
      throw new Error('Sign in to Claude Code with your subscription on this server');
  } else {
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ permission: { '*': 'deny' } });
  }
  const images = await Promise.all(
    imagePaths.map(async (path) => ({ path, base64: (await readFile(path)).toString('base64') })),
  );
  const schemaDirectory =
    provider === 'codex' && schema
      ? await mkdtemp(
          join(
            inherited.ARXIC_MODEL_HOST_CLI_ISOLATE === '1' ? process.cwd() : tmpdir(),
            'arxic-native-schema-',
          ),
        )
      : undefined;
  try {
    const schemaFile = schemaDirectory ? join(schemaDirectory, 'output.json') : undefined;
    if (schemaFile)
      await writeFile(schemaFile, JSON.stringify(schema), { mode: 0o600, flag: 'wx' });
    const call = agentInvocation(provider, model, prompt, images, schema, schemaFile);
    const result = await run(command, call.args, call.stdin, env);
    let output;
    let failure;
    try {
      if (result.code !== 0) throw new Error('Native agent failed');
      output = agentResult(provider, result.stdout);
    } catch (error) {
      failure = error;
    }
    if (provider === 'opencode') {
      for (const session of new Set(
        events(result.stdout)
          .map((row) => row.sessionID)
          .filter((id) => typeof id === 'string' && /^ses_[a-zA-Z0-9]+$/u.test(id)),
      )) {
        const deleted = await run(command, ['session', 'delete', session], '', env, 10_000);
        if (deleted.code !== 0) throw new Error('Native agent session cleanup failed');
      }
    }
    if (failure) throw failure;
    return output;
  } finally {
    if (schemaDirectory) await rm(schemaDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [provider, ...args] = process.argv.slice(2);
    const modelIndex = args.indexOf('--model');
    const model = args[modelIndex + 1];
    if (modelIndex < 0) throw new Error('A model ID is required');
    args.splice(modelIndex, 2);
    const images = [];
    while (args.length) {
      if (args.shift() !== '--image' || !args[0]) throw new Error('Invalid image arguments');
      images.push(args.shift());
    }
    let prompt = '';
    for await (const chunk of process.stdin) {
      prompt += chunk;
      if (Buffer.byteLength(prompt) > 8 * 1024 * 1024) throw new Error('Prompt limit');
    }
    const envelope =
      process.env.ARXIC_MODEL_HOST_CLI_JSON_INPUT === '1' ? JSON.parse(prompt) : { prompt };
    if (
      typeof envelope.prompt !== 'string' ||
      (envelope.schema !== undefined && (!envelope.schema || typeof envelope.schema !== 'object'))
    )
      throw new Error('Invalid native input');
    process.stdout.write(
      await runBridge(provider, model, envelope.prompt, images, process.env, envelope.schema),
    );
  } catch {
    process.stderr.write(
      'Coding agent request blocked; check account login, model access and quota.\n',
    );
    process.exitCode = 1;
  }
}
