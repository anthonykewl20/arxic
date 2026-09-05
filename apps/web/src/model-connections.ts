import { sha256 } from '@arxic/contracts';
import { HttpError } from './errors';
import { subscriptionPresets } from './provider-presets';
import { discoverHttpModels, type CatalogModel } from './model-catalog';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

type Prices = { promptPerMillion: number; completionPerMillion: number };
type Connection = {
  id: string;
  label: string;
  transport: 'http' | 'host-cli' | 'openclaw';
  agentId?: string;
  catalogProvider?: string;
  catalogAgent?: 'codex' | 'claude' | 'opencode' | 'opencode-go' | 'openclaw';
  baseUrl?: string;
  credentialRef?: string;
  command?: string;
  args?: string[];
  modelArgs?: string[];
  imageArgs?: string[];
  models: Array<{ id: string; prices?: Prices }>;
  customModelPrices?: Prices;
  billing?: 'api' | 'subscription' | 'operator-managed';
  isolatedCwd?: boolean;
  jsonInput?: boolean;
};
const modelId = /^[a-zA-Z0-9][a-zA-Z0-9._:/[\]-]{0,119}$/u;
const credentialRef = /^ARXIC_SECRET_[A-Z][A-Z0-9_]{0,80}$/u;
const isPrices = (value: unknown): value is Prices => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    ['promptPerMillion', 'completionPerMillion'].every(
      (key) => typeof record[key] === 'number' && Number.isFinite(record[key]) && record[key] >= 0,
    )
  );
};
const args = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 50 &&
  value.every((item) => typeof item === 'string' && item.length <= 2000 && !item.includes('\0'));

/** Operator-owned connections. Never expose endpoints, commands or bindings to the browser. */
function connections(env: NodeJS.ProcessEnv): Connection[] {
  if (!env.ARXIC_MODEL_CONNECTIONS?.trim()) return subscriptionPresets();
  try {
    const values: Connection[] = JSON.parse(env.ARXIC_MODEL_CONNECTIONS);
    if (!Array.isArray(values) || values.length > 30) throw new Error();
    const ids = new Set<string>();
    for (const item of values) {
      if (
        !item ||
        typeof item !== 'object' ||
        Object.keys(item).some(
          (key) =>
            ![
              'id',
              'label',
              'transport',
              'baseUrl',
              'credentialRef',
              'command',
              'args',
              'modelArgs',
              'imageArgs',
              'models',
              'customModelPrices',
              'billing',
              'isolatedCwd',
              'jsonInput',
              'agentId',
              'catalogAgent',
              'catalogProvider',
            ].includes(key),
        ) ||
        typeof item.id !== 'string' ||
        !/^[a-z][a-z0-9-]{0,39}$/u.test(item.id) ||
        ids.has(item.id) ||
        typeof item.label !== 'string' ||
        !item.label.trim() ||
        item.label.length > 100 ||
        !Array.isArray(item.models) ||
        item.models.length > 200
      )
        throw new Error();
      ids.add(item.id);
      if (
        item.billing !== undefined &&
        !['api', 'subscription', 'operator-managed'].includes(item.billing)
      )
        throw new Error();
      if (item.jsonInput !== undefined && typeof item.jsonInput !== 'boolean') throw new Error();
      if (item.isolatedCwd !== undefined && typeof item.isolatedCwd !== 'boolean')
        throw new Error();
      if (
        item.catalogAgent !== undefined &&
        !['codex', 'claude', 'opencode', 'opencode-go', 'openclaw'].includes(item.catalogAgent)
      )
        throw new Error();
      if (
        item.catalogProvider !== undefined &&
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(item.catalogProvider)
      )
        throw new Error();
      const models = new Set<string>();
      for (const model of item.models) {
        if (
          !model ||
          typeof model !== 'object' ||
          Object.keys(model).some((key) => !['id', 'prices'].includes(key)) ||
          typeof model.id !== 'string' ||
          !modelId.test(model.id) ||
          models.has(model.id) ||
          (model.prices !== undefined && !isPrices(model.prices))
        )
          throw new Error();
        models.add(model.id);
      }
      if (item.customModelPrices !== undefined && !isPrices(item.customModelPrices))
        throw new Error();
      if (item.credentialRef !== undefined && !credentialRef.test(item.credentialRef))
        throw new Error();
      if (
        item.agentId !== undefined &&
        (item.transport !== 'openclaw' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(item.agentId))
      )
        throw new Error();
      if (item.transport === 'http' || item.transport === 'openclaw') {
        if (
          typeof item.baseUrl !== 'string' ||
          item.command !== undefined ||
          item.args !== undefined ||
          item.modelArgs !== undefined ||
          item.imageArgs !== undefined
        )
          throw new Error();
        const url = new URL(item.baseUrl);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error();
      } else if (item.transport === 'host-cli') {
        if (
          typeof item.command !== 'string' ||
          !item.command.trim() ||
          item.command.includes('\0') ||
          item.baseUrl !== undefined ||
          !args(item.modelArgs) ||
          !item.modelArgs.includes('{model}') ||
          (item.args !== undefined && !args(item.args)) ||
          (item.imageArgs !== undefined &&
            (!args(item.imageArgs) || !item.imageArgs.includes('{image}')))
        )
          throw new Error();
      } else throw new Error();
    }
    return [...values, ...subscriptionPresets().filter((item) => !ids.has(item.id))];
  } catch {
    throw new HttpError(
      400,
      'Invalid model connection configuration; ask the server operator to check it',
    );
  }
}

