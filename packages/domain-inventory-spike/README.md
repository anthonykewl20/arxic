# @arxic/domain-inventory

The **deterministic Domain Inventory denominator** (DG-02 #246, productionized
as pipeline stage 13 by DG-06 #250) — ONE deduplicated table of every
discovered user-facing surface (route / page / endpoint), fused from:

1. the **TS/JS source side** — output of `@arxic/source-ua-adapter`
   (`NormalizedSourceIndex`, consumed read-only; route findings are
   `EvidenceRefSource` events whose `ruleId` is `route:METHOD /path`);
2. the **PHP source side** — the **INTERCHANGE format v1**
   (`src/interchange.ts`), produced by the REAL DG-05 language pack
   (`SourceUaAdapter.collectRouteInventories()`, `arxic-langpack-php@1.0.0`,
   Tree-sitter PHP); the DG-02 stand-in scanner (`src/standin-php.ts`) remains
   for offline reproduction and is always marked `standIn: true`;
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
clustering quality, and clustering is an ADVISORY prioritization heuristic,
never a domain partition (amended ADR-008 Decision 2).

> **Directory-name note (DG-06):** the package was renamed
> `@arxic/domain-inventory-spike` → `@arxic/domain-inventory`, but the
> DIRECTORY stays `packages/domain-inventory-spike` for now:
> `packages/source-ua-adapter`'s lockstep guard imports this package's
> interchange types via a RELATIVE path, and that package is owned by another
> slice in this wave. Renaming the directory is a one-line follow-up once the
> relative import is updated in the same change.

## Pipeline stage (DG-06)

`packages/orchestrator-langgraph` wires the inventory as **stage 13**,
executing between structural extraction (stage 2) and framework rules (stage
3). Numbering decision (ADR-008 Consequences, recorded at DG-06): **13 is the
next AVAILABLE id** — ids 0–12 stay stable — while the POSITION is right after
structural extraction. The stage artifact is the
`arxic-domain-inventory-stage-v1` envelope: the inventory, its stabilized
bytes SHA-256 (determinism proof), provider-include resolutions, and the
evidence-graph projection summary.

## Provider-include prefix resolution (two-pass composition)

`resolveProviderIncludes()` performs the second pass the per-file pack scan
cannot (#249 deferral): it reads the PROVIDER file named by an
`unresolved-file` gap, extracts the enclosing `Route::group` prefix context
around the anchored include, and rewrites the included file's route URIs
(BookStack's `api` prefix). Everything unprovable stays a VISIBLE structured
gap — an unproven context is never defaulted to an empty prefix. See
`src/provider-includes.ts` and `docs/evidence/DG-06/`.

## Canonical schema (DG-04 consumer reconciliation)

The canonical row is the DG-02 shape (dispositions + structured
line-anchored `EvidenceRef`s are product requirements, ADR-008 Decisions 2
and 6). `toProposalConsumerInventory()` projects it into the DG-04 consumer
shape (`id`/`surface`/`domainHint`/`evidenceIds`) with a collision-free
content-derived id grammar — see `src/consumer-adapter.ts` for the full
decision record and the lockstep test that pins the shapes together.

## API

- `buildInventory(inputs)` → `DomainInventory` (rows + clusters + stats);
  byte-identical composition of the two passes below
- `buildSourceInventory(inputs)` → source-side fusion (TS/JS + interchanges +
  manifest gaps) — what stage 13 runs before the crawl exists
- `fuseRuntimeInventory(source, surfaceMap)` → attaches crawl observations to
  a source-side inventory — what reconciliation runs after stage 5
- `resolveProviderIncludes({interchanges, readUtf8})` → provider-include
  prefix composition + resolutions + visible unresolved gaps
- `validateInventory(inventory)` → fail-closed completeness/no-silent-drop check
- `serializeInventory(inventory)` → canonical byte-stable JSON (volatile runtime
  fields stripped)
- `validateInterchange(input)` → fail-closed INTERCHANGE validation
- `toProposalConsumerInventory(inventory)` / `buildConsumerEvidenceIndex` →
  DG-04 consumer projection
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
- `src/__tests__/provider-includes.test.ts` — prefix composition, sad paths
  first (real BookStack artifact + koel provider shapes)
- `src/__tests__/bookstack-fusion.test.ts` — the 9-collisions defect on the
  real DG-05 artifact (19 fusion-key collisions → 0 resolved / visible
  unresolved)
- `src/__tests__/translator-integration.test.ts` — REAL Tree-sitter PHP via
  `collectRouteInventories()` → interchange → resolution → fusion (the #250
  contract-comment requirement)
- `src/__tests__/consumer-adapter.test.ts` — DG-04 consumer integration
  (type lockstep + real adapter scan + real DG-04 exporter interop)
- `src/__tests__/standin.test.ts` — PHP stand-in against koel-derived shapes
- `src/__tests__/koel-interchange.test.ts` — real-repo data
  (koel/koel @ dfec91f, see `docs/evidence/DG-02/`)
- `src/__tests__/real-world.test.ts` — **both fixture apps**: real Tree-sitter
  scan + real Chromium crawl + fusion (runs in CI)
