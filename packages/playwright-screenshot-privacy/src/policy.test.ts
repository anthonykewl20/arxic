import { describe, expect, test } from 'vitest';
import { serializeScreenshotPrivacyPolicy } from './index';

const approvedRegion = {
  schemaVersion: 1,
  id: 'fixture-home-heading',
  authority: {
    kind: 'declared-human-approval',
    reference: 'docs/evidence/M1-SCREENSHOT-PRIVACY/README.md',
    recordedAt: '2026-08-09T12:00:00.000Z',
  },
  capture: {
    mode: 'approved-region',
    region: {
      kind: 'role',
      role: 'heading',
      name: 'Reference Auth App',
      exact: true,
    },
    masks: [],
  },
} as const;

describe('screenshot privacy policy', () => {
  test.each([
    undefined,
    {},
    { ...approvedRegion, schemaVersion: 2 },
    { ...approvedRegion, id: '../escape' },
    { ...approvedRegion, extra: true },
    { ...approvedRegion, authority: { ...approvedRegion.authority, kind: 'self-approved' } },
    {
      ...approvedRegion,
      capture: {
        mode: 'approved-region',
        region: { kind: 'css', selector: '#account' },
        masks: [],
      },
    },
    {
      ...approvedRegion,
      capture: { mode: 'masked-page', fullPage: true, masks: [] },
    },
  ])('fails closed on malformed or unbounded policy %#', (candidate) => {
    expect(() => serializeScreenshotPrivacyPolicy(candidate)).toThrow(/ARXIC-SCREENSHOT-POLICY/u);
  });

  test('canonicalizes an approved semantic region and binds it by SHA-256', () => {
    const first = serializeScreenshotPrivacyPolicy(approvedRegion);
    const reordered = serializeScreenshotPrivacyPolicy({
      capture: approvedRegion.capture,
      authority: approvedRegion.authority,
      id: approvedRegion.id,
      schemaVersion: approvedRegion.schemaVersion,
    });

    expect(first).toEqual(reordered);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.json).toBe(
      '{"authority":{"kind":"declared-human-approval","recordedAt":"2026-08-09T12:00:00.000Z","reference":"docs/evidence/M1-SCREENSHOT-PRIVACY/README.md"},"capture":{"masks":[],"mode":"approved-region","region":{"exact":true,"kind":"role","name":"Reference Auth App","role":"heading"}},"id":"fixture-home-heading","schemaVersion":1}',
    );
  });
});
