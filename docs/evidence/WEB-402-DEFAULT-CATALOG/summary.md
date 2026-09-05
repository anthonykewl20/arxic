# Provider-owned catalogs for server defaults — refs #402

A configured server-default HTTP connection now discovers provider-owned model
IDs through the same bounded metadata service as named profiles. Project fields
and Models & accounts share this catalog. Refresh replaces changed suggestions
without overwriting custom input, failures retain visibly stale IDs and fetch
time, and credential changes invalidate the cached account catalog. Five-minute
refresh includes the default connection. Opaque host/gateway defaults explain
that discovery requires a named profile; no model list is invented.

## Reproduced failures

1. A default catalog request with an explicit HTTP endpoint was rejected:
   `Choose a named provider to discover its models`.
2. The actual project dialog disabled Refresh for the configured default:
   `expected true to be false`.
3. Models & accounts omitted that connection entirely: `expected 0 to be 1`.

Screenshot inspection also exposed the default HTTP connection mislabeled as
managed externally. A new API-billing label assertion failed and now passes;
public billing metadata accepts only the supported mode values.

All assertions pass unchanged after correction. The provider screen keeps
named-profile ordering and adds the configured default without reserving a
profile ID. The default refresh endpoint has no provider-ID path segment.

## Live provider probe

[Two live reads](live-catalog.json) through the default catalog path at commit
`e3ac87abd76b61ea3640412df4d967ba16cc1412` each returned 418 IDs from
OpenRouter's public `/api/v1/models` endpoint, with matching ID hashes. These are
metadata-only requests: no credentials used and no inference performed. Model
availability does not prove entitlement or successful paid execution. Execution
pricing/entitlement policies remain unchanged.

## Committed browser validation

All **48 web tests in 13 files pass (233.93 s)** at implementation `6e4d1b1`,
rebased onto merged PR #417. The billing-metadata follow-up at `e3ac87a` passes
all 11 catalog/provider/browser tests in three files (7.00 s). Root/package type
checks, lint and license pass; web type checks and lint were repeated after the
metadata change. Full format after final docs: `All matched files use Prettier code style!`.
Required final-head CI and merge remain pending; no release completion is claimed.

| User-level behavior | Result | Proof |
| --- | --- | --- |
| Named provider refresh, changed IDs, preserved search, visibly stale catalog and mobile layout | PASS | [Browser timeline](browser/timeline.json), [provenance](browser/timeline.sanitization.json), images 01–03 |
| Default provider errors/changed IDs/custom input, stale fetch time and Models & accounts management with correct billing label | PASS | Same timeline/provenance, images 04–06 |
| Two metadata-only requests to OpenRouter's actual public catalog | PASS | [Live probe](live-catalog.json) |

All six named PNGs were agent-inspected and hash-checked against adjacent privacy
records; the allow-listed timeline hash also matches: [inspection manifest](inspection.json).
Screenshots use capture-time masking and reference data. No raw trace ZIP or
credential cache is retained. No outcome matcher was widened and no test skipped.

The changing/erroring HTTP provider is a system-boundary stub; the Arxic server,
API/session checks and Chromium browser are real. The full web suite also runs
the actual Next/Express reference apps, compiler/verifier and Mailpit. Human
release screenshot inspection is not claimed. Broader #402 campaign, runtime,
account-login, authenticated visual-state and server-release gaps remain open.
