import { expect, it } from 'vitest';
import {
  canonicalVersion,
  formatVersionLabel,
  bumpVersion,
} from '../packages/contracts/src/version-policy.mjs';

it('rejects malformed or unsafe version counters', () => {
  for (const value of ['0.0.-1', '0.0.NaN', '0.0.1-extra', '0.0.9007199254740992', '1.2'])
    expect(() => canonicalVersion(value)).toThrow();
  expect(() => bumpVersion('0.0.100', 'unknown')).toThrow();
});
it('uses the owner’s three-digit labels and +100 minor / +1 patch cadence', () => {
  expect(formatVersionLabel('0.0.1')).toBe('v0.0.001');
  expect(formatVersionLabel('0.0.100')).toBe('v0.0.100');
  expect(canonicalVersion('v0.0.007')).toBe('0.0.7');
  expect(bumpVersion('0.0.100', 'minor')).toBe('0.0.200');
  expect(bumpVersion('0.0.100', 'patch')).toBe('0.0.101');
  expect(bumpVersion('0.0.101', 'minor')).toBe('0.0.201');
  expect(formatVersionLabel(bumpVersion('0.0.900', 'minor'))).toBe('v0.0.1000');
});
