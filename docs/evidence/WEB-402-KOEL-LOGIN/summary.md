# WEB-402-KOEL-LOGIN — real browser sign-in into a third-party hash-routed SPA

Refs [#402](https://github.com/anthonykewl20/arxic/issues/402) and
[#538](https://github.com/anthonykewl20/arxic/issues/538). This proves the
project-configured persona login surface of the visual engine against a real
dockerized koel (local-only rehearsal clone `koel-php83:rehearsal`, per-run
fresh sqlite, ephemeral host port). It does **not** prove provider account
logins (owner-blocked, recorded on #402 and #538) and it is not the human
release inspection gate.

## What the engine proof covers

| Probe | Result |
| --- | --- |
| Wrong-password run (sad path first) | `blocked`, finding `login-failed` on `/`, summary retains the observed engine error ("Sign-in failed: Still on the login page after submitting; check the secrets and labels"), exactly one bounded sign-in attempt (`blocked-run/timeline.json` has a single `sign-in-form` with `result: "failed"`). No credential material in any retained file. |
| Real sign-in + authenticated capture | koel booted via `koel:init --no-interaction` (seeds the upstream first-admin account), credentials supplied only through `ARXIC_SECRET_*` server variables. The run completed `observed` with one `authenticated: true` capture (`needs-baseline`) of the koel shell at 800×600. |
| Live-DOM surface resolution | `run/timeline.json` records `fields by type/type`: koel has no `<label>` elements, so the engine resolved the email field through its structural fallback (`input[type="email"]`, populated via Vue attribute fallthrough) and the password field through `input[type="password"]`. The submit button is the known koel/#383-class blind spot — `getByRole("button", { name: "Log In" })` matches nothing — so the engine's structural submit fallback performed the click. |
| Privacy masking | `checkpoint-1.png.privacy.json`: `additionalMasks` includes the declared current-user identity mask `[data-testid="profile-dropdown-trigger"]`, `authenticated: true`, `humanInspection: "required-before-external-sharing"`, `rawTraceRetained: false`. |
| Sanitization | `timeline.sanitization.json` in both runs records the allow-listed-field method, `rawTraceRetained: false`. No webm/zip/storage/session files exist in the run directory; timeline and JSON evidence contain neither the password nor the admin email. |

## Engine defects this slice exposed and fixed (red-first)

1. **Undeclarable surface**: koel's label-less login form could not be declared
   at all — project save rejected the configuration (`Unknown or malformed
   login setting`). `VisualLogin` now accepts optional `emailPlaceholder` /
   `passwordPlaceholder` declarations (non-secret, same class as labels), and
   field resolution gained a bounded placeholder strategy after labels and
   input types miss.
2. **Pathname-only post-submit wait**: koel is hash-routed; after a successful
   sign-in the pathname never leaves `/`, so the engine reported failure even
   with valid credentials. The wait now also accepts the bounded disappearance
   of the login form itself as the success signal; a wrong password still
   classifies as `login-failed` because the form stays visible.
3. **Capture racing SPA mounts**: required privacy masks are declarations
   about the captured surface, but the capture fired before koel mounted the
   authenticated shell, refusing every capture with "Required privacy mask did
   not match". The engine now gives declared masks a bounded (15 s) mount
   window in the readiness phase; a mask that never appears still refuses the
   capture with its honest blocked finding.

All three were observed red against the running app before the fix; the
Next.js reference-app login suites (`visual-auth`, `visual-matrix-auth`),
persona-variant suites and config-omission suites pass unchanged after the
fixes.

`blocked-network-requests` (count 3) in the observed run is the engine's
outbound request guard doing its job (koel probes external services); it is an
informational finding on this capture, not a login defect.

## Honest boundaries

- The rehearsal koel clone, image and `BOOT-PROCEDURES.md` are LOCAL-ONLY
  (never committed); CI skips this suite unless
  `ARXIC_KOEL_LOGIN_REQUIRED=1` promotes missing prerequisites to a hard
  failure. The in-CI login proof remains the Next.js reference-app suites.
- The captured PNG is **agent-inspected only**; independent human visual
  inspection remains owed before any release publication
  (`inspection.json`, `humanInspection: required-before-external-sharing`).
- koel credentials here are the upstream project's public first-admin seed
  constants exercised through the engine's secret-reference mechanism; no Arxic
  credential is involved.
- Provider account-login flows remain owner-blocked (interactive OAuth on
  owner accounts, no sanctioned tenants, standing owner-owned-login decision).
