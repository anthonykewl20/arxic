// #258 failure-evidence extraction tests: failed runs must retain a bounded,
// ANSI-stripped, redacted failure summary so users can learn WHY verification
// failed — and since #258 made failed-run output RETAINED (previously purged),
// redaction must be FAIL-CLOSED against non-persona secrets too (review P2 on
// PR #269): secret-bearing patterns are scrubbed; content that cannot be
// confidently sanitized is scrubbed AND flagged so the diagnostics record the
// gap. Retention is never silently dropped and secrets never silently retained.
import { describe, expect, it } from 'vitest';
import { extractRunFailureEvidence } from './failure-evidence';

const ANSI = '\u001B[32m';

describe('extractRunFailureEvidence', () => {
  it('extracts the assertion error lines from Playwright output', () => {
    const output = [
      'running 1 test using 1 worker',
      '',
      `  ${ANSI}[2mtests/workflow.spec.ts:${ANSI}[22m:5:11 › authentication.login`,
      '',
      `${ANSI}[31mError: ${ANSI}[39mexpect(page).toHaveURL failed`,
      'Expected string: "http://127.0.0.1:39321/dashboard"',
      'Received string: "http://127.0.0.1:39321/login?error=Invalid%20credentials"',
      '',
      '  14 |    await expect(page).toHaveURL(/dashboard/);',
      '',
      'This is ignored: some long stack line that should not dominate the summary because it is neither an error nor an expectation line',
    ].join('\n');

    const result = extractRunFailureEvidence(output, []);
    expect(result.evidence).toContain('expect(page).toHaveURL failed');
    expect(result.evidence).toContain('/dashboard');
    // URL-valued received strings are the honest #258 evidence (loopback
    // origin) and are retained — no regression from the redaction hardening.
    expect(result.evidence).toContain('/login?error=Invalid%20credentials');
    expect(result.evidence).not.toContain(ANSI);
    expect(result.evidence.length).toBeLessThanOrEqual(500);
    expect(result.redactionIncomplete).toBeUndefined();
  });

  it('redacts forbidden persona substrings from the retained evidence', () => {
    const output = [
      'Error: expect(locator).toHaveValue failed',
      `Received string: "http://127.0.0.1:1/x?a=hunter2-SecretPassword"`,
    ].join('\n');

    const result = extractRunFailureEvidence(output, ['hunter2-SecretPassword']);
    expect(result.evidence).not.toContain('hunter2-SecretPassword');
    expect(result.evidence).toContain('[REDACTED]');
    // The persona redaction was confident (known substring) — no flag needed.
    expect(result.redactionIncomplete).toBeUndefined();
  });

  it('scrubs secret-bearing query parameters (token) without dropping retention (P2)', () => {
    const output = [
      'Error: expect(page).toHaveURL failed',
      'Received string: "http://127.0.0.1:39321/reset?token=8f14e45fceea167a5a36dedd4bea2543"',
    ].join('\n');

    const result = extractRunFailureEvidence(output, []);
    expect(result.evidence).toContain('token=[REDACTED]');
    expect(result.evidence).not.toContain('8f14e45fceea167a5a36dedd4bea2543');
    // A confident pattern scrub is fully sanitized — no flag.
    expect(result.redactionIncomplete).toBeUndefined();
  });

  it('scrubs api key, session, and signature query parameters too', () => {
    const output = [
      'Error: expect(page).toHaveURL failed',
      'Received string: "http://127.0.0.1:1/cb?api_key=AKIA1234567890ABCDE&session=s3ss1on-value&sig=deadbeefdeadbeef"',
    ].join('\n');

    const result = extractRunFailureEvidence(output, []);
    expect(result.evidence).not.toContain('AKIA1234567890ABCDE');
    expect(result.evidence).not.toContain('s3ss1on-value');
    expect(result.evidence).not.toContain('deadbeefdeadbeef');
    expect(result.evidence.match(/=?\[REDACTED\]/gu)?.length).toBeGreaterThanOrEqual(3);
    expect(result.redactionIncomplete).toBeUndefined();
  });

  it('scrubs bearer values and authorization headers anywhere in the output', () => {
    const output = [
      'Error: request failed with 401 — headers: { Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sig.sig }',
    ].join('\n');

    const result = extractRunFailureEvidence(output, []);
    expect(result.evidence).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(result.evidence).toMatch(/authorization: \[REDACTED\]/iu);
  });

  it('scrubs user:pass@ URL userinfo (basic-auth-ish credential URLs)', () => {
    const output = [
      'Error: expect(page).toHaveURL failed',
      'Received string: "http://127.0.0.1:1/proxy?next=https://internal.example.test/alice:hunter2pass@host/x"',
    ].join('\n');

    const result = extractRunFailureEvidence(output, []);
    expect(result.evidence).not.toContain('alice:hunter2pass@');
    expect(result.evidence).toContain('[REDACTED]@host');
  });

  it('scrubs AND flags a wrong-password Received value that no persona substring covers (P2)', () => {
    // The campaign-class case: the app echoed the submitted (wrong) password
    // back into the assertion diff. The verifier does not know the password —
    // a non-URL received value cannot be confidently classified, so the value
    // is scrubbed and the retention is flagged as pattern-scrubbed only.
    const output = [
      'Error: expect(locator).toHaveValue failed',
      'Received string: "definitely-not-the-persona-password"',
    ].join('\n');

    const result = extractRunFailureEvidence(output, ['persona-known-password']);
    expect(result.evidence).not.toContain('definitely-not-the-persona-password');
    expect(result.evidence).toContain('Received string: "[REDACTED]"');
    expect(result.evidence).toContain('expect(locator).toHaveValue failed');
    expect(result.redactionIncomplete).toBe(true);
  });

  it('keeps a clean persona-only failure fully retained with no flag (no #258 regression)', () => {
    const output = [
      'Error: expect(page).toHaveURL failed',
      `Expected string: "http://127.0.0.1:39321/dashboard"`,
      `Received string: "http://127.0.0.1:39321/login?error=Invalid%20credentials"`,
    ].join('\n');

    const result = extractRunFailureEvidence(output, ['persona@example.test']);
    expect(result.evidence).toContain('toHaveURL failed');
    expect(result.evidence).toContain('/dashboard');
    expect(result.redactionIncomplete).toBeUndefined();
  });

  it('pattern-scrubs AND flags the fallback branch (unrecognized output cannot be confidently sanitized)', () => {
    const output = 'opaque crash dump: GET /x?token=abcdef0123456789 done, weird bytes follow';

    const result = extractRunFailureEvidence(output, []);
    expect(result.evidence).not.toContain('abcdef0123456789');
    expect(result.evidence).toContain('token=[REDACTED]');
    expect(result.redactionIncomplete).toBe(true);
  });

  it('returns a stable fallback when the output is empty', () => {
    const result = extractRunFailureEvidence('', []);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.length).toBeLessThanOrEqual(500);
  });

  it('bounds pathological output', () => {
    const result = extractRunFailureEvidence(
      Array.from({ length: 500 }, (_, index) => `Error: failure number ${index}`).join('\n'),
      [],
    );
    expect(result.evidence.length).toBeLessThanOrEqual(500);
    expect(result.evidence).toContain('…');
  });
});
