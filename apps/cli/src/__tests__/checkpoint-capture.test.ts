import { expect, it } from 'vitest';
import { validateConfig } from '../config/validate';
import { VALID_CONFIG } from './fixtures';
const capture = {
  mode: 'approved-region',
  region: { kind: 'role', role: 'heading', name: 'Reference Auth App', exact: true },
  masks: [],
};
it.each([
  null,
  {},
  { ...capture, region: { kind: 'css', selector: 'body' } },
  { ...capture, surprise: true },
])('refuses malformed checkpoint capture %j', (checkpointCapture) => {
  expect(
    validateConfig({ ...VALID_CONFIG, policy: { ...VALID_CONFIG.policy, checkpointCapture } }).ok,
  ).toBe(false);
});
it('preserves an explicit semantic checkpoint capture declaration', () => {
  expect(
    validateConfig({
      ...VALID_CONFIG,
      policy: { ...VALID_CONFIG.policy, checkpointCapture: capture },
    }),
  ).toMatchObject({ ok: true, value: { policy: { checkpointCapture: capture } } });
});
