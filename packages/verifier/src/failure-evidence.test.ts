// #258 failure-evidence extraction tests (red-first): failed runs must retain a
// bounded, ANSI-stripped, persona-redacted failure summary so users can learn
// WHY verification failed — without leaking secrets into diagnostics.
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

    const evidence = extractRunFailureEvidence(output, []);
    expect(evidence).toContain('expect(page).toHaveURL failed');
    expect(evidence).toContain('/dashboard');
    expect(evidence).not.toContain(ANSI);
    expect(evidence.length).toBeLessThanOrEqual(500);
  });

  it('redacts forbidden persona substrings from the retained evidence', () => {
    const output = [
      'Error: expect(locator).toHaveValue failed',
      `Received: "hunter2-SecretPassword"`,
    ].join('\n');

    const evidence = extractRunFailureEvidence(output, ['hunter2-SecretPassword']);
    expect(evidence).not.toContain('hunter2-SecretPassword');
    expect(evidence).toContain('[REDACTED]');
  });

  it('returns a stable fallback when no recognizable failure line exists', () => {
    const evidence = extractRunFailureEvidence('totally opaque output\n', []);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.length).toBeLessThanOrEqual(500);
  });

  it('bounds pathological output', () => {
    const evidence = extractRunFailureEvidence(
      Array.from({ length: 500 }, (_, index) => `Error: failure number ${index}`).join('\n'),
      [],
    );
    expect(evidence.length).toBeLessThanOrEqual(500);
    expect(evidence).toContain('…');
  });
});
