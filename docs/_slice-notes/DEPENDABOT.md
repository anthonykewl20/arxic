# DEPENDABOT — staged doc updates (charter §10.2)

Issue: #114 · PR: pending · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| #114 | [DEPENDABOT] Remediate Nodemailer/PostCSS/sharp/uuid Dependabot alerts | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-08-10 | **#114 (DEPENDABOT) Dependabot remediation DONE.** Upgraded both fixture apps to Nodemailer 9.0.5, the reference app to Next 16.3.0 (PostCSS 8.5.23 and sharp 0.35.3), and `@arxic/environment` to Testcontainers 12.1.0/Dockerode 5 (uuid absent); migrated Next lint to ESLint flat config and middleware to proxy, preserved reset isolation under Turbopack, exercised sharp through real image resizing, and started real Mailpit through Testcontainers with random mapped ports. GitHub alert remeasurement remains post-merge. Next: #109. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Security`

```text
- DEPENDABOT dependency remediation (#114): upgraded Nodemailer, Next.js, and Testcontainers to patched owners so PostCSS and sharp resolve safely and uuid leaves the graph; migrated the reference fixture to Next 16's ESLint/proxy conventions, and added real Docker Mailpit plus real Next image-optimizer execution proof.
```

## 4. `VERSION` bump required?

Yes → recommend the next pre-1.0 patch version because patched dependency behavior is user-observable security/fix work. The integrator must choose and apply the exact `VERSION` plus root `package.json` version together; this worktree intentionally changes neither.

## 5. Evidence pointers

- Published targets: npm returned Nodemailer 9.0.1 (and 9.0.5), Next 16.3.0, Testcontainers 12.1.0, and Node 22.22.0 (latest 22.x observed: 22.23.2).
- Migration sources: [Next 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16), [Next ESLint setup](https://nextjs.org/docs/app/api-reference/config/eslint), [ESLint flat configuration](https://eslint.org/docs/latest/use/configure/configuration-files), [Nodemailer changelog](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md), and [Testcontainers 12 release](https://github.com/testcontainers/testcontainers-node/releases/tag/v12.0.0).
- Resolution proof: `nodemailer@9.0.5` from both fixture apps; `postcss@8.5.23` from Next 16.3.0 plus `8.5.25` from Vite; `sharp@0.35.3` from Next 16.3.0; `pnpm why uuid` produced no output.
- Real-world Testcontainers proof: `packages/fixture-mailpit/src/testcontainers-smoke.test.ts` starts `axllent/mailpit:v1.30.0` with Testcontainers 12.1.0 on random mapped SMTP/API ports while both Mailpit environment variables are unset, probes `/api/v1/info`, and stops the container.
- Real-world sharp proof: `test-fixtures/reference-auth-app/__tests__/boot.test.ts` requests a unique 64px PNG through Next's `/_next/image`, asserts a cache miss and a real 32px PNG result; Next 16.3.0 upstream `image-optimizer.ts` calls `getSharp()` and `sharp(...).resize(...).toBuffer()` on this non-bypass PNG path.
- Nodemailer proof: both real fixture-app suites delivered reset mail to real Mailpit after the 9.0.5 resolution. Nodemailer 9's documented breaking change concerns TLS validation for fetched remote content, which these plain local SMTP transports do not use, so no mail API code changed.
- Testcontainers migration: `MailpitContainer` already selected explicit listening-port and HTTP wait strategies, preserving the Testcontainers 11 behavior that v12 changed when no strategy is supplied. The v12.1.0 source retains the used `GenericContainer`, mapped-port, and stop APIs; Dockerode remains and is upgraded to 5.0.0.
- Gates: root test 763 passing ☑ · fixture apps 4 passing ☑ · isolated Mailpit 1 passing ☑ · typecheck ☑ · recursive typecheck ☑ · lint ☑ · format check ☑ · license gate (782 total, 0 rejected) ☑ · SBOM generation ☑ · command guard ☑.
- GitHub alerts: remeasure after merge; zero alerts is not claimed by this slice note.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                            | Expected disposition                                                                                    | Test                                                                                                   |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Configured/shared Mailpit endpoints accidentally reach the isolated migration smoke                | blocked by an explicit unset-environment assertion                                                      | `packages/fixture-mailpit/src/testcontainers-smoke.test.ts`                                            |
| Testcontainers maps either service to its fixed container port                                     | contradicted; the random-port requirement was not met                                                   | `packages/fixture-mailpit/src/testcontainers-smoke.test.ts`                                            |
| Next image optimizer bypasses or fails to resize the PNG                                           | contradicted by source width 64 versus optimized width 32 and changed bytes                             | `test-fixtures/reference-auth-app/__tests__/boot.test.ts`                                              |
| Next 16 Turbopack duplicates the in-memory rate-limit module and reset cannot clear login attempts | contradicted until counters are process-global; clean reset/reseed must restore original-password login | `test-fixtures/reference-auth-app/__tests__/boot.test.ts` plus auth-domain/M0/report real-world suites |
| Nodemailer 9 cannot deliver through the fixture's SMTP API                                         | contradicted by missing reset message                                                                   | both fixture apps' `__tests__/boot.test.ts` suites against real Mailpit                                |

Post-merge work: remeasure GitHub Dependabot alerts and run current-head CI. Until current-head CI passes, local-green behavior remains unverified.