function serverDefaultConnection(env: NodeJS.ProcessEnv): Connection | undefined {
  if (env.ARXIC_MODEL_PROVIDER && env.ARXIC_MODEL_PROVIDER !== 'http') return undefined;
  const baseUrl = env.ARXIC_MODEL_BASE_URL?.trim();
  if (!baseUrl) return undefined;
  return {
    id: '',
    label: 'Server default',
    transport: 'http',
    baseUrl,
    credentialRef: env.ARXIC_MODEL_API_KEY ? 'ARXIC_MODEL_API_KEY' : undefined,
    models: [],
  };
}

export function modelConnections(env: NodeJS.ProcessEnv = process.env) {
  const defaultConnection = serverDefaultConnection(env);
  const defaultKey = defaultConnection ? catalogKey(defaultConnection, env) : undefined;
  return [
    {
      id: '',
      label: 'Server default',
      transport:
        env.ARXIC_MODEL_PROVIDER === 'host-cli'
          ? 'host-cli'
          : env.ARXIC_MODEL_PROVIDER === 'openclaw'
            ? 'openclaw'
            : 'http',
      models: defaultKey ? (catalogs.get(defaultKey)?.models.map((model) => model.id) ?? []) : [],
      catalog: defaultKey
        ? catalogStatus(defaultKey)
        : {
            status: 'unavailable',
            fetchedAt: null,
            error:
              'Catalog discovery is unavailable for this server default. Configure an HTTP endpoint or choose a named provider. Custom model IDs remain available.',
          },
      modelSelection:
        env.ARXIC_MODEL_PROVIDER !== 'host-cli' || !!env.ARXIC_MODEL_HOST_CLI_MODEL_ARGS,
    },
    ...connections(env).map((connection) => {
      const { id, label, transport, billing } = connection;
      const key = catalogKey(connection, env);
      return {
        id,
        label,
        transport,
        models: catalogs.get(key)?.models.map((model) => model.id) ?? [],
        catalog: catalogStatus(key),
        modelSelection: true,
        billing: billing ?? (transport === 'host-cli' ? 'operator-managed' : 'api'),
      };
    }),
  ];
}

export function validateConnection(value: unknown, env: NodeJS.ProcessEnv = process.env): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || !connections(env).some((item) => item.id === value))
    throw new HttpError(400, 'Selected model provider is not configured on this server');
  return value;
}

/** Resolve one job's provider selection; the caller owns scheduling and authorization. */
export function modelEnvironment(
  id: string | undefined,
  model: string,
  secret: string,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const selected = validateConnection(id, env);
  const connection = selected ? connections(env).find((item) => item.id === selected)! : undefined;
  const binding = secret || connection?.credentialRef;
  if (binding && (!credentialRef.test(binding) || !env[binding]))
    throw new HttpError(400, 'A selected secret reference is not available on this server');
  if (!connection) return binding ? { ARXIC_MODEL_API_KEY: env[binding] } : {};
  const prices =
    connection.models.find((item) => item.id === model)?.prices ??
    catalogs.get(catalogKey(connection, env))?.models.find((item) => item.id === model)?.prices ??
    connection.customModelPrices;
  if (connection.transport !== 'host-cli' && !prices && connection.billing !== 'subscription')
    throw new HttpError(400, 'Configure model prices for this provider and model before execution');
  return {
    ARXIC_MODEL_PROVIDER: connection.transport,
    ARXIC_MODEL_GATEWAY_AGENT: connection.agentId,
    ARXIC_MODEL_BILLING_MODE: connection.billing,
    ARXIC_MODEL_BASE_URL: connection.baseUrl,
    ARXIC_MODEL_API_KEY: binding ? env[binding] : undefined,
    ARXIC_MODEL_HOST_CLI: connection.command,
    ARXIC_MODEL_HOST_CLI_ISOLATE: connection.isolatedCwd ? '1' : undefined,
    ARXIC_MODEL_HOST_CLI_JSON_INPUT: connection.jsonInput ? '1' : undefined,
    ARXIC_MODEL_HOST_CLI_ARGS: connection.args ? JSON.stringify(connection.args) : undefined,
    ARXIC_MODEL_HOST_CLI_MODEL_ARGS: connection.modelArgs
      ? JSON.stringify(connection.modelArgs)
      : undefined,
    ARXIC_MODEL_HOST_CLI_IMAGE_ARGS: connection.imageArgs
      ? JSON.stringify(connection.imageArgs)
      : undefined,
    ARXIC_MODEL_PRICES:
      connection.billing === 'subscription'
        ? '{"promptPerMillion":0,"completionPerMillion":0}'
        : prices
          ? JSON.stringify(prices)
          : undefined,
  };
}

