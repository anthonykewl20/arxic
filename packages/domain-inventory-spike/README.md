# @arxic/domain-inventory-spike

DG-02 research spike (issue #246): the **deterministic Domain Inventory
denominator** — ONE deduplicated table of every discovered user-facing surface
(route / page / endpoint), fused from:

1. the **TS/JS source side** — output of `@arxic/source-ua-adapter`
   (`NormalizedSourceIndex`, consumed read-only; route findings are
   `EvidenceRefSource` events whose `ruleId` is `route:METHOD /path`);
2. the **PHP source side** — the documented **INTERCHANGE format**
   (`src/interchange.ts`), produced for this spike by an explicitly-marked
   **STAND-IN** routes-file scanner (`src/standin-php.ts`); the real producer
   is the DG-01/DG-05 language pack (#245/#249), which does not exist yet;
3. the **runtime side** — output of `@arxic/crawlee-adapter` (`SurfaceMap`,
   consumed read-only) from a real Chromium crawl.

**No LLM participates anywhere in building the inventory.**

Every row carries exactly one disposition from the binding enum
(`extracted` / `unsupported` / `unsafe` / `unextracted-with-reason`) plus a
mandatory non-empty reason for every non-extracted row — no silent drops. The
completeness invariant (total rows == sum of dispositions) is proven by
`validateInventory()` with an independent recount, and by tests.

Deterministic clustering (`src/cluster.ts`) groups rows into candidate domains
by resource/noun + verb heuristics; raw rows are always exposed regardless of
clustering quality (ADR-008 risk note).

Spike status: **provisional** — conclusions feed ADR-008 via
[`docs/spikes/dg-02-domain-inventory.md`](../../docs/spikes/dg-02-domain-inventory.md);
this package is a research artifact, not a pipeline stage (that is DG-06,
#250).

## API

- `buildInventory(inputs)` → `DomainInventory` (rows + clusters + stats)
- `validateInventory(inventory)` → fail-closed completeness/no-silent-drop check
- `serializeInventory(inventory)` → canonical byte-stable JSON (volatile runtime
  fields stripped)
- `validateInterchange(input)` → fail-closed INTERCHANGE validation
- `enumeratePhpRoutes(root, options)` → **STAND-IN** PHP/Laravel routes-file
  scan in the INTERCHANGE format (`standIn: true` always)
- `normalizePath` / `matchRuntimePath` → the canonical path algebra
  (`[id]`/`{id}`/`{id?}`/`:id` → `:param`; concrete runtime paths matched
  against parameterized source routes)

## Tests

- `src/__tests__/sad-paths.test.ts` — fail-closed validation, no-silent-drop
- `src/__tests__/fusion.test.ts` — fusion keys, dedupe, dispositions
- `src/__tests__/clustering.test.ts` — deterministic domain clustering
- `src/__tests__/completeness.test.ts` — the binding invariant + determinism
- `src/__tests__/standin.test.ts` — PHP stand-in against koel-derived shapes
- `src/__tests__/koel-interchange.test.ts` — real-repo data
  (koel/koel @ dfec91f, see `docs/evidence/DG-02/`)
- `src/__tests__/real-world.test.ts` — **both fixture apps**: real Tree-sitter
  scan + real Chromium crawl + fusion (runs in CI)
