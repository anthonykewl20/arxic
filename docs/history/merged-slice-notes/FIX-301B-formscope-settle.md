# FIX-301B-formscope-settle — staged doc updates (charter §10.2)

Issue: #301 (follow-up defect found by campaign round 4) · PR: #TBD · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (append)

```
| #301b | [FIX-301B-formscope-settle] formScope filter read a single immediate count — SPA re-render mid-hydration blocked every fill ambiguous (round-4 follow-up to #301) | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append)

```
| 2026-08-24 | **#301b (FIX-301B-formscope-settle) formScope settle across re-renders DONE.** The DG-08 formScope filter counted scoped forms ONCE with no settle — on the real directus login the navigate step's observation lands mid-re-render (measured: t0 scoped form = 0, t+300ms = 1), so every fill/submit failed closed semantic-ambiguous (reproduced deterministically 4/4 through the attestation front; campaign round 4 blocked on exactly this after the #301/#302 fixes). The scope now waits BOUNDED (the driver's own timeoutMs budget) for exactly-one — the same settle the control locators get from their attach-wait — then applies the fail-closed gate. Red-first real Chromium (shell that attaches its form at t+400ms); the two-scoped-forms ambiguity pin stays green; the real directus front sequence passes 4/4 (was 4/4 blocked). **Next: DG-12 round 5 under #256.** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-301B formScope settle (#301 follow-up): the exploration driver's form-scope resolution waits bounded for the scoped form to reach exactly one across SPA re-renders (measured on directus /admin: the navigate observation lands mid-swap, count read 0 → every fill/submit failed closed ambiguous). The fail-closed ambiguity gate itself is unchanged — two scoped forms still block.
```

## 4. `VERSION` bump required?

no — agent-adapter-internal settle fix.

## 5. Evidence pointers

- Red-first real-Chromium: `packages/playwright-agent-adapter/src/__tests__/formscope-settle.real-world.test.ts` — a shell attaching its form at t+400ms blocked (single count read 0 → ambiguous) before, resolves after; two persistent scoped forms still block ambiguous.
- Real-target proof: the deterministic 4/4 reproduction through the real `AttestationFront` + real directus login (navigate → fill → fill) — 4/4 `ok/ok/ok` after (was 4/4 `ok/semantic-ambiguous/semantic-ambiguous`).
- Campaign evidence of the defect: `docs/evidence/DG-12/directus/runs/directus-dg12-run4/` (fills blocked ambiguous with the #301 fix present; 009 GONE — the crawl-tier login succeeded).
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (adapter 50/50) ☐ license gate (CI)

## 6. Sad paths proved

| Trigger                                                                              | Expected disposition                                      | Test                                                                            |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| form attaches ~400ms after load (re-render shape); navigate then fill with formScope | waits bounded; resolves (observed)                        | `waits (bounded) for the scoped form to reach exactly one across the re-render` |
| two scoped forms persist                                                             | blocked `semantic-ambiguous` — fail-closed gate unchanged | `still fails closed (ambiguous) when two scoped forms exist and stay`           |

## 7. Not done / known-weak spots

- The settle polls at 100ms granularity up to `timeoutMs` — a page flapping between two scoped forms for the whole budget still blocks ambiguous after the deadline (fail-closed, honest).
- The fix is unmerged into the campaign worktree; round 5 re-runs after this PR lands.
