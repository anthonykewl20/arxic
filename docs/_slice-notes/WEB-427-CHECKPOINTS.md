# WEB-427-CHECKPOINTS — staged doc updates (charter §10.2)

Issue: #427 · PR: #428 · Disposition: local proof passed; merge requires current-head `ci pass` on PR #428.

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #427 | [WEB-427-CHECKPOINTS] Approved workflow checkpoint gallery | Complete upon CI-gated merge of #428 |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-06 | **#427 (WEB-427-CHECKPOINTS)** Explicit semantic capture settings share CLI/worker privacy validation; guided settings require consent; dashboard gallery independently validates promoted screenshot/source bindings and checks image/provenance hashes on access. Real Next.js verifier and light/dark desktop/mobile gallery tests pass; 96 changed-area tests and 82 privacy tests pass locally. Merge is gated by required PR #428 CI. Next: remaining #402 product/release gates. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- WEB-427-CHECKPOINTS (refs #427): expose explicitly approved workflow checkpoint captures in Test runs, with guided semantic region/mask settings, capture consent, original privacy provenance, image integrity checks and loading/error/retry feedback. Local and worker execution share the existing privacy policy validator. Workflow images remain separate from visual baselines and complete audit verdicts.
```

## 4. `VERSION` bump required?

Yes, user-observable addition; the integrator applies the owner-defined minor +100
in merge order. No worktree VERSION/SYNC/CHANGELOG edits.

## 5. Evidence pointers

- `apps/web/src/__tests__/agent.real-world.test.ts`: actual Next.js app, Chromium,
  source extraction, compiler and two verifier replays; controlled external model
  response boundary, no paid/live-provider inference claimed.
- `apps/web/src/__tests__/checkpoint-ui-proof.ts`: real dashboard login/navigation,
  gallery/settings, changed-image refusal and retry, light/dark desktop/mobile,
  axe and numeric overflow checks; setup uses a real completed engine run.
- [Retained proof](../evidence/WEB-427-CHECKPOINTS/summary.md): 16 inspected PNGs (8 before, 8 final), four hash-checked sanitized timelines, 96 changed-area tests and 82 privacy tests passed; final focused browser proof 29.32 s. Typecheck/lint/license pass. Required CI: [PR #428 checks](https://github.com/anthonykewl20/arxic/pull/428/checks); merge only on `ci pass`.
- No raw trace archives retained. No human release sign-off or full matrix claim.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                   | Expected disposition                             | Test                                                            |
| ----------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| Malformed/unknown/CSS capture declaration | Refused                                          | CLI checkpoint and worker policy tests                          |
| Guided capture without consent            | Refused before save                              | Web workflow-capture test                                       |
| Changed image/provenance                  | HTTP conflict / unavailable evidence             | Actual guided engine run and browser gallery                    |
| Image replaced with symlink               | Refused                                          | Actual guided engine run artifact API                           |
| No capture declaration                    | Existing conservative main-mask policy           | Existing file-based real engine cases                           |
| Unvalidated exported evidence             | Explicit evidence gap; no changed engine verdict | Action boundary and existing independent artifact-set validator |

Red-first records: CLI 5 failures before capture support; guided consent/form
failures before wiring; actual guided verifier passed two replays but returned no
gallery before export; worker boundary accepted malformed capture before validation.
The guided consent fixture initially omitted the required domain declaration and
was corrected; the intended consent assertion was unchanged. Browser proof also
corrected harness ownership (close the existing workbench before starting its HTTP
server), explicit axe browser context and the model fixture's GET catalog route.
No product assertion was widened. Runtime/worker-container custom-capture proof and
complete dashboard heuristic/browser/locale/role coverage are not claimed by this slice.

Screenshot inspection found missing gallery padding despite passing axe/reflow checks.
The added numeric 16px minimum failed at 0px, then passed after token-based gallery
and settings spacing at `11d2bea`; no matcher was loosened.

Initial CI `34043268950` found the run-history polling/search error race and a
duplicate production SHA-256 helper. Both reproduced locally. The same Retry
assertion now reproduces the race with a delayed state response; the latest refresh
owns error disposition. Hashing uses the contracts helper with no exemption.
Both real light/dark UI journeys and eight canonical tests passed (10 tests, 65.17 s).
Focused recovery evidence is included under the proof directory’s `history/` path.

At `aec24c6`, fresh retained history proof passed both complete UI journeys
(67.48 s), and the current guided engine/gallery rerun passed (36.16 s). Total
retained evidence: 20 agent-inspected masked PNGs and six independently hash-checked
sanitized timelines. Final full-repository format output after writing this note:
`All matched files use Prettier code style!` Typecheck and lint also pass after the
CI fixes. Completion remains conditional on current-head required `ci pass`.
