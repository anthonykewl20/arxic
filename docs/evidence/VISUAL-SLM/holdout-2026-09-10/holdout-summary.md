# VISUAL-SLM chronological holdout — 2026-09-10 (issue #553 AC 6)

## What ran

`cli.ts corpus-evaluate` (evaluate-only path merged in #554) captured a fresh
corpus on **2026-09-10** — genuinely later than the 2026-09-08 merged corpus —
across the third-party roots, and scored every extracted row against the
**already-trained** artifact with zero retraining:

- no `dataset.json`/`dataset-provenance.json`/`corpus-report.json` written;
- `training/*.bin` mtimes predate the run (staged from
  `docs/evidence/VISUAL-SLM/`, sha256-verified against the manifests before
  the run);
- the Python trainer and rust compile were not invoked (the `visual-native`
  binary was compiled separately from the unchanged tracked
  `scripts/visual-slm/native.rs` — the scorer, not a trained artifact).

## Artifact binding (from `corpus-evaluation.json`)

| Field | Value |
| --- | --- |
| basis | `mlp-model.json` |
| logistic.bin sha256 | `fb35fda66b6272fac1a049fb6334f6065a610c05de6e2913f5848f1b829a1f24` |
| mlp.bin sha256 | `3a8675a05d98011228c6252c0e6b89a2cf5ac10def7dae2fc431de861bef8a13` (matches `mlp-model.json.artifact.sha256`) |
| training datasetSha256 | `259ca3df72ca375fd54a0dd584b67edff74a587c3794277812639f21dedf4fde` |
| fresh corpus manifest sha256 | `6b8645f2a31bd787…` (full value in `corpus-evaluation.json`) |
| scored against revision | `587feec1` (evaluate-only implementation) |

The artifact's only trained head is `clipping` (threshold 0.892); the other
five heads have no trained thresholds (`supported=false`) because the
2026-09-08 training corpus contained no positive variants for them.

## Holdout plan

Families (third-party roots under `ARXIC_VISUAL_THIRD_PARTY`): `koel`,
`directus` (docker rehearsal images `koel-php83:rehearsal`,
`directus-node22:rehearsal`) and the static public families `adminlte`,
`gentelella`, `sb-admin`, `todomvc` (+ `todomvc-vendor` vendor routes).
Viewports 360/640/1024/1280; full 14-variant registry
(`gentelella`/`adminlte` pin their design viewport 1280).

Planned 252 cases → 66 skipped (honest oracle dispositions, recorded in
`corpus-v2.json.skipped`) → **186 cases / 186 scored rows**.

| family | cases | clip-positive | clean | skipped |
| --- | --- | --- | --- | --- |
| adminlte | 13 | 5 | 1 | 1 |
| directus | 44 | 20 | 4 | 12 |
| gentelella | 1 | 0 | 0 | 13 |
| koel | 48 | 20 | 4 | 8 |
| sb-admin | 52 | 20 | 4 | 4 |
| todomvc | 28 | 0 | 4 | 28 |

## Result (per-head, from `corpus-evaluation.json`)

| head | scoreable | cases | TP | FP | TN | FN | accuracy |
| --- | --- | --- | --- | --- | --- | --- | --- |
| clipping | yes | 182 | 0 | 0 | 117 | 65 | 0.643 |
| occlusion | no | 0 | — | — | — | — | — |
| missing_element | no | 0 | — | — | — | — | — |
| overflow | no | 0 | — | — | — | — | — |
| text_truncation | no | 0 | — | — | — | — | — |
| layout_shift | no | 0 | — | — | — | — | — |

Accounting cross-check: the manifest contains exactly 65 clip-positive cases
(`clip-full`/`clip-right-75`/`clip-right-50`/`clip-right-25`/`clip-bottom-50`,
13 each) and 117 clipping-negative rows; the 4 `missing-element` rows carry a
null clipping label and are excluded from that head.

## Interpretation (observed, not verified)

The clipping head shows **100% specificity (117/117 clean pages correctly
cleared) but 0% recall (0/65 controlled clipping regressions detected)** on a
capture dated two days after the training corpus, across third-party roots
the 2026-09-08 corpus partly covered (koel, directus) and partly never saw
(adminlte, gentelella, sb-admin, todomvc). The reviewer does **not**
generalize across time for its only trained head; the promotion blocker is
confirmed rather than cleared, and `promotion: blocked-experimental-model`
remains correct. C4's question — "does anything show generalization across
time?" — is now answered with a machine-produced, sha-bound observation whose
answer is **no**; the model-quality gap this exposes is C5's (promotion)
territory, not a data-availability gap.

Truth states (ADR §2): every number above is **observed** from the attached
artifacts; `verified` remains reserved for the human review gates, and
independent human visual inspection of retained screenshots is still owed.

## Sanitization

All retained files were produced by the capture pipeline's privacy path:
every PNG carries a `.privacy.json` masking sidecar and every timeline a
`.sanitization.json` (12 + 24 sidecars, all parse). A leak-pattern grep
(secret key prefixes, `ARXIC_MAILPIT_*`, absolute home paths, loopback
origin:port strings) over this directory returns zero hits. Third-party
roots stay local-only; no container images, mounts, or host paths beyond the
documented env-var defaults are recorded here.

## Files

- `corpus-evaluation.json` — the evaluate-only report (per-head metrics + artifact binding).
- `corpus-v2.json` — the fresh holdout manifest (plan, revision, skipped, provenance).
- `<family>-<viewport>-<variant>*` — 12 representative cases (koel, directus,
  adminlte, sb-admin: clean + `clip-full` (+ `clip-right-25` for koel);
  gentelella/todomvc: their surviving `overflow-x` + clean cases), each with
  before/current PNGs, privacy sidecars, scene, timeline, and timeline
  sanitization record.
