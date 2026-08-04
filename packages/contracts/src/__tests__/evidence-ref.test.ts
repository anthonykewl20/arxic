import { describe, expect, it } from 'vitest';
import {
  ARXIC_EVIDENCE_REF_INVALID,
  ARXIC_EVIDENCE_REF_KIND_UNKNOWN,
  ARXIC_EVIDENCE_REF_RANGE,
  validateEvidenceRef,
  type EvidenceRefDocument,
  type EvidenceRefRuntime,
  type EvidenceRefSource,
} from '..';

const sourceRef: EvidenceRefSource = {
  kind: 'source',
  repo: 'https://github.com/example/shop',
  commit: '0123456789abcdef0123456789abcdef01234567',
  path: 'src/reset.ts',
  startLine: 12,
  endLine: 18,
  blobSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  extractor: 'tree-sitter@1.0.0',
  ruleId: 'auth.reset-handler',
};

const runtimeRef: EvidenceRefRuntime = {
  kind: 'runtime',
  runId: 'run-reset-submit-001',
  appBuildDigest: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  browser: 'chromium',
  browserVersion: '128.0.6613.84',
  url: 'https://app.arxic.test/reset',
  timestamp: '2026-08-04T12:34:56.000Z',
  accessibilitySnapshotSha256: '123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0',
  screenshotRef: 'artifacts/screenshots/reset-submit.png',
  traceRef: 'artifacts/traces/reset-submit.zip',
  networkRefs: ['artifacts/network/reset-submit.har'],
};

const documentRef: EvidenceRefDocument = {
  kind: 'document',
  artifactRef: 'docs/authentication.md',
  section: '4.2',
  sha256: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
};

const expectCode = (input: unknown, code: string) => {
  const result = validateEvidenceRef(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  }
};

describe('EvidenceRef contract', () => {
  it.each([
    ['source', sourceRef],
    ['runtime', runtimeRef],
    ['document', documentRef],
  ])('rejects a %s ref missing a required field with a stable diagnostic', (kind, ref) => {
    const input = { ...ref } as Record<string, unknown>;
    delete input[kind === 'source' ? 'extractor' : kind === 'runtime' ? 'runId' : 'artifactRef'];
    expectCode(input, ARXIC_EVIDENCE_REF_INVALID);
  });

  it('rejects an unknown kind with a stable diagnostic', () => {
    expectCode({ kind: 'other' }, ARXIC_EVIDENCE_REF_KIND_UNKNOWN);
  });

  it('rejects a missing kind with a stable diagnostic', () => {
    expectCode({}, ARXIC_EVIDENCE_REF_KIND_UNKNOWN);
  });

  it('rejects a source ref with a 39-character commit', () => {
    expectCode(
      { ...sourceRef, commit: '0123456789abcdef0123456789abcdef0123456' },
      ARXIC_EVIDENCE_REF_INVALID,
    );
  });

  it('rejects a source ref with a 63-character blob sha256', () => {
    expectCode(
      {
        ...sourceRef,
        blobSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde',
      },
      ARXIC_EVIDENCE_REF_INVALID,
    );
  });

  it('rejects a source ref whose startLine exceeds endLine', () => {
    expectCode({ ...sourceRef, startLine: 19, endLine: 18 }, ARXIC_EVIDENCE_REF_RANGE);
  });

  it('rejects a runtime ref with a malformed timestamp and non-uri url', () => {
    expectCode(
      { ...runtimeRef, timestamp: 'tomorrow', url: 'not a uri' },
      ARXIC_EVIDENCE_REF_INVALID,
    );
  });

  it('rejects an extra property', () => {
    expectCode({ ...documentRef, unknown: true }, ARXIC_EVIDENCE_REF_INVALID);
  });

  it('rejects a deliberately wrong ADR-shaped expected value missing extractor', () => {
    const { extractor, ...wrongExpectedValue } = sourceRef;
    expect(extractor).toBe('tree-sitter@1.0.0');
    expectCode(wrongExpectedValue, ARXIC_EVIDENCE_REF_INVALID);
  });

  it('accepts the ADR source variant literal', () => {
    expect(validateEvidenceRef(sourceRef)).toEqual({ ok: true, value: sourceRef });
  });

  it('accepts the ADR runtime variant literal and captures networkRefs while policy gating is deferred to #21', () => {
    expect(validateEvidenceRef(runtimeRef)).toEqual({ ok: true, value: runtimeRef });
  });

  it('accepts the ADR document variant literal', () => {
    expect(validateEvidenceRef(documentRef)).toEqual({ ok: true, value: documentRef });
  });
});
