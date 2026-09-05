import { expect, it } from 'vitest';
import type { ReplayPersonaDeclaration } from '@arxic/verifier';
import { orchestrationConfig } from '../orchestration-config';
import { VALID_CONFIG } from '../../../cli/src/__tests__/fixtures';

it('both execution lanes retain declared extra origins and replay authentication', () => {
  const declaration: ReplayPersonaDeclaration = {
    mode: 'per-pass-login',
    login: {
      route: '/login',
      fields: [
        { label: 'Email', inputRef: 'persona.email' },
        { label: 'Password', inputRef: 'persona.password' },
      ],
      submit: { label: 'Log in' },
    },
  };
  const config = {
    ...VALID_CONFIG,
    scope: { ...VALID_CONFIG.scope, inventoryRowIds: ['inv:page:GET:000000000001'] },
    fixtures: { ...VALID_CONFIG.fixtures, replayPersona: declaration },
  };
  const persona = { id: 'test', email: 'audit@example.test', password: 'Canary398!' };
  expect(orchestrationConfig(config, persona)).toMatchObject({
    allowedOrigins: config.target.allowedOrigins,
    replayPersona: { declaration, persona: { email: persona.email, password: persona.password } },
    requiredVerificationRuns: 2,
    inventoryRowIds: ['inv:page:GET:000000000001'],
  });
});
