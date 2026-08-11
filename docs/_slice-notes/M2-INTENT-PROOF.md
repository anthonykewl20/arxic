# M2-INTENT-PROOF — staged doc updates (charter §10.2)

Issue: #116 · PR: <F> · Disposition: mixed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #116 | [M2 design + impl] Intent-backed pseudocode (IntentSpec) — ADR-004 accepted after the two-app live-Chromium proof; slices A-F landed | ☑ done (6 of 6 slices) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-11 | **#116 (M2-INTENT-PROOF) intent-backed pseudocode capstone DONE.** Slice F composes the existing oracle-resolution and sensitivity-probe seams through a real LangGraph run over both fixture apps: the vulnerable app's source/runtime `url:/` versus `text:Logged in` conflict stays `contradicted` with no receipt; its observed-only assertion reaches a deterministic-verifier `verified` run but remains characterization-only and unpromoted; the reference app's `url:/` acceptance assertion kills the mutation in real Chromium and promotes. ADR-004 is Accepted; its implementation questions are annotated resolved or deferred post-acceptance. Targeted orchestrator gate: 11 files / 88 tests. **#116 6/6 slices.** Next: #103 remains open. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Internal`

```
- M2-INTENT-PROOF intent-backed pseudocode capstone (#116): added the two-app real-Chromium composition matrix proving sticky source/runtime contradiction, observed-only characterization refusal, and a killed acceptance-assertion sensitivity mutation through the injected orchestrator seams; accepted ADR-004 with resolved and deferred follow-ups recorded.
```

## 4. `VERSION` bump required?

No — this capstone proves private M2 seams and changes no public contract or production default.

## 5. Evidence pointers

- Real-world proof: `packages/orchestrator-langgraph/src/__tests__/intent-proof.real-world.test.ts` — real LangGraph stages, committed source, Crawlee/Chromium, Playwright compilation, two-pass verification, and sensitivity mutation against both booted fixture apps.
- Artifacts: stage-9/10 artifacts are asserted through `InMemoryStageCheckpointer`; safe proof summaries are emitted to stdout. Temporary screenshots and sanitized traces are deleted with each run; no raw trace ZIP is retained.
- Gates: typecheck passed · package typecheck passed · lint passed · targeted test passed (11 files / 88 tests) · format passed in the final post-note check · license gate not requested for this proof-only slice.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                   | Expected disposition                                                                                            | Test                                                                     |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Vulnerable app runtime observes `text:Logged in` while the domain oracle requires `url:/` | `contradicted`; promotion ineligible; no receipt                                                                | `intent-proof.real-world.test.ts` vulnerable-app conflict branch         |
| Vulnerable app assertion has only `observed-only` provenance                              | deterministic verifier may report `verified`, but characterization remains promotion-ineligible with no receipt | `intent-proof.real-world.test.ts` vulnerable-app characterization branch |
| Reference app acceptance assertion is mutated to `url:/__arxic-probe-never__`             | mutation killed; sensitivity gate passes and promotion proceeds                                                 | `intent-proof.real-world.test.ts` reference-app acceptance branch        |
