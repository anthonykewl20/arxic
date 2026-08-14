import { describe, expect, it } from 'vitest';
import { createRunInputFingerprint } from '..';

const sourceRevision = {
  repository: 'file:///workspace/reference-app',
  commit: 'a'.repeat(40),
  dirty: false,
} as const;

const baseline = {
  sourceRevision,
  origin: 'http://127.0.0.1:3210',
  policy: { maxDepth: 1, maxUrls: 8, requireExplorationApproval: false },
  config: {
    framework: 'nextjs',
    features: ['login'],
    languages: ['typescript', 'tsx'],
    models: { inference: 'test-model' },
  },
} as const;

describe('run input fingerprint', () => {
  it('is stable across semantic object key order', () => {
    expect(createRunInputFingerprint(baseline)).toEqual(
      createRunInputFingerprint({
        config: {
          models: { inference: 'test-model' },
          languages: ['typescript', 'tsx'],
          features: ['login'],
          framework: 'nextjs',
        },
        policy: { requireExplorationApproval: false, maxUrls: 8, maxDepth: 1 },
        origin: baseline.origin,
        sourceRevision: {
          dirty: false,
          commit: 'a'.repeat(40),
          repository: sourceRevision.repository,
        },
      }),
    );
  });

  it.each([
    [
      'source revision',
      { ...baseline, sourceRevision: { ...sourceRevision, commit: 'b'.repeat(40) } },
    ],
    ['origin', { ...baseline, origin: 'http://127.0.0.1:3211' }],
    ['policy', { ...baseline, policy: { ...baseline.policy, maxUrls: 9 } }],
    [
      'config/models',
      { ...baseline, config: { ...baseline.config, models: { inference: 'other-model' } } },
    ],
  ])('changes when the semantic %s changes', (_field, changed) => {
    expect(createRunInputFingerprint(changed)).not.toEqual(createRunInputFingerprint(baseline));
  });
});
