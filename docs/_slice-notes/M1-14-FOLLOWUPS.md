# M1-14-FOLLOWUPS — staged doc updates (charter §10.2)

Issue: #97 · PR: #98 · Disposition: mixed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

Integrator-owned per charter §10.2; this parallel slice does not edit `SYNC.md`.

```
| #<N> | [M1-14-FOLLOWUPS] Stage-4 inference follow-up fixes | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

Integrator-owned per charter §10.2; this parallel slice does not edit `SYNC.md`.

```
| 2026-08-07 | **#<N> (M1-14-FOLLOWUPS) Stage-4 inference follow-up fixes DONE.** Empty candidate fields now fail real AJV validation and direct callers drop them without fabrication; adapter failures retain redacted cause diagnostics, while unexpected throws become message-free `ARXIC-ORCH-INFERENCE-ERROR` diagnostics. Real Tree-sitter, real `sg`, the reference auth app, and a real HTTP model endpoint proved hypothesized success and blocked malformed/throw paths without prompt, credential, or canary leakage. **M1 14/15.** Next: #27. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

Integrator-owned per charter §10.2; this parallel slice does not edit `CHANGELOG.md`.

```
- M1-14-FOLLOWUPS Stage-4 inference follow-up fixes (#<N>): reject empty model candidate fields instead of fabricating content, and preserve already-redacted adapter failure attribution while converting unexpected throws to a stable message-free orchestrator diagnostic; real reference-app inference proves bounded blocking and checkpoint leak safety.
```

## 4. `VERSION` bump required?

Integrator-owned per charter §10.2; this parallel slice does not edit `VERSION`. Yes → patch bump, because corrected inference output and diagnostics are user-observable per `RELEASES.md`; the integrator chooses the exact post-merge version.

## 5. Evidence pointers

- Real-world proof: `packages/orchestrator-langgraph/src/__tests__/inference-real-world.test.ts` — real Tree-sitter and real `sg` scan the real reference auth app, with stage 4 exercised through a real `node:http` OpenAI-compatible endpoint; malformed responses and an escaping adapter throw block after bounded retries without leaking canaries.
- Artifacts: ephemeral per-run stage artifacts and file checkpoints asserted by the real-world suite; no UI screenshots or traces apply to this service-layer fix.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (492/493 passing; unrelated M0 pipeline test repeatedly timed out at its existing 5-second limit) ☐ · license gate ☑ (real dependency graph test passed within `pnpm test`)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                               | Expected disposition                                                                                       | Test                                                                                                                                            |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty-string model candidate `id`/`intent` reaches the structured-output schema       | `blocked` by real AJV validation; no candidate fabricated                                                  | `packages/orchestrator-langgraph/src/__tests__/inference.test.ts`                                                                               |
| A direct caller bypasses adapter validation with an empty candidate entry             | Malformed entry dropped; remaining evidence-backed candidate stays `hypothesized`                          | `packages/orchestrator-langgraph/src/__tests__/inference.test.ts`                                                                               |
| Model adapter returns a redacted not-ok result                                        | `blocked`; precise adapter diagnostic preserved across bounded orchestrator retries                        | `packages/orchestrator-langgraph/src/__tests__/inference.test.ts`, `packages/orchestrator-langgraph/src/__tests__/inference-real-world.test.ts` |
| Model adapter unexpectedly throws with a credential/prompt-like canary in its message | `blocked` as `ARXIC-ORCH-INFERENCE-ERROR`; throw message omitted from diagnostics and persisted run bytes  | `packages/orchestrator-langgraph/src/__tests__/inference.test.ts`, `packages/orchestrator-langgraph/src/__tests__/inference-real-world.test.ts` |
| Every real HTTP model response is malformed                                           | `blocked` after exactly two attempts with umbrella and carried `ARXIC-MODEL-RETRIES-EXHAUSTED` diagnostics | `packages/orchestrator-langgraph/src/__tests__/inference-real-world.test.ts`                                                                    |
