# FASTIFY-AUTH-560 — staged doc updates (charter §10.2)

Issue: #560 · PR: _this PR_ · Disposition: observed (fastify-auth rulepack shipped and proven against a real Fastify fixture app; register C1's framework-breadth gap narrows by one framework)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #560 | [FASTIFY-AUTH-560] fastify-auth rulepack (register C1 breadth) | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-10 | **#560 (FASTIFY-AUTH-560) fastify-auth rulepack DONE.** Fourth rulepack (fastify >=4 <6): six ast-grep rules (route, jwt-sign→token-create, jwt-verify→token-verify, session-cookie, password-hash scrypt/compare/bcrypt, auth-guard body-reads + jwtVerify), `fastify` in FRAMEWORK_PACKAGES, interpret-side fastify route→inline-handler→guard chains, a real fixture app (`test-fixtures/reference-fastify-auth-app`, real fastify ^5.4/@fastify/jwt ^9/@fastify/cookie ^11 + scrypt source), and range enforcement (^5.4.0 accepted with lockfile-grade tiering; ^6.0.0 rejected blocked, zero matches — the Next-16 lesson applied to fastify). Red-first: pack-existence assertion observed failing (1/25) before the pack landed; green 31/31 rule-fixtures incl. real-fixture positives/negatives; real-world chain proof via the real sg engine (login chain connected, determinism canonicalJson-identical, evidence blobs sha-verified); adapter package suite 97/97. Register C1 updated (observed). **M0 gates green.** Next: #560 closed; remaining C1 breadth = more frameworks / semantic synthesis. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- FASTIFY-AUTH-560 fastify-auth rulepack (refs #560): framework discovery breadth
  gains Fastify (`>=4 <6`) — six ast-grep rules covering routes, @fastify/jwt
  sign/verify, @fastify/cookie session mutations, scrypt/bcrypt password hashing
  and credential/token guards; framework-gate acceptance/rejection tiering and
  interpret-side route→handler→guard chains mirror the express pack. Proven
  against a real Fastify fixture app with the real sg engine (red-first, range
  rejection for ^6.0.0, chain determinism and evidence hash-binding asserted).
```

## 4. `VERSION` bump required?

no — the adapter/rulepacks are discovery tooling consumed by the agent pipeline, not user-observable product behavior in the web app release lane.

## 5. Evidence pointers

- Red-first: `packages/ast-grep-adapter/src/__tests__/rule-fixtures.test.ts` "ships the six auth categories…" — observed failing 1/25 at commit 7e254b7a before the pack existed; green 31/31 after.
- Real-world proof: `packages/ast-grep-adapter/src/__tests__/real-world.test.ts` "connects route to handler to guard for reference-fastify-auth-app" — the real sg CLI scans the real `test-fixtures/reference-fastify-auth-app` source; login chain `status: connected`, `truthState: hypothesized`, evidence ≥3 with ruleIds {fastify-route, fastify-auth-guard}, canonicalJson determinism across two scans, per-match evidence blobs sha-256-verified.
- Range enforcement: `framework-gate.test.ts` "fastify-auth gate…" — manifest `^5.4.0` accepted (`ARXIC_RULES_FRAMEWORK_ACCEPTED`, observed, matches > 0); `^6.0.0` rejected (`ARXIC_RULES_FRAMEWORK_REJECTED`, blocked, zero matches).
- Fixture app is real: fastify ^5.4.0, @fastify/jwt ^9, @fastify/cookie ^11, node:crypto scrypt + timingSafeEqual, register/login/logout/me routes; `tsc --noEmit` exits 0 on the fixture itself.
- Gates: typecheck:packages ☑ · lint ☑ · format ☑ (full repo, after this note) · test (adapter 97/97; rule-fixtures 31/31; framework-gate 24/24; real-world 3/3) ☑

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                            | Expected disposition                                    | Test                                                            |
| -------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| Framework named but pack directory missing         | fail-fast before any crawl                              | framework-gate cell 3b (existing)                               |
| Manifest range outside pack range (fastify ^6.0.0) | `ARXIC-RULES-FRAMEWORK-REJECTED`, blocked, zero matches | framework-gate fastify gate test (observed)                     |
| Manifest range fully inside `>=4 <6`               | `ARXIC-RULES-FRAMEWORK-ACCEPTED`, observed, rules run   | framework-gate fastify gate test (observed)                     |
| Route without handler+guard evidence               | chain `incomplete`, feature not claimed, diagnostic     | adapter suite "does not claim a conventional route…" (existing) |
| Rule fixture matching a negative file              | zero matches asserted per rule                          | rule-fixtures 31/31 (observed)                                  |
