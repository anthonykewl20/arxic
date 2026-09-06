# WEB-422-REPLAY — staged doc updates

Issue: #422, parent #402. Disposition: observed causal reproduction and implementation; final CI disposition is recorded in the PR.

## 1. SYNC tracker row

```text
| #422 | WEB-422-REPLAY: wait for asynchronous replay completion | Causal delayed-request regression and strengthened email proof; current-head CI in PR |
```

## 2. SYNC session-log row

```text
| 2026-09-06 | WEB-422-REPLAY reproduces premature replay completion with real Next.js + Mailpit. Generated replay shares exploration's bounded settling service; canonical runtime source survives bundling. Original email threshold remains, with independent per-submission counts added. Full #402 and human release inspection remain open. |
```

## 3. CHANGELOG entry

```text
- Fixed (refs #422): generated replay now waits for asynchronous actions before assertions, screenshots and receipts. Share the bounded exploration service and canonical runtime bytes; delayed real reset submissions must produce inbox counts 1, 2, 3, without weakening the original assertion.
```

## 4. VERSION bump

User-visible correctness fix: patch increment under the owner-defined v0.0.NNN rule, after the preceding feature notes are integrated in merge order. This slice leaves VERSION, SYNC and CHANGELOG for the integrator.

## 5. Evidence and gates

Real Next.js + isolated Mailpit + Chromium through discovery/compiler/verifier, including an 800 ms delay on the first replay. Before: two passing replay reports but only two emails and a cancelled request. After: all three accepted submissions, inbox counts 1, 2, 3. Supplemental shared-service hanging-response and real bundler portability tests pass. Final evidence and gate results are attached in the PR and issue. No assertion was loosened. Generated screenshots mask the main region and do not prove visual layout; sanitized action timelines and independent email counts establish action completion. No human release inspection is claimed.

## 6. Sad paths

| Trigger                                        | Expected disposition                                   | Test                                                  |
| ---------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| Delayed replay submit                          | Completion only after server action and email delivery | agent.real-world.test.ts selected-reset               |
| Hanging asynchronous action                    | Bounded failure, no completed observation              | post-action-settle.real-world.test.ts                 |
| Bundle transform changes function spelling     | Identical canonical runtime bytes                      | post-action-settle-portability.test.ts                |
| Unsafe or mismatched retained trace/screenshot | Evidence export rejects or excludes artifact           | reset-proof.ts plus existing sanitizer/verifier tests |

The [audit](../evidence/WEB-422-REPLAY/summary.md) retains two clean delayed-reset runs, two masked PNGs and four inspected sanitized timelines. The broad initial run passed 338/339 tests; its existing valid-login Email tautology depended on premature assertions. The rejected-login scenario keeps the exact original tautology expectations, while a new successful-login case rejects the stale marker. No matcher was broadened. Full-repo format after this note/evidence: `All matched files use Prettier code style!`.

The corrected verifier file passes all 15 real-world tests (97.88 s). ADR-004 records the historical test-evidence correction; do not rewrite historical SYNC claims silently when integrating this note.
