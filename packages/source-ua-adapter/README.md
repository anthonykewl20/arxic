# `@arxic/source-ua-adapter`

Deterministic TypeScript/JavaScript/PHP source indexing behind the frozen
`SourceIndexer` contract. This package adapts a reviewed minimal scanner and
structural-extraction subset from
[Understand Anything](https://github.com/Egonex-AI/Understand-Anything/tree/fe8c5bc591716aafd79b4765549328f08ef5a52e),
rather than importing its internals or copying the project wholesale.

## Seams

- `collectFrontendInventory(root, sourceIndex)` adds a separate, versioned
  frontend declaration inventory without changing the frozen SourceIndexer.
  It reuses the native parser and bounded no-follow source reader, checks
  bytes against the indexed manifest, and never grants dirty or changed bytes
  committed provenance. JS/TS/JSX/TSX syntax yields component declarations and
  uses, native controls, action attributes, conditional branches, state hooks
  and attributes, test declarations and environment/flag member expressions.
  Markdown/text headings and requirement language outside fenced code yield
  declared requirements, with an explicit gap for unproved acceptance semantics.
  Every row is hypothesized and carries commit/path/line/hash provenance.
  Unsupported templates (including EJS, Vue and Svelte), malformed files,
  uncommitted bytes and quota stops remain per-file gaps. Limits are 1 MiB per
  file, 5,000 eligible analyzed files and 20,000 declarations; all enumerated
  files remain accounted for. Runtime personas, flag values, route/state/action
  outcomes and viewport coverage remain explicitly unobserved. Tests use both
  real reference source trees and adversarial filesystem/budget cases.

- Git resolves a full commit, rejects shallow/no-commit inputs, reports dirty
  paths, and enumerates tracked plus non-ignored untracked files bytewise.
- The manifest hashes raw working-tree bytes and classifies language/category,
  binary files, and quota violations.
- Native `tree-sitter` with separately packaged TypeScript/TSX and
  JavaScript/JSX grammars extracts symbols, imports, calls, Next.js App Router
  file-convention routes, and Express route registrations.
- PHP is indexed through the same seam (DG-01 → productionized by DG-05,
  refs #245/#249): the `tree-sitter-php` grammar (the same npm package
  upstream's PHP config declares) powers symbol, import, and call extraction,
  and the Arxic-owned Laravel rule layer (`src/language-packs/php/`) inventories
  routes declared via `Route::` verbs/groups/resources — including dot-notation
  `apiResource` expansion, prefix and middleware chains (service-provider
  methods included), aliased `use` imports, PSR-4 controller convention
  resolution, literal `foreach`+interpolation loops, and `conditional` marking
  for if-block registrations — with line-anchored `EvidenceRef`s. Route rows
  that cannot be statically resolved emit
  `ARXIC-SOURCE-ROUTE-DYNAMIC-REGISTRATION`; handlers that cannot be grounded
  emit `ARXIC-SOURCE-HANDLER-UNRESOLVED`; unknown `Route::` constructs emit
  `ARXIC-SOURCE-ROUTE-UNSUPPORTED-CONSTRUCT`; route file includes
  (`require base_path(...)`, `Route::group(..., base_path(...))`) emit
  `ARXIC-SOURCE-ROUTE-FILE-INCLUDE`; a runtime without the grammar emits
  `ARXIC-SOURCE-GRAMMAR-UNAVAILABLE` per file. No gap is ever silent.
- Language packs are DATA-DRIVEN (`src/language-packs/index.ts`): a pack
  declares its grammar (npm package reference) + versioned framework inventory
  rules; `builtinLanguagePacks` is frozen per release for byte-stable evidence.
- `SourceUaAdapter.collectRouteInventories()` emits one Route Inventory
  Interchange v1 document per route-producing pack (`arxic-langpack-php@1.0.0`,
  `standIn: false`) — the Domain Inventory's documented input contract
  (`packages/domain-inventory-spike/src/interchange.ts`). Conformance is
  integration-tested against the REAL DG-02 `validateInterchange`, including
  fail-closed rejection of corrupted documents.
- Unsupported-language diagnostics name the actual language: `.mts`/`.cts`
  parse as TypeScript; known-but-unpackable extensions (`.rb`, `.py`, …) are
  identified by language id in manifest and diagnostics; only genuinely
  unidentified extensions report an explicit no-language condition
  (ADR-008 Decision 5).
- Every source claim is a frozen `EvidenceRef`; dirty-file bytes never receive
  committed provenance. Gaps are frozen-contract-valid, blocked diagnostics.

`SourceScanPolicy` owns fail-closed quotas, supported languages, extra ignores,
and failure classification. The adapter itself remains a service-layer
capability block; future Actions select policy and orchestrate dispositions.

`collect()` adds a manifest, resolved revision, pinned tool versions, and one
explicit `generatedAt` field. With that timestamp removed, canonical JSON uses
sorted object keys and stable event/file ordering, so identical repository
state and tool versions produce byte-identical normalized evidence.

The `ADR §23.14 SourceIndexer engine-upgrade contract gate` test must pass
before replacing or upgrading the parser engine. Integration tests run the real
native parser against both real fixture-app source trees and the Arxic-authored
Laravel fixture app (`src/__tests__/fixtures/laravel-app/`, license-clean per
the DG-01 fixture strategy). Mixed-language monorepo classification
(TS/JS/PHP/known-unsupported/unknown) is covered by
`src/__tests__/mixed-language.test.ts`; interchange conformance by
`src/__tests__/interchange.test.ts` and the committed koel artifact test. A separate test checks that each installed grammar
package declares MIT and ships its own `LICENSE`.

The measurement harnesses `scripts/measure-laravel.mjs` (DG-01 evidence) and
`scripts/measure-laravel-inventory.mts` (DG-05: interchange + real-validator
summary) run this adapter against a real Laravel working copy; committed
aggregate evidence lives under `docs/evidence/DG-05/`.
