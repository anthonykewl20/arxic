# ADR008-wave1-amendments — staged doc updates (charter §10.2)

Issue: #244 · PR: (this PR) · Disposition: verified (docs-only; every figure
cited to an in-repo spike report)

Docs-only slice: executes the GO-WITH-AMENDMENTS follow-ups from the
`consensus-terra` gate over spike wave 1 (DG-01..DG-04, PRs #263/#266/#264/#265).
One tracked file changed: `docs/adr/008-domain-general-intent-extraction.md`
(Status stays **Proposed**). Plus three issue comments (refs #249, refs #250,
refs #244) and one untracked debris deletion in the primary tree (root
`ShelfController.php` — corrupted-escape early draft of the tracked fixture).

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #244 | [ADR008-wave1-amendments] consensus-gate amendments to ADR-008 (adaptation reuse, clustering advisory, per-domain cost profile, DG-12 target ratification) | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-17 | **#244 (ADR008-wave1-amendments) ADR-008 wave-1 amendments DONE.** Four amendments landed in docs/adr/008: Decision 5 records adaptation as the chosen reuse mechanism (tree-sitter-php@0.23.12 exact pin, ABI-compatible with tree-sitter@0.22.4) and corrects the census to 15 grammar-bearing configs; Decision 2 + Risks demote clustering to an advisory prioritization heuristic (koel: 43 clusters, ~9–13 with domain signal); Decision 4 records the DG-04 cost profile (per-domain + bounded concurrency is the production path, one-shot forbidden; provisional ~$0.025 per ~340-row budget, owner-overridable, must be set before DG-08); Exit criteria add pre-exit target nomination + owner ratification (koel + directus candidates; campaign monorepo unlocatable). Contract-drift notes posted to #249/#250; wave-2 sequencing recorded on #244. Gates: format ✓ lint ✓ test 1292 passing ✓. Next: DG-05+DG-09 parallel. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### internal`

```
- ADR-008 wave-1 amendments (#244): consensus-gate follow-ups — Decision 5 adaptation reuse mechanism + census correction (15 grammar-bearing configs); Decision 2 clustering demoted to advisory prioritization heuristic (koel-measured); Decision 4 measured per-domain cost profile with one-shot forbidden as proposal path and provisional per-app budget; DG-12 pre-exit target nomination + owner ratification requirement (koel/directus candidates).
```

## 4. VERSION bump required?

no — documentation only; no user-observable behavior change.

## 5. Evidence pointers

- Real-world proof: none required (docs-only). Every amended figure is cited
  inline to its in-repo spike report: `docs/spikes/dg-01-language-pack-spi.md`
  (§1.2 census, §1.4 mechanism, §5.1 monorepo unlocatable),
  `docs/spikes/dg-02-domain-inventory.md` (§5.1 clustering, §6.2 monorepo),
  `docs/spikes/dg-04-model-proposal.md` (§5.3 cost matrix, §5.2 monorepo).
- Contract-drift claims in the issue comments were re-verified against source
  before posting: `packages/source-ua-adapter/src/language-packs/index.ts:42-47`,
  `packages/domain-inventory-spike/src/interchange.ts:56-68`,
  `packages/intent-proposal-spike/src/inventory.ts:39-57`,
  `packages/domain-inventory-spike/src/types.ts:39-66`.
- Gates: typecheck n/a (no code) · lint ✓ · format ✓ · test ✓ (full suite run
  to be safe; see PR checks for the authoritative CI run) · license gate ✓ (CI)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

Not applicable — no executable change. The ADR's own truth-state rules are
preserved: no LLM-assigned `verified` anywhere; all measured figures carry
`docs/spikes/*` citations (source-of-truth hierarchy, ADR §11).
