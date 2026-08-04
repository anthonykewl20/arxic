import { describe, expect, it } from 'vitest';
import {
  ARXIC_EVIDENCE_ID_GRAMMAR,
  ARXIC_EVIDENCE_INDEX_INVALID,
  validateEvidenceIndex,
  type EvidenceIndex,
} from '..';

const evidenceIndex: EvidenceIndex = {
  'src:forgot-link': {
    kind: 'source',
    repo: 'https://github.com/example/shop',
    commit: '0123456789abcdef0123456789abcdef01234567',
    path: 'src/login.tsx',
    startLine: 20,
    endLine: 24,
    blobSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    extractor: 'tree-sitter@1.0.0',
  },
  'run:reset-submit': {
    kind: 'runtime',
    runId: 'run-reset-submit-001',
    appBuildDigest: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    browser: 'chromium',
    browserVersion: '128.0.6613.84',
    url: 'https://app.arxic.test/reset',
    timestamp: '2026-08-04T12:34:56.000Z',
    networkRefs: ['artifacts/network/reset-submit.har'],
  },
  'doc:spec#4.2': {
    kind: 'document',
    artifactRef: 'docs/authentication.md',
    section: '4.2',
    sha256: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
  },
};

const expectCode = (input: unknown, code: string) => {
  const result = validateEvidenceIndex(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  }
};

describe('EvidenceIndex contract', () => {
  it('rejects an unsupported evidence kind in an id', () => {
    expectCode({ 'wrong:foo': evidenceIndex['src:forgot-link'] }, ARXIC_EVIDENCE_ID_GRAMMAR);
  });

  it('rejects an empty evidence id subject', () => {
    expectCode({ 'src:': evidenceIndex['src:forgot-link'] }, ARXIC_EVIDENCE_ID_GRAMMAR);
  });

  it('rejects an invalid EvidenceRef value', () => {
    expectCode({ 'src:forgot-link': { kind: 'source' } }, ARXIC_EVIDENCE_INDEX_INVALID);
  });

  it('rejects an empty index', () => {
    expectCode({}, ARXIC_EVIDENCE_INDEX_INVALID);
  });

  it('accepts the concrete ADR evidence ids mapped to valid refs', () => {
    expect(validateEvidenceIndex(evidenceIndex)).toEqual({ ok: true, value: evidenceIndex });
  });
});
