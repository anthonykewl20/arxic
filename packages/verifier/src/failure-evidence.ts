// #258: failed verification runs retain a bounded, redacted failure summary.
// The Playwright CLI output carries the real assertion text (expected vs
// received); without this extraction the verifier discarded it and users could
// not learn why a run failed.
//
// FAIL-CLOSED REDACTION (review P2 on PR #269): #258 changed failed-run output
// from purged to RETAINED, so non-persona secrets (reset/one-time tokens in
// URLs, API keys, a wrong password echoed into an assertion diff, bearer /
// authorization header values) could otherwise persist into diagnostics and
// committed evidence. Posture: scrub-what-you-can + flag-what-you-can't —
//   1. persona forbidden substrings are scrubbed (confident);
//   2. secret-bearing patterns (token/session/api-key/secret/password/key/sig
//      query params, bearer values, authorization headers, user:pass@ URL
//      userinfo) are scrubbed (confident);
//   3. non-URL `Received …: "<value>"` strings are arbitrary app/page content
//      that cannot be confidently classified — the value is scrubbed AND the
//      retention is FLAGGED (`redactionIncomplete`) so the caller surfaces an
//      ARXIC-VERIFY-REDACTION-FAILED signal;
//   4. the no-recognizable-line fallback branch is raw output — pattern-scrubbed
//      and ALWAYS flagged.
// Retention is never silently dropped (#258 requires honest evidence) and
// secrets are never silently retained.
// ANSI control bytes are the exact untrusted terminal delimiters stripped from
// retained failure evidence (same sanitizer family as the exploration driver).
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/gu;
const FAILURE_LINE = /(?:Error:|expect\(|Expected|Received|at .*(?:spec|test)\.ts|→)/u;
const MAX_LINES = 5;
const MAX_CHARS = 500;
const REDACTION_PLACEHOLDER = '[REDACTED]';

// Confident secret-bearing patterns — scrubbed wherever they appear.
// Query parameters whose VALUE is a credential (token=, session=, api_key=,
// api-key=, apikey=, secret=, password=, passwd=, key=, sig=, signature=,
// access_token=). The parameter NAME stays (honest evidence of the shape).
const SECRET_QUERY_PARAM =
  /([?&](?:access[_-]?token|api[_-]?key|key|passwd|password|secret|session|sig|signature|token)=)(?:[^&\s"'|]+|%[0-9A-Fa-f]{2})+/giu;
// `Bearer <credentials>` values (header dumps, request logs).
const BEARER_CREDENTIALS = /\b(bearer\s+)[A-Za-z0-9._~+/=-]+/giu;
// Authorization header values in any rendering (`Authorization: <anything>`).
const AUTHORIZATION_HEADER = /\b(authorization\s*[:=]\s*)\S+/giu;
// Basic-auth-ish credential userinfo in or around URLs — `user:pass@` may
// appear scheme-adjacent (`https://user:pass@host`) or embedded mid-URL
// (`?next=https://host/user:pass@host`), so the pattern matches any
// `word:word@` pair; over-redaction is the fail-closed direction.
const URL_USERINFO = /[A-Za-z0-9._~%-]+:[A-Za-z0-9._~%!$&'()*+,;=-]+@/gu;
// Untrusted received values: `Received string: "<v>"` / `Received: "<v>"`
// where <v> is NOT an absolute http(s) URL. The value is arbitrary page/app
// content (may echo a wrong password) — scrub the value and flag retention.
const RECEIVED_NON_URL_VALUE = /(received(?:\s+string)?\s*:\s*")(?!https?:\/\/[^"]*)[^"]*(")/giu;

export type RunFailureEvidence = Readonly<{
  evidence: string;
  /** True when the retained evidence is pattern-scrubbed only and parts of the
   * source output could not be confidently classified as secret-free. */
  redactionIncomplete?: true;
}>;

export function extractRunFailureEvidence(
  output: string,
  forbiddenSubstrings: readonly string[],
): RunFailureEvidence {
  const scrubPatterns = (value: string): string =>
    value
      .replace(SECRET_QUERY_PARAM, `$1${REDACTION_PLACEHOLDER}`)
      .replace(BEARER_CREDENTIALS, `$1${REDACTION_PLACEHOLDER}`)
      .replace(AUTHORIZATION_HEADER, `$1${REDACTION_PLACEHOLDER}`)
      .replace(URL_USERINFO, `${REDACTION_PLACEHOLDER}@`);
  const redactPersona = (value: string): string => {
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
    // Fallback: raw output with no recognizable failure line — cannot be
    // confidently sanitized, so it is pattern-scrubbed and ALWAYS flagged.
    const fallback = output.replace(ANSI_ESCAPE, '').trim().slice(0, MAX_CHARS);
    const evidence = redactPersona(
      scrubPatterns(
        fallback.length > 0
          ? fallback
          : 'Playwright reported a test failure without a recognizable error line',
      ),
    );
    return { evidence: evidence.slice(0, MAX_CHARS), redactionIncomplete: true };
  }
  // Untrusted received values that are not URLs are scrubbed and flag the
  // retention; everything else is confidently scrubbed by pattern/persona.
  let untrustedValueScrubbed = false;
  const scrubbedSelection = selected.map((line) => {
    if (!RECEIVED_NON_URL_VALUE.test(line)) return line;
    untrustedValueScrubbed = true;
    RECEIVED_NON_URL_VALUE.lastIndex = 0;
    return line.replace(RECEIVED_NON_URL_VALUE, `$1${REDACTION_PLACEHOLDER}$2`);
  });
  RECEIVED_NON_URL_VALUE.lastIndex = 0;
  let evidence = redactPersona(scrubPatterns(scrubbedSelection.join(' | ')));
  if (lines.length > MAX_LINES || evidence.length > MAX_CHARS) {
    evidence = `${evidence.slice(0, MAX_CHARS - 1)}…`;
  }
  return {
    evidence: evidence.slice(0, MAX_CHARS),
    ...(untrustedValueScrubbed ? { redactionIncomplete: true as const } : {}),
  };
}
