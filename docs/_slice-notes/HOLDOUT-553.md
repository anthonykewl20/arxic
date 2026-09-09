# HOLDOUT-553 — staged doc updates (charter §10.2)

Issue: #553 · PR: (this slice's PR) · Disposition: observed (chronological holdout answered: no cross-time generalization; promotion blocker confirmed)

> Fold note: this slice's PR also stages **no** CHANGELOG/tracker changes of
> its own beyond the rows below; it carries the evidence directory
> `docs/evidence/VISUAL-SLM/holdout-2026-09-10/` and the register C4 rewrite
> in `docs/release-gates/undischarged-gates.md` directly. When folding, also
> fold the still-unfolded staged rows in `docs/_slice-notes/CORPUS-EVALUATE-553.md`
> (the #554 evaluate-only path) in the same integrator pass.

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

No `#553` tracker row exists (the issue was filed after the last fold). Add:

```
| #553 | [VISUAL-HOLDOUT] chronological holdout for the compact visual reviewer | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-10 | **#553 (VISUAL-HOLDOUT) chronological holdout DONE.** The 2026-09-10 fresh capture (koel + directus rehearsal containers, adminlte/gentelella/sb-admin/todomvc static families; 252 planned, 66 oracle-honest skips, 186 rows) scored against the retained 2026-09-08 trained artifact (mlp.bin sha-verified, evaluate-only path, zero retraining): clipping head 0/65 recall, 117/117 specificity — the reviewer does not generalize across time; `blocked-experimental-model` promotion stays correct. Evidence `docs/evidence/VISUAL-SLM/holdout-2026-09-10/` (sanitized, zero leak-pattern hits). Register C4 answered (observed). No product code changed. Next: fold both staged notes; C5 promotion stays owner/human-gated. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### changed`

```
- VISUAL-HOLDOUT chronological holdout for the compact visual reviewer (refs #553): the 2026-09-10 fresh third-party capture (186 scored rows after 66 honest oracle skips) scored against the sha-verified retained 2026-09-08 artifact through the evaluate-only path with zero retraining shows the clipping head at 0/65 recall with 117/117 specificity — no cross-time generalization, promotion stays blocked; sanitized evidence retained and register C4 answered. No product code changed.
```

## 4. `VERSION` bump required?

No — no product code changed; evidence and register documentation only.

## 5. Evidence pointers

- Real-world proof: `docs/evidence/VISUAL-SLM/holdout-2026-09-10/holdout-summary.md` — 2026-09-10 `cli.ts corpus-evaluate` capture across koel/directus (rehearsal containers) + adminlte/gentelella/sb-admin/todomvc (+ todomvc-vendor routes) under `ARXIC_VISUAL_THIRD_PARTY`, scored against the retained trained artifact (`training/mlp.bin` sha256 `3a8675a0…` matched `mlp-model.json.artifact.sha256` before the run)
- Artifacts: `corpus-evaluation.json` (per-head metrics + artifact binding), `corpus-v2.json` (fresh manifest, revision `587feec1`, 66 recorded skips), 12 representative cases with privacy sidecars
- Gates: typecheck ☐ · lint ☐ · format ☐ · test (n/a — no product code changed; CI full suite runs) ☐ · license gate ☐

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                               | Expected disposition                                                            | Test/artifact                                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Output directory without a trained artifact                                           | fail closed `no-trained-artifact (<artifact> missing)` before any capture/write | `corpus-evaluate.real-world.test.ts` (merged #554) — verified |
| Fresh capture whose own oracle fails (unstable case, oracle-failure, no-text-element) | case skipped with recorded reason, never mislabeled                             | 66 `corpus-v2.json.skipped` entries — observed                |
| Unscoreable heads (no trained threshold)                                              | reported `scoreable: false, cases: 0`, never fabricated                         | `corpus-evaluation.json` heads 2–6 — observed                 |
| Trained artifact tamper                                                               | mlp.bin sha256 must equal manifest `artifact.sha256` before scoring             | pre-run check on this host 2026-09-10 — observed              |
