import { expect, it } from 'vitest';
import { validateModel, fuseShadow } from './model';

it('rejects malformed or promotion-claiming model manifests', () => {
  for (const manifest of [{}, { version: 1, verified: true }, { thresholds: [NaN] }])
    expect(() => validateModel(manifest)).toThrow('invalid-model');
});

it('preserves hard failures when the model is absent or predicts no defects', () => {
  const hardChecks = [{ id: 'clip', head: 'clipping', verdict: 'fail' as const, region: 'r' }];
  const result = fuseShadow(hardChecks, []);
  expect(result.hardChecks).toEqual(hardChecks);
  expect(result.modelAuthority).toBe('hypothesis-only');
  expect(result.overallPass).toBe(false);
});
