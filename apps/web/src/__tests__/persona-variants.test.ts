import { expect, it } from 'vitest';
import { variantEnvironment } from '../workbench';
import { executionEnvironment } from '../execution';
import type { ExecutionSettings } from '../execution';
import type { Campaign, Run } from '../types';

const settings = {
  model: 'gpt-4o-mini',
  modelSecretRef: '',
  modelBudgetUsd: 0.025,
  frameworks: ['nextjs'],
  domains: ['authentication'],
  languages: ['typescript'],
  featureFlags: {},
  environmentClass: 'local-test',
  attestationPath: '/.well-known/arxic-test-target.json',
  maxUrls: 20,
  maxDepth: 2,
  maxRuntimeMinutes: 10,
  persona: {
    mode: 'anonymous',
    emailRef: '',
    passwordRef: '',
    newPasswordRef: '',
    loginPath: '/login',
    emailLabel: 'Email',
    passwordLabel: 'Password',
    submitLabel: 'Login',
  },
} satisfies ExecutionSettings;

const campaign: Campaign = {
  id: 'campaign-1',
  projectId: 'project-1',
  projectName: 'Variant campaign',
  discoveryRunId: 'discovery-1',
  sourceCommit: 'commit',
  createdAt: new Date().toISOString(),
  runIds: ['run-default', 'run-a'],
  variants: [
    {
      key: 'persona-a',
      label: 'Persona A',
      kind: 'persona',
      persona: {
        emailRef: 'ARXIC_SECRET_PERSONA_A_EMAIL',
        passwordRef: 'ARXIC_SECRET_PERSONA_A_PASSWORD',
      },
    },
    { key: 'flag-b', label: 'Flag B', kind: 'flag', flags: { 'new-checkout': true } },
    { key: 'state-c', label: 'State C', kind: 'state', state: 'anonymous' },
  ],
  rows: [],
};

const agentRun = (variantKey?: string): Pick<Run, 'workflowScope'> => ({
  workflowScope: {
    campaignId: campaign.id,
    inventoryRowId: 'inv:page:GET:7db4b8bf2d28',
    sourceCommit: campaign.sourceCommit,
    ...(variantKey ? { variantKey } : {}),
  },
});

it('returns the unmerged execution environment for default (non-variant) runs', () => {
  const env = {
    ARXIC_SECRET_PERSONA_A_EMAIL: 'persona-a@example.test',
    ARXIC_SECRET_PERSONA_A_PASSWORD: 'PersonaASecret9!',
  };
  expect(variantEnvironment(agentRun(), campaign, settings, env)).toEqual(
    executionEnvironment(settings, env),
  );
});

it('merges the variant persona credentials over the execution environment for variant runs', () => {
  const env = {
    ARXIC_SECRET_PERSONA_A_EMAIL: 'persona-a@example.test',
    ARXIC_SECRET_PERSONA_A_PASSWORD: 'PersonaASecret9!',
  };
  const overrides = variantEnvironment(agentRun('persona-a'), campaign, settings, env);
  expect(overrides.ARXIC_INPUT_PERSONA_EMAIL).toBe('persona-a@example.test');
  expect(overrides.ARXIC_INPUT_PERSONA_PASSWORD).toBe('PersonaASecret9!');
  // The model side of the base environment survives the merge.
  expect(overrides.ARXIC_MODEL_BUDGET_USD).toBe('0.025');
});

it('keeps credential values out of the run record — only ref names are serialized', () => {
  const env = {
    ARXIC_SECRET_PERSONA_A_EMAIL: 'persona-a@example.test',
    ARXIC_SECRET_PERSONA_A_PASSWORD: 'PersonaASecret9!',
  };
  const overrides = variantEnvironment(agentRun('persona-a'), campaign, settings, env);
  expect(JSON.stringify({ workflowScope: agentRun('persona-a').workflowScope })).not.toContain(
    'persona-a@example.test',
  );
  expect(JSON.stringify(overrides)).toContain('persona-a@example.test'); // values live in env overrides only
});

it('refuses to fall back to the default persona when the variant cannot be resolved', async () => {
  const env = {
    ARXIC_SECRET_PERSONA_A_EMAIL: 'persona-a@example.test',
    ARXIC_SECRET_PERSONA_A_PASSWORD: 'PersonaASecret9!',
  };
  const missing = { ...campaign, variants: [] };
  expect(() => variantEnvironment(agentRun('persona-a'), missing, settings, env)).toThrow(
    /variant could not be resolved/u,
  );
  expect(() => variantEnvironment(agentRun('persona-a'), undefined, settings, env)).toThrow(
    /variant could not be resolved/u,
  );
});

it('refuses the run when a variant credential is unset in the environment', () => {
  expect(() => variantEnvironment(agentRun('persona-a'), campaign, settings, {})).toThrow(
    'A selected secret reference is not available on this server',
  );
});

it('gives flag variant runs the unmodified base environment — no persona env keys', () => {
  const env = {
    ARXIC_SECRET_PERSONA_A_EMAIL: 'persona-a@example.test',
    ARXIC_SECRET_PERSONA_A_PASSWORD: 'PersonaASecret9!',
  };
  const overrides = variantEnvironment(agentRun('flag-b'), campaign, settings, env);
  expect(overrides).toEqual(executionEnvironment(settings, env));
  expect(overrides.ARXIC_INPUT_PERSONA_EMAIL).toBeUndefined();
  expect(overrides.ARXIC_INPUT_PERSONA_PASSWORD).toBeUndefined();
});

it('gives state variant runs the unmodified base environment — no persona env keys', () => {
  const env = {
    ARXIC_SECRET_PERSONA_A_EMAIL: 'persona-a@example.test',
    ARXIC_SECRET_PERSONA_A_PASSWORD: 'PersonaASecret9!',
  };
  const overrides = variantEnvironment(agentRun('state-c'), campaign, settings, env);
  expect(overrides).toEqual(executionEnvironment(settings, env));
  expect(overrides.ARXIC_INPUT_PERSONA_EMAIL).toBeUndefined();
});

it('still refuses to run flag and state variants that cannot be resolved', () => {
  const missing = { ...campaign, variants: [] as NonNullable<Campaign['variants']> };
  expect(() => variantEnvironment(agentRun('flag-b'), missing, settings, {})).toThrow(
    /variant could not be resolved/u,
  );
  expect(() => variantEnvironment(agentRun('state-c'), undefined, settings, {})).toThrow(
    /variant could not be resolved/u,
  );
});
