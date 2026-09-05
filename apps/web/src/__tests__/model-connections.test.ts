import { afterEach, expect, it, vi } from 'vitest';
import { modelConnections, modelEnvironment, validateConnection } from '../model-connections';

afterEach(() => vi.unstubAllEnvs());
const profiles = [
  {
    id: 'local',
    label: 'Local models',
    transport: 'http',
    baseUrl: 'http://127.0.0.1:11434/v1',
    credentialRef: 'ARXIC_SECRET_LOCAL',
    models: [
      { id: 'vendor/model:custom', prices: { promptPerMillion: 0, completionPerMillion: 0 } },
    ],
  },
  {
    id: 'agent',
    label: 'Coding agent',
    transport: 'host-cli',
    command: 'agent-wrapper',
    args: ['run'],
    modelArgs: ['--model', '{model}'],
    models: [{ id: 'provider/model-x' }],
  },
];
it('refuses unknown profiles and malformed connections without returning configuration secrets', () => {
  vi.stubEnv('ARXIC_MODEL_CONNECTIONS', JSON.stringify(profiles));
  expect(() => validateConnection('missing')).toThrow('not configured');
  for (const extra of [
    { baseUrl: 'https://user:secret@example.test/v1' },
    { credentialRef: 'raw-secret' },
    { models: [{ id: 'x', prices: { promptPerMillion: -1, completionPerMillion: 1 } }] },
  ]) {
    vi.stubEnv('ARXIC_MODEL_CONNECTIONS', JSON.stringify([{ ...profiles[0], ...extra }]));
    expect(() => modelConnections()).toThrow('Invalid model connection configuration');
  }
});

it('requires host model forwarding and keeps legacy host selection limitations explicit', () => {
  vi.stubEnv('ARXIC_MODEL_CONNECTIONS', JSON.stringify([{ ...profiles[1], modelArgs: undefined }]));
  expect(() => modelConnections()).toThrow('Invalid model connection configuration');
  vi.stubEnv('ARXIC_MODEL_CONNECTIONS', '');
  expect(modelConnections({ ARXIC_MODEL_PROVIDER: 'host-cli' })[0]).toMatchObject({
    modelSelection: false,
  });
});

it('allows a deliberate per-job credential override and refuses missing connection credentials', () => {
  const env = {
    ARXIC_MODEL_CONNECTIONS: JSON.stringify(profiles),
    ARXIC_SECRET_OVERRIDE: 'explicit-credential',
  };
  expect(() => modelEnvironment('local', 'vendor/model:custom', '', env)).toThrow(
    'secret reference',
  );
  expect(
    modelEnvironment('local', 'vendor/model:custom', 'ARXIC_SECRET_OVERRIDE', env),
  ).toMatchObject({ ARXIC_MODEL_API_KEY: 'explicit-credential' });
});
it('exposes only connection labels, transport and suggested model IDs', () => {
  vi.stubEnv('ARXIC_MODEL_CONNECTIONS', JSON.stringify(profiles));
  const catalog = modelConnections();
  expect(catalog.find((item) => item.id === 'local')).toMatchObject({
    models: ['vendor/model:custom'],
    label: 'Local models',
    transport: 'http',
  });
  expect(JSON.stringify(catalog)).not.toMatch(/11434|ARXIC_SECRET_LOCAL|agent-wrapper/);
});
it('binds exact connection, custom model prices and selected credential while clearing inherited transport settings', () => {
  const env = {
    ARXIC_MODEL_CONNECTIONS: JSON.stringify(profiles),
    ARXIC_SECRET_LOCAL: 'local-credential',
    ARXIC_MODEL_API_KEY: 'wrong-default',
    ARXIC_MODEL_HOST_CLI: 'wrong-agent',
  };
  const selected = modelEnvironment('local', 'vendor/model:custom', '', env);
  expect(selected).toMatchObject({
    ARXIC_MODEL_PROVIDER: 'http',
    ARXIC_MODEL_BASE_URL: 'http://127.0.0.1:11434/v1',
    ARXIC_MODEL_API_KEY: 'local-credential',
    ARXIC_MODEL_HOST_CLI: undefined,
    ARXIC_MODEL_PRICES: '{"promptPerMillion":0,"completionPerMillion":0}',
  });
  expect(() => modelEnvironment('local', 'another/custom-model', '', env)).toThrow('prices');
  expect(modelEnvironment('agent', 'another/custom-model', '', env)).toMatchObject({
    ARXIC_MODEL_PROVIDER: 'host-cli',
    ARXIC_MODEL_API_KEY: undefined,
    ARXIC_MODEL_BASE_URL: undefined,
    ARXIC_MODEL_HOST_CLI_MODEL_ARGS: '["--model","{model}"]',
  });
});
