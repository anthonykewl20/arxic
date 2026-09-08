# WEB-402-CONFIG-OMISSIONS — staged doc updates (charter §10.2)

Issue: #402 · PR: #<PR> · Disposition: observed (an LLM assigns at most `observed`; the deterministic suites are the proof)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
(No milestone row — #402 slice; record under the #402 status paragraph.)
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 | **#402 (WEB-402-CONFIG-OMISSIONS) omission exposure by persona, feature flag and action DONE.** The dimensions the operator already configures are now fused deterministically with what discovery found: `configurationOmissions(project, inventory, frontend)` (pure, browser-safe — type-only imports) exposes `flag:<name>` aligned / declared-unreferenced (a declared project flag no source file reads) / referenced-undeclared (a `flags.*`/`process.env.*`/`import.meta.env.*` member no deployment declares; exact-name matching, disclosed), `persona:login-route` referenced/missing (per-pass-login loginPath must exist as a discovered route), and `persona:seed-endpoint` (seed-api mode must find seed-route source declarations — a design-correcting red moved this from the consumer inventory, which carries no API rows, to the frontend source rows where the evidence lives). `routeStateCoverage` gains a sixth `actions` dimension (interactive action declarations per route). The intent inventory panel renders the Configuration-omissions block beside the route chips with the honesty boundary (configuration-vs-source misalignments, not runtime claims; runtime VALUES stay unobserved). Proven red-first over the real Workbench discovery stack (real fixture + overlays reading `flags.newCheckout`/`process.env.NEXT_PUBLIC_BETA_UI`; real persona mutations) and a real-Chromium panel journey configuring flags/persona through the real wizard. #509's dimension-order pin widened to six entries — disclosed, additive. Next #402: semantic business-intent synthesis, source-to-runtime state mapping, authenticated visual checkpoints, paid inference, human gate. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### <added|changed|fixed|security|internal>`

```
### Added

- WEB-402-CONFIG-OMISSIONS configuration omission exposure (#402): source discovery's inventory panel now fuses the saved execution settings with the discovered source — declared feature flags no source file reads, source-referenced flags no deployment declares, a per-pass-login persona whose login route the app does not have, and a seed-api persona without a seed endpoint are all exposed as omissions with line-anchored evidence; per-route coverage gains an `actions` dimension (routes whose source declares no interactive action). Exact-name flag matching; configuration-vs-source misalignments only — runtime values stay unobserved.
```

## 4. `VERSION` bump required?

no (integrator folds; user-observable capability — candidate bump at fold time, integrator's call)

## 5. Evidence pointers

- Real-stack proof: `apps/web/src/__tests__/config-omissions.test.ts` — the REAL Workbench (real project save with declared flags + per-pass-login persona, real discovery) over the real fixture plus overlays: `flag:newCheckout` aligned with line evidence, `flag:orphanFlag` declared-unreferenced, `flag:NEXT_PUBLIC_BETA_UI` referenced-undeclared, `persona:login-route` referenced for `/login` / missing for a `/portal` persona, `persona:seed-endpoint` referenced via the real seed route source, `actions` referenced on `/` (real logout form) and absent on a static overlay route; pure-derivation equality. Second test drives the raw adapters directly.
- UI proof: `apps/web/src/__tests__/config-omissions-ui.real-world.test.ts` — real Chromium through the real wizard (persona + flag configuration through the real form, declarations details expanded), asserting the Configuration-omissions block renders `flag:orphanFlag · declared-unreferenced` and `persona:login-route · referenced` with the honesty wording.
- Artifacts: `docs/evidence/WEB-402-CONFIG-OMISSIONS/{red,green}.txt` (including the seed-endpoint design-correcting red).
- Gates: typecheck ☑ (root + `typecheck:packages` + web) · lint ☑ · format ☑ full repo (`All matched files use Prettier code style!`) · test ☑ (five lanes green after prettier) · license gate — CI `package` job.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                    | Expected disposition                                                                     | Test                                                               |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| declared project flag no source file reads                                 | `flag:<name>: declared-unreferenced` (omission)                                          | `config-omissions.test.ts`                                         |
| source-referenced flag the deployment does not declare                     | `flag:<name>: referenced-undeclared` (omission)                                          | `config-omissions.test.ts`                                         |
| per-pass-login persona whose loginPath is not a discovered route           | `persona:login-route: missing`                                                           | `config-omissions.test.ts` (mutated real project)                  |
| seed-api persona with no seed-route source declarations                    | `persona:seed-endpoint: missing`                                                         | implementation branch; the real fixture proves the referenced side |
| flag-name mismatch across conventions (`X` declared, `NEXT_PUBLIC_X` read) | surfaced as declared-unreferenced + referenced-undeclared (exact-name policy, disclosed) | derived from the matching rule                                     |
| route whose source declares no interactive action                          | `actions: absent` chip                                                                   | `config-omissions.test.ts`                                         |
| anonymous persona / no execution settings                                  | no persona/flag entries (nothing configured to fuse)                                     | `config-omissions.test.ts` raw-adapter variant                     |
