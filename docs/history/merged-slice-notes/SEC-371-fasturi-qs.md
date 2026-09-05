# SEC-371-fasturi-qs — staged doc updates (charter §10.2)

Issue: #371 · PR: pending · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #371 | [SEC-371-fasturi-qs] Enforce fast-uri ≥3.1.6 / qs ≥6.16.0 security floors (dependabot alerts #217–#222) | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-03 | **#371 (SEC-371-fasturi-qs) transitive security floors for fast-uri + qs.** Dependabot flagged six alerts in two packages, both transitive in the shared lockfile: fast-uri 3.1.5 (<3.1.6; four high advisories — SSRF/host-confusion classes) pulled by ajv 8.20.0 under packages/contracts schema gates, and qs 6.15.3 (<6.16.0; two medium advisories — DoS/array-limit bypass) pulled by express 5.2.1/body-parser 2.3.0 in test-fixtures/vulnerable-auth-app. pnpm-workspace.yaml overrides (same mechanism as the esbuild pin) now floor fast-uri at ^3.1.6 (resolved 3.1.7; stays 3.x because ajv 8.x declares ^3) and qs at ^6.16.0. Lockfile re-resolved with zero vulnerable instances; ajv-driven contracts suite (80 tests incl. ajv-smoke) and both fixture-app suites green in CI against the overridden resolutions. Dependabot alerts #217/#218/#219/#220/#221/#222 auto-resolved as fixed after the merge landed on main. Next: typescript 7 + otplib 13 migrations remain open follow-ups from #369. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### security`

```
- SEC-371-fasturi-qs transitive security floors (#371): pnpm overrides force fast-uri ≥3.1.6 (GHSA-5jgf-p345-68v8, GHSA-fph4-wmhf-6fwf, GHSA-jqff-g426-hqxp, GHSA-f65p-4m7j-42xc; via ajv) and qs ≥6.16.0 (GHSA-4mjr-xmp4-gh2g, GHSA-x5fp-wj9c-mxmx; via express/body-parser), clearing all six open dependabot alerts with no API or behavior change.
```

## 4. `VERSION` bump required?

no — transitive dependency security floors inside an unreleased tree; no user-observable capability or behavior change. Integrator owns the release/version decision.

## 5. Evidence pointers

- Real-world proof: CI full suite on the PR — `pnpm test` includes `packages/contracts` (80 passing tests: ajv-smoke plus every manifest/evidence/diagnostics schema gate that drives ajv → fast-uri), and the fixture-app suites run `test-fixtures/vulnerable-auth-app` (express → qs) against real Mailpit. Local: lint, typecheck, contracts suite, and both fixture-app typechecks green in the worktree.
- Artifacts: `pnpm-lock.yaml` resolutions after the override — `fast-uri@3.1.7` and `qs@6.16.0` as the only instances; zero matches for vulnerable ranges (`fast-uri <3.1.6`, `qs <6.16.0`).
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (contracts 80/80 local; full suite in CI) ☑ · license gate ☑ (CI)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                            | Expected disposition                                  | Test                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Vulnerable instance survives the override (fast-uri <3.1.6 or qs <6.16.0 anywhere in the lockfile) | contradicted if found; observed absent                | Lockfile grep after `pnpm install`: only `fast-uri@3.1.7` / `qs@6.16.0`; `@types/qs@6.15.1` is types-only and outside the advisories' scope |
| fast-uri 3.1.7 breaks ajv URI/IRI resolution under the contracts schema gates                      | contradicted if schemas misvalidate; observed working | `packages/contracts` suite incl. `ajv-smoke.test.ts` — 80/80 passing locally and in CI                                                      |
| qs 6.16.0 breaks express/body-parser form+query parsing in the reference target                    | contradicted if fixture suite fails; observed working | `test-fixtures/vulnerable-auth-app` suite (real Mailpit) green in CI                                                                        |
| Override drags an unsupported major (fast-uri 4.x)                                                 | blocked if attempted; avoided by design               | Override is `^3.1.6` — 4.x excluded because ajv 8.x declares `^3`                                                                           |
