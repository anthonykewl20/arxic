// #258: failed verification runs retain a bounded, redacted failure summary.
// The Playwright CLI output carries the real assertion text (expected vs
// received); without this extraction the verifier discarded it and users could
// not learn why a run failed. Redaction is fail-closed against persona
// forbidden substrings so the audit diagnostics never carry secrets.
// ANSI control bytes are the exact untrusted terminal delimiters stripped from
// retained failure evidence (same sanitizer family as the exploration driver).
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/gu;
const FAILURE_LINE = /(?:Error:|expect\(|Expected|Received|at .*(?:spec|test)\.ts|→)/u;
const MAX_LINES = 5;
const MAX_CHARS = 500;
const REDACTION_PLACEHOLDER = '[REDACTED]';

export function extractRunFailureEvidence(
  output: string,
  forbiddenSubstrings: readonly string[],
): string {
  const redact = (value: string): string => {
    let redacted = value;
    for (const substring of forbiddenSubstrings) {
      if (substring.length > 0) redacted = redacted.replaceAll(substring, REDACTION_PLACEHOLDER);
    }
    return redacted;
  };
  const lines = output
    .replace(ANSI_ESCAPE, '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && FAILURE_LINE.test(line));
  const selected = lines.slice(0, MAX_LINES);
  if (selected.length === 0) {
    const fallback = output.replace(ANSI_ESCAPE, '').trim().slice(0, MAX_CHARS);
    return redact(
      fallback.length > 0
        ? fallback
        : 'Playwright reported a test failure without a recognizable error line',
    );
  }
  let evidence = redact(selected.join(' | '));
  if (lines.length > MAX_LINES || evidence.length > MAX_CHARS) {
    evidence = `${evidence.slice(0, MAX_CHARS - 1)}…`;
  }
  return evidence.slice(0, MAX_CHARS);
}
