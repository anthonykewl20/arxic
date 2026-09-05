import { HttpError } from './errors';

type Prices = { promptPerMillion: number; completionPerMillion: number };
type Connection = {
  id: string;
  label: string;
  transport: 'http' | 'host-cli';
  baseUrl?: string;
  credentialRef?: string;
  command?: string;
  args?: string[];
  modelArgs?: string[];
  imageArgs?: string[];
  models: Array<{ id: string; prices?: Prices }>;
  customModelPrices?: Prices;
};
const modelId = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/u;
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
  if (!env.ARXIC_MODEL_CONNECTIONS?.trim()) return [];
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
      if (item.transport === 'http') {
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
    return values;
  } catch {
    throw new HttpError(
      400,
      'Invalid model connection configuration; ask the server operator to check it',
    );
  }
}

export function modelConnections(env: NodeJS.ProcessEnv = process.env) {
  return [
    {
      id: '',
      label: 'Server default',
      transport: env.ARXIC_MODEL_PROVIDER === 'host-cli' ? 'host-cli' : 'http',
      models: [] as string[],
      modelSelection:
        env.ARXIC_MODEL_PROVIDER !== 'host-cli' || !!env.ARXIC_MODEL_HOST_CLI_MODEL_ARGS,
    },
    ...connections(env).map(({ id, label, transport, models }) => ({
      id,
      label,
      transport,
      models: models.map((model) => model.id),
      modelSelection: true,
    })),
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
    connection.models.find((item) => item.id === model)?.prices ?? connection.customModelPrices;
  if (connection.transport === 'http' && !prices)
    throw new HttpError(400, 'Configure model prices for this provider and model before execution');
  return {
    ARXIC_MODEL_PROVIDER: connection.transport,
    ARXIC_MODEL_BASE_URL: connection.baseUrl,
    ARXIC_MODEL_API_KEY: binding ? env[binding] : undefined,
    ARXIC_MODEL_HOST_CLI: connection.command,
    ARXIC_MODEL_HOST_CLI_ARGS: connection.args ? JSON.stringify(connection.args) : undefined,
    ARXIC_MODEL_HOST_CLI_MODEL_ARGS: connection.modelArgs
      ? JSON.stringify(connection.modelArgs)
      : undefined,
    ARXIC_MODEL_HOST_CLI_IMAGE_ARGS: connection.imageArgs
      ? JSON.stringify(connection.imageArgs)
      : undefined,
    ARXIC_MODEL_PRICES: prices ? JSON.stringify(prices) : undefined,
  };
}
