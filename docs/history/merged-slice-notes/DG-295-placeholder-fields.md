# DG-295-placeholder-fields — staged doc updates (charter §10.2)

Issue: #295 · PR: #TBD · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #295 | [DG-295] replayPersona placeholder-field addressing for vanilla SPA login forms (unblocks DG-12 criterion 3) | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-24 | **#295 (DG-295) placeholder-field addressing DONE.** FINDING F-D on #256 (both ratified DG-12 targets ship placeholder-only login forms; the frozen label-only contract addressed zero elements on directus AND koel) remediated additively: field resolution is label-first with a placeholder fallback, the submit resolves by role-name then button text (a `<label>`-wrapped submit loses its accessible name in Chromium — minimal repro in the PR), SPA hydration is awaited before form scoping, and hash-router/fetch-based logins (koel) are detected via the declared login field leaving the DOM. Proven LIVE against both booted ratified targets (directus LOGIN OK, koel LOGIN OK) plus 23 verifier tests incl. label-precedence decoy, mixed forms, and neither-resolves sad paths. DG-12 criterion 3 is unblocked. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- DG-295 replay-persona field addressing (#295): `fixtures.replayPersona` login fields and submit now resolve label-first with a placeholder/text fallback — vanilla SPA targets (directus, koel) ship placeholder-only login forms and label-wrapped submit buttons that carry no accessible name, which the label-only resolution could not address (both DG-12 exit targets were LOGIN-BLOCKED). SPA hydration is awaited before scoping, and hash-router/fetch-based logins are detected by the declared login field leaving the DOM when the URL never changes. All frozen #288 diagnostics, refusals, and redaction behavior unchanged.
```

## 4. VERSION bump required?

no — additive locator resolution inside the frozen declaration semantics; no config surface, key, or diagnostic code changed.

## 5. Evidence pointers

- Red→green: `packages/verifier/src/replay-persona.test.ts` — placeholder-only, mixed, label-precedence (decoy placeholder form must NOT win), and neither-resolves (LOGIN-BLOCKED unchanged) — 23/23.
- LIVE real-world proof (the exact finding that motivated the issue): `loginReplayPersona` driven against the booted ratified targets at their pins — directus @ cb846b6 (`/admin/login`, placeholders, hydrated SPA): **LOGIN OK**; koel @ dfec91ff (`/`, placeholders, label-wrapped submit, hash-router fetch login): **LOGIN OK**. Before the fix both classified `ARXIC-VERIFY-FIXTURE-LOGIN-BLOCKED` with form scoping resolving 0.
- Regression: packages/verifier full suite + CLI config/local-executor/domain-literal suites — 135/135.
- Root-cause minimal repro (in PR description): `<label><button>Log In</button></label>` loses the button's accessible name in Chromium (getByRole name → 0), while the plain form matches — hence the submit text fallback.

## 6. Sad paths proved

| Trigger                                                                       | Expected disposition                           | Test                    |
| ----------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------- |
| Placeholder-only form                                                         | login completes via placeholder fallback       | new test 1              |
| Label AND placeholder both match (decoy hidden placeholder form first in DOM) | LABEL wins; decoy untouched                    | new test 2              |
| Mixed form (one labelled, one placeholder-only)                               | both fields resolve; login completes           | new test 3              |
| Neither label nor placeholder resolves                                        | `ARXIC-VERIFY-FIXTURE-LOGIN-BLOCKED` unchanged | new test 4              |
| `<label>`-wrapped submit (koel shape)                                         | submit resolves by text; login completes       | tests 1+3 (form shapes) |
| SPA not yet hydrated at load                                                  | submit-attach wait scopes after render         | live directus proof     |

## 7. What was NOT done (reporting discipline)

- The `waitForURL` fragment comparison has a known koel quirk (documented in code): logged-out koel still initializes at `#/home`, so the URL never distinguishes login states there — the DOM-detachment signal is what carries koel, and the fragment check remains for SPAs that DO move it.
- No worker-lane change (same as #288: the campaign lane is local).
- The live-target proof ran against this session's booted containers (directus-rehearsal, koel-rehearsal); containers were stopped after the probe — the campaign operator reboots them per DESIGN §4.