type CatalogState = {
  models: CatalogModel[];
  fetchedAt?: string;
  attemptedAt: number;
  error?: string;
  pending?: Promise<void>;
};
const catalogs = new Map<string, CatalogState>();
function catalogKey(connection: Connection, env: NodeJS.ProcessEnv) {
  return sha256(
    JSON.stringify([connection, connection.credentialRef ? env[connection.credentialRef] : null]),
  );
}
const catalogTtl = 5 * 60_000;
function catalogStatus(id: string) {
  const state = catalogs.get(id);
  return {
    status: state?.pending
      ? 'refreshing'
      : state?.error
        ? 'error'
        : state?.fetchedAt
          ? 'ready'
          : 'unfetched',
    fetchedAt: state?.fetchedAt ?? null,
    error: state?.error ?? null,
  };
}
/** Authenticated dashboard action: deduplicate refreshes and preserve visibly stale data on failure. */
export async function refreshModelCatalog(id: string, env: NodeJS.ProcessEnv = process.env) {
  validateConnection(id, env);
  const connection = id
    ? connections(env).find((item) => item.id === id)
    : serverDefaultConnection(env);
  if (!connection)
    throw new HttpError(
      400,
      'Configure the default HTTP endpoint or choose a named provider to discover models',
    );
  const key = catalogKey(connection, env);
  const previous = catalogs.get(key);
  if (previous?.pending) return previous.pending;
  const state: CatalogState = {
    models: previous?.models ?? [],
    fetchedAt: previous?.fetchedAt,
    attemptedAt: Date.now(),
  };
  catalogs.set(key, state);
  state.pending = (async () => {
    await Promise.resolve();
    try {
      if (connection.transport === 'http') {
        const binding = connection.credentialRef;
        if (binding && !env[binding])
          throw new Error('The provider credential is not configured on this server');
        state.models = await discoverHttpModels(
          connection.baseUrl!,
          binding ? env[binding] : undefined,
        );
      } else {
        const native = connection.catalogAgent;
        if (!native)
          throw new Error(
            'This agent has no catalog discovery adapter. Custom model IDs remain available',
          );
        const script = fileURLToPath(
          new URL('../../../scripts/model-catalog-bridge.mjs', import.meta.url),
        );
        const { stdout } = await promisify(execFile)(process.execPath, [script, native], {
          env: {
            ...env,
            ARXIC_MODEL_GATEWAY_AGENT: connection.agentId,
            ARXIC_MODEL_CATALOG_PROVIDER: connection.catalogProvider,
          },
          timeout: 30_000,
          maxBuffer: 4 * 1024 * 1024,
        });
        state.models = JSON.parse(stdout);
      }
      state.fetchedAt = new Date().toISOString();
    } catch (error) {
      state.error =
        error instanceof Error &&
        !('cmd' in error) &&
        /^(Model discovery failed \(HTTP \d{3}\)|Provider |The provider credential|This agent has no catalog)/u.test(
          error.message,
        )
          ? error.message
          : 'Model discovery failed. Check the provider connection and installed CLI';
    } finally {
      state.pending = undefined;
    }
  })();
  await state.pending;
}
export function refreshDueModelCatalogs(env: NodeJS.ProcessEnv = process.env) {
  const defaultConnection = serverDefaultConnection(env);
  for (const connection of [
    ...connections(env),
    ...(defaultConnection ? [defaultConnection] : []),
  ]) {
    const state = catalogs.get(catalogKey(connection, env));
    if (state && !state.pending && Date.now() - state.attemptedAt >= catalogTtl)
      void refreshModelCatalog(connection.id, env);
  }
}
