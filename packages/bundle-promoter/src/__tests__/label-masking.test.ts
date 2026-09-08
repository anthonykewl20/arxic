import { describe, expect, it } from 'vitest';
import {
  PERSIST_REDACTED_LABEL,
  PERSIST_REDACTION_PLACEHOLDER,
  redactAndScanPersistedPayload,
} from '../redaction-gate';

const options = { knownValues: [], includePatternClasses: true };

describe('redactAndScanPersistedPayload label UI-copy masking (#474)', () => {
  it('masks pattern-class matches inside label values whole and reports the masked classes', () => {
    const result = redactAndScanPersistedPayload(
      '{"controls":[{"label":"you@example.com"}],"echo":"ok"}',
      options,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.text).toBe(`{"controls":[{"label":"${PERSIST_REDACTED_LABEL}"}],"echo":"ok"}`);
    expect(result.maskedLabelClasses).toEqual(['email-address']);
  });

  it('masks any pattern class inside labels, not only emails', () => {
    const result = redactAndScanPersistedPayload(
      '{"label":"session token: abc123def456ghi789jkl"}',
      options,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.text).not.toContain('abc123def456ghi789jkl');
    expect(result.maskedLabelClasses).toEqual(['session-token']);
  });

  it('sad path: the same classes outside label values still produce refusing diagnostics', () => {
    const email = redactAndScanPersistedPayload('{"echo":"user@company.example.org"}', options);
    expect(email.diagnostics.map(({ subject }) => subject)).toEqual(['email-address']);
    expect(email.maskedLabelClasses).toBeUndefined();

    const token = redactAndScanPersistedPayload(
      '{"echo":"session token: abc123def456ghi789jkl"}',
      options,
    );
    expect(token.diagnostics.map(({ subject }) => subject)).toEqual(['session-token']);
  });

  it('keeps known-value redaction ahead of label masking', () => {
    const persona = 'replay.persona@arxic.invalid';
    const result = redactAndScanPersistedPayload('{"label":"replay.persona@arxic.invalid"}', {
      knownValues: [persona],
      includePatternClasses: true,
    });
    expect(result.text).toContain(PERSIST_REDACTION_PLACEHOLDER);
    expect(result.text).not.toContain(PERSIST_REDACTED_LABEL);
    expect(result.diagnostics).toEqual([]);
  });

  it('leaves label values without pattern hits untouched', () => {
    const result = redactAndScanPersistedPayload(
      '{"submit":{"label":"Login"},"field":{"label":"Work email"}}',
      options,
    );
    expect(result.text).toBe('{"submit":{"label":"Login"},"field":{"label":"Work email"}}');
    expect(result.maskedLabelClasses).toBeUndefined();
    expect(result.diagnostics).toEqual([]);
  });
});
