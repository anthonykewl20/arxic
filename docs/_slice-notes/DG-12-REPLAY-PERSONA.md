# DG-12-REPLAY-PERSONA — staged doc updates (charter §10.2)

Issue: #256 · PR: pending · Disposition: blocked

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #256 | [DG-12] EXIT GATE: ALL-domain intent extraction proven on two real third-party apps | open — replay-ratio campaigns still require two operator-run clean passes |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-29 | DG-12 replay-persona template repair: both campaign templates now declare the frozen per-pass login locator metadata required when ARXIC_INPUT_PERSONA_EMAIL / ARXIC_INPUT_PERSONA_PASSWORD are supplied. CLI parser/schema validation accepted both templates. Campaign replay outcomes remain blocked pending two clean operator runs. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- DG-12 replay-persona declaration (#256): declare the target-owned per-pass login locators in both campaign templates so env-supplied fixture credentials can reach stage-7 replay rather than its fail-closed undeclared-persona refusal.
```

## 4. `VERSION` bump required?

no — a campaign evidence-template correction; no published CLI behavior changes.

## 5. Evidence pointers

- Contract: `packages/verifier/src/replay-persona.ts:16-35,64-66` freezes a locator-only `fixtures.replayPersona` object (`per-pass-login`, route, ordered labelled fields, submit) and maps the two input refs to `ARXIC_INPUT_PERSONA_EMAIL` and `ARXIC_INPUT_PERSONA_PASSWORD`. `apps/cli/src/config/validate.ts:169-193` validates it; `packages/verifier/src/verifier.ts:475-493` uses it with a persona and refuses a declared persona without credentials.
- Refusal condition: `apps/cli/src/local-executor.ts:268-307` emits `replayPersonaNotDeclaredRefusal` when a persona-driven endpoint-less target has no declaration; `packages/verifier/src/replay-persona.ts:175-185` defines the fail-closed diagnostic. A declaration on `environmentClass: production` is refused at `apps/cli/src/config/validate.ts:85-94`.
- Template consumption: `packages/intent-proposal-spike/scripts/dg11-run-validation.ts:1179-1183,1210-1229` copies the campaign `arxic.yaml` to a temporary config and replaces only the proxy origin, clone path, and clone commit. It does not interpolate persona credentials; `apps/cli/src/local-executor.ts:499-505` reads the credential env vars directly.
- Locator rationale: `docs/evidence/DG-12/DESIGN.md:182-186,199-202` identifies the koel first-admin constants at `app/Models/User.php:104-106`; `docs/evidence/DG-12/DESIGN.md:204-217` identifies the Directus admin as the BOOT-PROCEDURES `ADMIN_EMAIL` / `ADMIN_PASSWORD` pair. The operator exports the values at campaign time as documented in `docs/evidence/DG-12/DESIGN.md:404-409` (directus) and `:457-462` (koel). Required exports: `ARXIC_INPUT_PERSONA_EMAIL` and `ARXIC_INPUT_PERSONA_PASSWORD`; they must be the boot-seeded admin for the selected app and must never be added to YAML.
- Schema validation: passed — the CLI's `yaml` parser plus `validateConfig` accepted both templates after applying the runner's exact three substitutions (proxy origin, clone path, clone commit); each produced `replayPersona=per-pass-login`.
- Artifacts: no campaign replay was run by this documentation-only template correction; no screenshot, timeline, or trace artifact was created.
- Gates: typecheck not applicable (no TypeScript changed) · lint not run (template-only scope) · format passed · test not run (no YAML-template unit test) · license gate not run.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                    | Expected disposition                          | Test                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persona env is supplied for an endpoint-less target but `fixtures.replayPersona` is absent | blocked (`ARXIC-VERIFY-FIXTURE-NOT-DECLARED`) | Existing action path: `apps/cli/src/local-executor.ts:281-307`; declaration supplied by these templates removes this trigger.                            |
| `fixtures.replayPersona` is present but either persona env value is absent                 | blocked                                       | Existing verifier path: `packages/verifier/src/verifier.ts:486-490`; campaign operator must export both required variables.                              |
| Declaration shape or locator vocabulary is malformed                                       | blocked                                       | Existing config validator: `packages/verifier/src/replay-persona.ts:81-159`; expanded-template CLI parse/schema validation passed for both declarations. |
| A production-shaped target declares replay persona                                         | blocked                                       | Existing config validator: `apps/cli/src/config/validate.ts:85-94`; DG-12 templates retain `environmentClass: local-test`.                               |
