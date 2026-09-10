# Corpus scale run — 2026-09-10 (issue #557 slice 2, register C3)

Full-registry corpus capture through `captureCorpusV2` + `buildLabeledRows` with
real Chromium (`cli.ts corpus`), all **10 families**: next, express, arxic, koel,
directus (koel/directus via their local rehearsal images), todomvc, gentelella,
sb-admin, adminlte, **sb-admin-2** (added in #558). Grid: 360/640/1024/1280 ×
all 14 registry variants; gentelella and adminlte capture only at their pinned
1280 design width (their unmutated pages contradict the overflow oracle at
narrow widths).

## The numbers, both accountings

- **Planned: 476.** 8 free families × 4 widths × 14 variants (56 each) = 448,
  plus gentelella and adminlte at 14 each = 28. This is the registry maximum —
  there is no plan extension left inside the current config.
- **Scored rows: 401 across all 10 families** — the register's historical unit
  (the pilot note compared "178 adjudicated rows" to the 1,000 bar). Under the
  rows unit the ≥1,000 bar stays **open**, residual ≥599 scored rows.
- **Non-null oracle labels: 1,778** across the 401 cases (each case carries a
  six-entry head label vector; entries are non-null where that variant's oracle
  adjudicates). Under a region-level-label reading of the spec's literal
  wording ("1,000 adjudicated regions") the count clears 1,000. The register
  keeps rows as the unit, as the pilot note did; choosing the other unit is an
  owner call and is recorded here, not decided here.
- **Skips: 75, every one carrying a reason class** — `unstable-case` 46,
  `overflow-oracle-failed` 17, `no-text-element` 8, `text-truncation-oracle-failed` 4.
- **Per-family rows:** next 56 · express 56 · arxic 47 · koel 48 · directus 44 ·
  todomvc 28 · gentelella 1 · sb-admin 52 · adminlte 13 · sb-admin-2 56.
- **Not padded:** the width grid is the standard one every prior corpus used
  (holdout, pilot); adding near-duplicate widths solely to inflate the row
  count would be padding, which #557's acceptance criteria prohibit.
- **Reaching the bar honestly** needs registry growth: roughly 11+ additional
  families at this grid (~50-56 scored rows each), or new controlled variants
  in the registry (oracle/model territory, C5-adjacent), or an owner ruling
  that region-level labels are the unit (1,778 already clears it).

## Scope hygiene

- Adjudication stayed deterministic-predicate: the report records
  `noTeacherCalls: true`.
- `promotion: blocked-experimental-model` — unchanged; no model claim is made
  here. The run's local training output (logistic/MLP in the run directory)
  is throwaway; the retained in-repo artifact is untouched, and register C4's
  2026-09-10 answer (no cross-time generalization) stands.
- Frozen allocation (seed 423): train = express, directus, adminlte, arxic,
  gentelella, sb-admin-2 · calibration = sb-admin, next · **test = todomvc, koel**
  (untouched by training, as always).

## Sanitization

All retained files were produced by the capture pipeline's privacy path:
every PNG carries a `.privacy.json` masking sidecar and every timeline a
`.sanitization.json` (63 sidecars, all parse). A leak-pattern grep (secret key
prefixes, `ARXIC_MAILPIT_*`, absolute home paths, loopback origin:port strings)
over this directory returns zero hits. Third-party roots stay local-only.

## Files

- `corpus-v2.json` — the full run manifest: plan, frozen allocation hash, all
  401 scored cases with their label vectors and measured clip/overflow values,
  and all 75 skips with reasons.
- `corpus-report.json` — the training/review report bound to this run
  (version 1, seed 423, per-case review records with manifest/model sha256
  bindings, promotion verdict).
- `<family>-1280-{clean,clip-right-50,missing-element}` — one representative
  case per family per retained variant (where the family produced one):
  before/current PNG + privacy sidecars, case JSON, scene JSON, sanitized
  timeline + sidecar.

Truth states: `observed` throughout. `verified` remains reserved for the human
review gates, and independent human visual inspection of retained screenshots
is still owed.
