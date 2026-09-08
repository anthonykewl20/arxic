# WEB-402-DECLARED-RULES — staged doc updates (charter §10.2)

Issue: #402 · PR: #<PR> · Disposition: observed (deterministic suites are the proof; AI-ledger facts are displayed as recorded, never upgraded)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
(No milestone row — #402 slice; record under the #402 status paragraph.)
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 | **#402 (WEB-402-DECLARED-RULES) declared business rules per route + intent-ledger fusion DONE.** The last deterministic depth of the first criterion: `declaredRouteRules(inventory, frontend)` inventories two documented rule classes per route with line evidence — `rule:validation` (control declarations carrying required/pattern/length-bound attribute names; type=email/number VALUES are not captured by the adapter — disclosed gap, follow-up recorded) and `rule:authorization` (condition/state/action text naming sessions, sign-in/out, csrf, rate limiting, lockout, roles, permissions) — with zero-rule routes flagged as an honest omission. `unionIntentCoverage(rows)` (pure) unions every run's persisted intent ledger per surface key `METHOD path` with a documented truth ranking (verified > observed > hypothesized > contradicted > blocked; replay passed > attempted > not-attempted), surfaced additively through `Workbench.intentOutcomes()` (full-record reads; the summary projection strips ledgers) and `state()`. The #509 coverage section gains per-route chips: `validation (n) · authorization (n)` or `no declared rules`, and `intents: n · <best truth> · <replay>` or `no intent proposal yet` — the intent lane fused onto the discovery surfaces. Proven red-first: real fixture discovery (/login validation+authorization with real evidence incl. the csrf/rate-limit condition text; `/` authorization via its session ternary; a static overlay route → no declared rules); ranking/merge units; a REAL ledger validated through the real validateIntentLedger (closed schema: prop: ids, src: evidence refs, oracle kinds — three validator-driven corrections in the test, retained) seeded onto a finished run in the real store, fused through the real workbench; real-Chromium journey rendering both chips. Next #402: AI-visual-review criteria, authenticated state coverage, paid inference, human gate. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### <added|changed|fixed|security|internal>`

```
### Added

- WEB-402-DECLARED-RULES declared business rules and intent fusion (#402): source discovery's per-route coverage now inventories declared business rules — validation (required/pattern/length-bound control attributes) and authorization (session/sign-in/csrf/rate-limit/lockout/role/permission condition text) with line-anchored evidence, flagging routes that declare none — and fuses every campaign run's persisted intent ledger onto the same routes (intent count, best truth state with a documented ranking, replay status), exposing routes with no AI proposal as intent omissions. Rule recognition is attribute-name-based; input type values are not captured today (disclosed).
```

## 4. `VERSION` bump required?

no (integrator folds; user-observable capability — candidate bump at fold time, integrator's call)

## 5. Evidence pointers

- Rules real-stack proof: `apps/web/src/__tests__/declared-rules.test.ts` — real fixture discovery (plus a static overlay route): `/login` carries validation (the real required inputs, `app/login/page.tsx` evidence) AND authorization (the enriched condition text naming csrf and the rate limit/lockout in `app/login/actions.ts`); `/` authorization via its session ternary and no validation; `/about` → `omission: true`; deterministic ordering; pure-derivation equality.
- Fusion proof: same file — `unionIntentCoverage` ranking/merge units (verified > observed > hypothesized > contradicted > blocked; multi-run merge; unknown surfaces absent), and the real-workbench journey: a ledger validated by the REAL `validateIntentLedger` (closed-schema corrections disclosed in-test) seeded onto a finished agent run in the real store, fused through the real `Workbench.intentOutcomes()`.
- UI proof: `apps/web/src/__tests__/declared-rules-ui.real-world.test.ts` — real Chromium through the real dashboard renders the per-route chips (`validation`/`authorization` on `/login`, `no intent proposal yet`) beside the runtime gap note.
- Artifacts: `docs/evidence/WEB-402-DECLARED-RULES/{red,green}.txt`.
- Gates: typecheck ☑ (root + packages + web) · lint ☑ · format ☑ full repo · test ☑ (4/4 new lanes; regression sweep over the #509/#516/#518 surfaces) · license gate — CI `package` job.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                               | Expected disposition                                                        | Test                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| route with no validation or authorization declaration | `omission: true` — honest signal, never "no rules exist"                    | rules test (`/about`)                                                   |
| input type=email/number validation                    | NOT detected (attribute values uncaptured) — disclosed gap, no silent guess | design disclosure + slice note                                          |
| surface with no ledger row anywhere                   | absent from the union → `no intent proposal yet` chip                       | fusion test + UI journey                                                |
| ledger rows across multiple runs for one surface      | merged: rows/intents summed, best truth/replay by documented ranking        | union units                                                             |
| malformed ledger JSON persisted on a run              | skipped by the fusion (rows?.length guard), never crashes the panel         | implementation guard                                                    |
| summary projection stripping `$.result.ledger`        | fusion reads FULL run records via `store.run(id)`                           | fusion test (seeded ledger invisible in summaries, visible in outcomes) |
