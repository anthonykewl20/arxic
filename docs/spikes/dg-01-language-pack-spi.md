# DG-01 — Research spike: Language Pack SPI + PHP/Laravel route extraction (reuse-first)

| Field     | Value                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Issue     | [#245](https://github.com/anthonykewl20/arxic/issues/245)                                                                                 |
| Status    | **Provisional** — pending `consensus-terra` and/or cross-review (`reviewer-deepseek` + `reviewer-hy3` / `codex-reviewer`) per ADR-008 §11 |
| Date      | 2026-08-16                                                                                                                                |
| Artifacts | `packages/source-ua-adapter/src/language-packs/**`, `docs/evidence/DG-01/*.json`                                                          |
| Method    | Code is the source of truth; every load-bearing claim below carries a file/line or URL+commit-SHA citation                                |

---

## 0. Executive summary

1. **Reuse-first is viable and cheap.** Upstream Understand-Anything is MIT (license read at
   `arxic-private/gears/understand-anything/LICENSE:1-22`, local tree; corroborated by the GitHub
   API `license.spdx_id` for `Egonex-AI/Understand-Anything`). It is **not published to npm**
   (verified 404 for `understand-anything-core`, `@egonex/understand-anything`, and
   `@understand-anything/core` on 2026-08-16), so "npm dependency" is not a mechanism available
   today. The recommended mechanism is the one this spike implements: **adaptation** — consume the
   _same grammar npm packages_ upstream declares (`tree-sitter-php`), keep upstream source as a
   local pinned reference, and own only the layer upstream lacks (deterministic per-framework
   route inventory).
2. **Upstream provides no route inventory.** Its framework registry ships configs for django,
   express, fastapi, flask, gin, nextjs, rails, react, spring, vue — **no laravel**
   (`understand-anything-plugin/packages/core/src/languages/frameworks/` at commit
   `32944829e7a63a9fa9c55d811d7f98a9530c6a6a`). Its PHP extractor extracts
   functions/classes/interfaces/imports/call graphs only
   (`.../plugins/extractors/php-extractor.ts:115-267` at the same commit). The Laravel layer is
   Arxic's to write — exactly as ADR-008 Decision 5 assumes.
3. **The prototype inventories real Laravel apps at campaign scale with zero-to-negligible
   parse failure.** Against **koel @ `dfec91ff290509c622ff7cf392fb5e506841ee2b`**
   (`composer.lock` pins `laravel/framework v13.24.0`): **304 endpoint rows**, 0 duplicate
   METHOD+URI pairs, 201 line-anchored handler refs, **0 dynamic-registration gaps, 0.0% PHP
   parse-failure rate over 1,412 files**. Against **BookStack @ `c813c1b3628c0b6bd757c12cadaa56f50724117d`**
   (`laravel/framework v12.64.0`): 335 rows, 332 handler refs, **1 parse error in 1,770 PHP files
   (0.0565%)** — a Blade template shipped with a `.php` extension.
4. **Two measured honest-gap classes are real and correctly non-silent:** koel declares 31
   `apiResource` actions its controllers do not implement (visible as
   `ARXIC-SOURCE-HANDLER-UNRESOLVED`, one per action) plus one inherited-`__invoke` resolution
   limitation; BookStack carries one genuinely dead route (`PageController::ajaxDestroy`, no such
   method at `app/Entities/Controllers/PageController.php` — only `destroy`/`destroyDraft` exist,
   lines 321/338).
5. **One measured inventory limitation:** route files included via
   `Route::group([...prefix...], function () { require base_path('routes/api.php'); })` in a
   service provider lose the including group's prefix (BookStack's
   `app/App/Providers/RouteServiceProvider.php:64-73`). In BookStack this unprefixed 120 api rows
   and produced 9 METHOD+URI collisions with web rows. Laravel ≤10-style apps are shaped this way;
   the ^11/^12 constraint families still dominate public composer.json files (see §5.3), so DG-05
   must resolve provider-included route files (two-pass) or record the prefix gap per file.

All conclusions are provisional pending the ADR-008 §11 cross-review.

---

## 1. Vendored-vs-upstream inventory (deliverable 1)

### 1.1 What `@arxic/source-ua-adapter` actually took

The M0-07 spike vendored a **subset at pinned ref `fe8c5bc591716aafd79b4765549328f08ef5a52e`**
into the LOCAL-ONLY reference tree `arxic-private/gears/understand-anything/`
(`PROVENANCE.md:6-10`). The vendored subset names seven seams (`PROVENANCE.md:18-24`). What the
Arxic package did with each:

| Upstream seam (vendored path, pinned ref fe8c5bc)                                                                                   | Arxic file                                         | Nature of reuse                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills/understand/scan-project.mjs` (project discovery/scan orchestration)                                                         | `src/scanner.ts`                                   | **Adapted**: re-implemented as fail-closed git-provenance scanner (commit/shallow/dirty/oversize/binary guards) — none of that exists upstream                                              |
| `skills/understand/extract-structure.mjs` + `extract-structure-result.mjs` (deterministic structure extraction + normalized output) | `src/extractors/typescript.ts`, `src/normalize.ts` | **Adapted**: symbol/import/call findings mapped to Arxic `SourceFinding`; canonical-JSON determinism is Arxic's                                                                             |
| `skills/understand/compute-batches.mjs` (bounded batching)                                                                          | —                                                  | **Not taken** (LLM-batching concern; Arxic has no model in the loop here)                                                                                                                   |
| `packages/core/src/plugins/tree-sitter-plugin.ts` (parser plugin seam)                                                              | `src/parser.ts`                                    | **Adapted, engine-swapped**: upstream loads wasm grammars via `web-tree-sitter`; Arxic loads the same grammar families through native `tree-sitter@0.22.4` bindings (`src/parser.ts:14-27`) |
| `packages/core/src/plugins/extractors/typescript-extractor.ts`                                                                      | `src/extractors/typescript.ts`                     | **Adapted**: node-type mapping decisions preserved; `StructuralAnalysis` output replaced by `SourceFinding`                                                                                 |
| `packages/core/src/languages/framework-registry.ts` (+ `frameworks/`)                                                               | `src/framework-registry.ts`                        | **Purpose-inverted**: upstream detects frameworks to steer LLM prompting; Arxic extracts Next.js file-convention routes and Express `app.get` registrations                                 |
| `agents/domain-analyzer.md`, `skills/understand-domain/extract-domain-context.py`                                                   | —                                                  | **Excluded by design** (`PROVENANCE.md:27`): LLM hypothesis producers, not deterministic verifiers                                                                                          |

### 1.2 What upstream main has that Arxic does not use

Census taken at upstream `main` = `32944829e7a63a9fa9c55d811d7f98a9530c6a6a` (fetched 2026-08-16;
branch HEAD verified via `gh api repos/Egonex-AI/Understand-anything/commits/main`):

- **13 language extractor classes** — `.../plugins/extractors/index.ts` exports `TypeScript,
Python, Go, Rust, Java, Ruby, Php, Cpp, CSharp, Dart, Kotlin, Swift, Scala` extractors
  (typescript-extractor.ts … scala-extractor.ts in the same directory). This matches the issue's
  "13 dedicated language extractors" premise.
- **Language configs**: `.../languages/configs/index.ts` imports **43** config files, of which
  exactly **15 carry a `treeSitter` grammar declaration** (verified by downloading every config
  and grepping for `treeSitter`): `c, cpp, csharp, dart, go, javascript, java, kotlin, php,
python, ruby, rust, scala, swift, typescript`. **Correction to the issue body:** it claims 16
  code-language configs; `lua.ts` exists but has **no** `treeSitter` field at this commit, so the
  grammar-bearing count is 15. Recorded as evidence-and-dissent (ADR-008 §11), not silently
  propagated.
- **PHP surface as data**: `.../languages/configs/php.ts:3-29` declares
  `treeSitter: { wasmPackage: "tree-sitter-php", wasmFile: "tree-sitter-php.wasm" }` plus
  file-pattern conventions. The grammar package is the SAME npm artifact Arxic now consumes
  natively — upstream's own `packages/core/package.json` lists `"tree-sitter-php": "^0.23.11"`
  among its dependencies (fetched at the same commit).
- **No route inventory anywhere**: the framework configs (`frameworks/django.ts` … `vue.ts`)
  carry `detectionKeywords`, `manifestFiles`, `promptSnippetPath` — they steer an LLM agent, not
  a deterministic inventory. There is no laravel.ts. Upstream's domain mapping is an LLM agent
  (`agents/domain-analyzer.md`), which ADR-008 Decision 5 already excludes as Arxic's
  completeness denominator.

### 1.3 License verification (read, not remembered)

- **Upstream Understand-Anything**: `arxic-private/gears/understand-anything/LICENSE` (local
  vendored tree, lines 1-22) — MIT, "Copyright (c) 2026 Yuxiang Lin" / "Infinite Universe, Inc."
  Corroborated: `gh api repos/Egonex-AI/Understand-Anything` → `license.spdx_id == "MIT"`.
- **`tree-sitter-php`**: npm metadata `license: MIT` (registry, 2026-08-16) and the shipped
  `LICENSE` file is asserted by the extended grammar-license unit test
  (`src/__tests__/grammar-licenses.test.ts`), which fails CI if either breaks.
- Both pass `scripts/license-gate.mjs` (no GPL/AGPL/SSPL).

### 1.4 Reuse mechanism options and recommendation

| Option                                                 | Feasibility (verified)                                                                                                                                                                                                                                                                                                                                                        | Cost/risk                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **A. npm dependency on upstream**                      | **Not available** — upstream is unpublished (npm 404 for `understand-anything-core`, `@egonex/understand-anything`, `@understand-anything/core`; the last is its real package name per its `package.json`). Also its runtime is `web-tree-sitter`-wasm based while Arxic's spine is native bindings.                                                                          | n/a                                                                                                                     |
| **B. Vendoring upstream code into the repo**           | Possible (MIT) but requires committing third-party code, keeping it current, and it drags wasm loading + zod schemas Arxic does not use                                                                                                                                                                                                                                       | Maintenance + review-surface cost; license-clean but repo-noise                                                         |
| **C. Adaptation (status quo, extended by this spike)** | **Chosen.** Consume the same grammar npm packages upstream declares (`tree-sitter-php@0.23.12` — exact-version pinned because `tree-sitter-php@0.24.2` failed to load under the repo's `tree-sitter@0.22.4` runtime; 0.23.x is also upstream's own line); mirror upstream's extractor mapping decisions with citations; keep the pinned upstream tree LOCAL-ONLY as reference | Divergence drift: upstream may improve extractors; mitigated by the pinned-ref PROVENANCE and per-file citation headers |

**Recommendation (provisional):** stay on **C**. For DG-05 (#249), promote the upstream PHP
mapping table into the pack as reviewed data (or re-vendor the extractor under license review if
byte-fidelity ever matters), and add the remaining languages by depending on each grammar npm
package exactly as upstream's configs declare them (`configs/*.ts` `wasmPackage` fields are the
shopping list). Revisit option A only if upstream publishes to npm with a stable semver surface.

---

## 2. Prototype: Laravel route inventory behind the frozen `SourceIndexer` (deliverable 2)

### 2.1 Shape

No new contract surface: `SourceUaAdapter implements SourceIndexer`
(`packages/contracts/src/adapters.ts:99-101`) is unchanged. PHP files flow through the existing
scan pipeline; `src/scanner.ts` dispatches to the PHP language pack
(`src/language-packs/index.ts`), which returns per-file findings plus **cross-file handler
findings** (controller files, anchored at the resolved method) and advisories.

```
src/language-packs/
  index.ts                  — LanguagePack SPI + phpLanguagePack wiring
  php/
    singularize.ts          — doctrine/inflector 2.1.0 English singular port
    laravel-resources.ts    — ResourceRegistrar v13.24.0 expansion port
    laravel-routes.ts       — route inventory engine (groups/prefixes/chains/
                              resources/match/redirect/view/fallback/if/foreach)
    php-symbols.ts          — symbol/import/call extraction (upstream-adapted)
```

Layering follows the code-structure skill: the engine is a pure service over a parsed tree + a
`RepoFileAccess` seam; orchestration (which files, which policy, what provenance) stays in the
scanner Action.

### 2.2 Laravel semantics reproduced (with citations to the version koel locks)

All from `laravel/framework` **v13.24.0** (koel's `composer.lock`), fetched from the tag:

- Resource defaults & order: `ResourceRegistrar::$resourceDefaults`
  (`src/Illuminate/Routing/ResourceRegistrar.php:21`).
- `apiResource` only-list + intersect ordering: `Router::apiResource`
  (`src/Illuminate/Routing/Router.php:382-393`) and `getResourceMethods`
  (`ResourceRegistrar.php:270-283`).
- Verb→URI shapes: `addResourceIndex…addResourceDestroy`
  (`ResourceRegistrar.php:294-423`); update registers **PUT and PATCH** via
  `match(['PUT','PATCH'])` (`ResourceRegistrar.php:402`) — the inventory emits both as rows
  because Arxic's denominator counts URI×HTTP-method surfaces.
- Nested dot resources: `getResourceUri` strips the trailing wildcard then re-adds per verb
  (`ResourceRegistrar.php:577-607`); wildcard = singularized last segment
  (`ResourceRegistrar.php:97`, `:615-626`).
- Slash-prefixed resource names become prefixes (`ResourceRegistrar.php:209-221`).
- Parameter singularization: `Str::singular` → doctrine/inflector **2.1.0** (koel's lockfile
  version) `src/Rules/English/{Inflectible,Uninflected}.php` — the full irregular map,
  uninflected pattern list, and ordered singular transformations are ported in
  `src/language-packs/php/singularize.ts` (PHP-vs-JS back-reference semantics are handled
  explicitly).
- Legacy string controllers resolve against `App\Http\Controllers\` as a **fallback after**
  direct PSR-4 resolution (Laravel ≤10 namespace behavior; kept because ^11/^12/^13 all appear in
  the wild — §5.3).

### 2.3 Route shapes proven against real apps (test fixtures are these shapes)

Koel (`routes/api.base.php`, Laravel 13): fluent `prefix()->middleware()->group()` chains
(L101-104), nested `middleware()->group()` (L107, L127), invokable controller classes (L108),
`[Controller::class, 'method']` pairs (L117), `apiResource` + dot-notation nested resources +
`->except('update','destroy')` + `->where([...])` (L157-172), multi-line array pair args
(L215-218), conditional `if (...) { Route::get }` (L254-256), array-attribute groups
(`['prefix' => 'radio']`, L299-302), chained `middleware()->prefix()->group()` (L317-319);
`routes/subsonic.php`: literal-array `foreach` + `"{$endpoint}{format?}"` interpolation +
`Route::match(['get','post'])` (L59-118). BookStack (`routes/web.php`, Laravel 12):
leading/trailing-slash URIs (`/shelves/`, L26-27), namespace-alias class references
(`SettingControllers\StatusController::class` via `use BookStack\Settings as SettingControllers`,
L4+24), `->where('path', '.*$')`, `Route::fallback`, `Route::view`, `Route::redirect`.

### 2.4 Honesty model (never silent)

- Unresolvable URI / non-literal loop **declaring routes** → one
  `ARXIC-SOURCE-ROUTE-DYNAMIC-REGISTRATION` advisory (severity `observed`), route omitted from
  rows but the gap is counted.
- Unresolvable handler (no PSR-4 file, unreadable file, missing method) → route row **still
  emitted** + `ARXIC-SOURCE-HANDLER-UNRESOLVED` advisory.
- Non-literal loops that declare **no** routes (config-file `foreach`) are walked through —
  measured against BookStack's `app/Config/*.php`, which otherwise produced false advisories.
- PHP parse failures keep the pre-existing per-file `ARXIC-SOURCE-PARSE-ERROR` skip +
  manifest `reason: 'parse-error'`.

---

## 3. Language Pack SPI design (deliverable 3 — feeds ADR-008, not edited)

The prototype ships the minimal SPI in `src/language-packs/index.ts`:

```ts
type LanguagePackGrammar = { packageName: string; exportKey?: string }; // grammar as data —
// mirrors upstream
// LanguageConfig.treeSitter
type LanguagePack = {
  id: string; // 'php'
  extensions: readonly string[];
  grammar: LanguagePackGrammar; // 'tree-sitter-php' / 'php'
  frameworkRules: readonly string[]; // ['laravel-route-inventory@1'] — rule layers as data
  extract(ctx: { path; parsed; access }): Promise<LanguagePackExtraction>;
};
```

Design principles for DG-05 to carry forward:

1. **Grammar as data.** A pack declares its grammar the way upstream's configs do; the runtime
   resolves it to a native binding (Arxic) — the same npm artifact upstream loads as wasm.
2. **Extraction is code behind one call; rules are versioned data.** `frameworkRules` names the
   rule layers applied; each layer carries a version (evidence `extractor` field already reads
   `source-ua-adapter/laravel-route-inventory@1`), so evidence is reproducible against the rule
   set that produced it.
3. **Cross-file resolution goes through a narrow `RepoFileAccess` seam** (safe reads, sha-memoized)
   — controller convention resolution is the first consumer; framework detection (DG-10) can be
   the second.
4. **The pack returns findings + advisories, never throws for app-shaped input** — failure
   classification stays with the scanner/policy layer (code-structure: Actions own failure
   classification, services own mechanics).
5. **Unsupported-language diagnostics become per-pack advisories naming the real language**
   (ADR-008 Decision 5): with the PHP pack installed, PHP files are indexed; a missing pack must
   not mislabel the language (the campaign's 3,248 generic diagnostics collapse to correct
   per-language coverage once packs exist).
6. **Suggested evolution (DG-05):** split `extract` into `extractSymbols` (upstream-mapped,
   near-free per language) and per-framework `inventoryRules: FrameworkInventoryRule[]` where a
   rule is `{ id, version, appliesTo(files), inventory(file, tree, access) }` — letting the
   Domain Inventory stage (DG-02/#246) drive rules without language coupling. Keep
   `builtinLanguagePacks` frozen per release for byte-stable evidence.

---

## 4. License-clean fixture strategy for non-TS apps (deliverable 4)

Problem: Arxic's two real fixture apps are TS/JS; a _real third-party_ Laravel app cannot be
committed (license + secrecy), and synthetic mini-apps prove nothing about real shape diversity.

Strategy (implemented + documented):

1. **CI fixture = Arxic-authored Laravel-shaped app**
   (`src/__tests__/fixtures/laravel-app/`): original authorship (MIT, same as repo), composer.json
   with PSR-4 `App\` → `app/`, routes exercising **every shape harvested from the two real apps**
   (listed in §2.3). The end-to-end test asserts the COMPLETE inventory (31 route rows, 25
   handler refs, zero gap advisories) so regressions in expansion rules surface as diffs.
2. **Real-world measurement = local-only corpora, public evidence sanitized:**
   clones live outside the repo (`/tmp/opencode/`); committed evidence is aggregate JSON
   (`docs/evidence/DG-01/{koel,bookstack}-summary.json`) — repo identity + commit SHA + counts +
   diagnostic paths, no source content. Both corpora are themselves MIT, so even the identities
   are unproblematic; for a future proprietary campaign app the same harness emits the same
   aggregate shape with the repo label anonymized.
3. **Shape harvesting is cited**: every fixture route traces to a file:line in koel/BookStack at
   the pinned commits (comments in the fixture files).
4. **Future packs** repeat the pattern: N license-clean authored fixtures per framework +
   measurement harness runs on ≥1 real public app per framework generation (composer-verified).

---

## 5. Measurements on real Laravel apps (deliverable 5)

### 5.1 Corpora (substitution documented)

The campaign monorepo was **not locatable**: `/home/soultransit/devtony/arxic-private/` contains
only the ADR and `gears/`; no `artisan` or `laravel/framework` composer requirement exists
anywhere under `~/devtony` (searched); issues #257–#259 carry no pointer comments. Substituted
public apps, verified at source level:

| Corpus                   | Commit                                     | `laravel/framework` (from composer.lock)        | License | Stars (API) |
| ------------------------ | ------------------------------------------ | ----------------------------------------------- | ------- | ----------- |
| `koel/koel`              | `dfec91ff290509c622ff7cf392fb5e506841ee2b` | **v13.24.0** (Laravel 13 — campaign generation) | MIT     | 17,222      |
| `BookStackApp/BookStack` | `c813c1b3628c0b6bd757c12cadaa56f50724117d` | v12.64.0                                        | MIT     | 18,987      |

Both sit in the campaign's ~340-endpoint band, which was the point of the substitution.

### 5.2 Results (harness: `packages/source-ua-adapter/scripts/measure-laravel.mjs`; summaries committed as `docs/evidence/DG-01/*.json`)

| Metric                                           | koel                                                                                               | BookStack                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| PHP files scanned                                | 1,412                                                                                              | 1,770                                                                                            |
| PHP files indexed                                | 1,412                                                                                              | 1,769                                                                                            |
| **PHP parse failures**                           | **0 (0.0%)**                                                                                       | **1 (0.0565%)** — `resources/views/misc/opensearch.blade.php` (Blade template shipped as `.php`) |
| Endpoint rows (METHOD+URI)                       | **304**                                                                                            | 335                                                                                              |
| Distinct METHOD+URI                              | 304                                                                                                | 326 (9 web↔api collisions — see §5.4)                                                            |
| Handler refs (line-anchored in controller files) | 201                                                                                                | 332                                                                                              |
| `ROUTE-DYNAMIC-REGISTRATION` advisories          | **0**                                                                                              | **0**                                                                                            |
| `HANDLER-UNRESOLVED` advisories                  | 32                                                                                                 | 1                                                                                                |
| Cross-check                                      | 304 = hand-count of call sites (103 verb + 83 resource-expanded + 20 web + 98 subsonic match rows) | 335 rows = 338 `Route::` call sites minus fallback/view/redirect collapses                       |

The koel subsonic file's 49 loop+interpolation endpoints **resolved fully** (literal-array foreach
binding), which is why koel shows zero dynamic gaps — the pattern that motivated the loop
resolution is real in the wild, not a toy.

### 5.3 Version distribution (GitHub code search, `filename:composer.json`, 2026-08-16)

`"laravel/framework": "^N"` public-repo counts: ^9 → 92,416; ^10 → 99,072; ^11 → 136,704;
^12 → 129,536; **^13 → 24,224**. Laravel 13 is real and current-generation, but ^11/^12 dominate —
so the provider-`require` registration style (§5.4) and legacy string controllers remain
load-bearing for years. (Caveat: legacy code-search counts are upper bounds — includes vendored
duplicates — but the relative shape is clear.)

### 5.4 Findings, limitations, dissent

1. **Provider-included route files lose the including group's prefix (measured).** BookStack's
   `mapApiRoutes()` wraps `routes/api.php` in `prefix => 'api'`
   (`app/App/Providers/RouteServiceProvider.php:64-73`); the per-file inventory cannot see that
   group. Effect: 120 api rows unprefixed; 9 METHOD+URI pairs collide with web rows (real URIs
   differ). Koel is unaffected (Laravel 11+ `withRouting` style, prefixes in-file). **DG-05 must
   either resolve provider `require base_path(...)` call sites (two-pass: providers → routes) or
   emit a per-file prefix-gap advisory.**
2. **Declared-but-unimplemented actions are common (koel: 31).** koel registers full `apiResource`
   sets whose controllers implement subsets (verified: `app/Http/Controllers/API/AlbumController.php`
   has only `__construct/index/show/update`). The rows are real routes (Laravel registers them);
   the handlers are ungroundable — exactly ADR-008 Decision 2's `unextracted-with-reason`. Not a
   prototype defect; a product signal.
3. **Inherited handlers unresolved (koel: 1).** `Subsonic\GetAlbumInfoController extends
GetAlbumInfo2Controller {}` — `__invoke` lives on the parent. The prototype does not chase
   `extends`. Cheap to add in DG-05; recorded as a known false-negative class.
4. **The one PHP parse failure is a Blade-as-.php file**, not legacy PHP syntax — tree-sitter-php
   0.23.12 parsed 3,180/3,182 real PHP files clean across both corpora. The ADR-008
   "legacy PHP grammar gap" risk measured **negligible on current-generation apps**; keep the
   advisory path for older corpora (unmeasured — residual uncertainty).
5. **Pre-existing TS-surface note:** koel produced 14 `ARXIC-SOURCE-PARSE-ERROR` on its own
   frontend `.spec.ts` files (tree-sitter-typescript 0.23.2 vs current TS test syntax) — out of
   DG-01 scope but worth a follow-up issue for the TS surface.
6. **Framework-generated routes are not inventoried** (e.g. the Laravel 11+ `/up` health route
   declared via `withRouting(health: '/up')` in koel's `bootstrap/app.php:33`). Runtime crawl
   (stage 2) will observe them; DG-02 should decide whether bootstrap-declared routes join the
   deterministic denominator.
7. **Dissent / uncertainty recorded:** (a) METHOD+URI as the denominator unit double-counts
   PUT/PATCH resource updates by design — `route:list` would show 5 rows for a full apiResource,
   we show 6; the DG-02 denominator definition must ratify one unit. (b) The `^13` code-search
   count includes `^13.`-pinned and unpinned-JS-style matches; treat as order-of-magnitude.
   (c) Route _counts_ were cross-checked arithmetically against call-site hand counts, not
   against a booted `php artisan route:list` (no PHP runtime in this environment) — DG-02/DG-12
   should add that ground truth on a live app.

### 5.5 Bundled-runtime finding (found by CI, fixed inside this slice)

The worker's esbuild bundle declares grammar packages **external by an explicit regex**
(`apps/worker/tsup.config.ts:39`: `/^tree-sitter(?:-javascript|-typescript)?(?:\/.*)?$/`) —
`tree-sitter-php` was not on that list, so the first CI run bundled the native binding loader and
the worker crashed at boot inside the container (`ARXIC-WORKER-RUN-FAILED` with the
`tree-sitter-php/bindings/node/index.js` stack; run 31945782192). Because `apps/worker/**` is
outside this slice's file ownership, the fix shipped here stays inside
`@arxic/source-adapter`:

- the PHP grammar is now loaded **lazily via `createRequire`** (`src/parser.ts`) — bundlers no
  longer inline the native loader, so every runtime boots for every other language;
- a PHP parse in a runtime without the grammar throws `GrammarUnavailableError`, which the
  scanner converts into a **blocked `ARXIC-SOURCE-GRAMMAR-UNAVAILABLE` diagnostic + manifest
  `reason: 'grammar-unavailable'`** — never a silent gap and never a boot crash (unit-tested in
  `php-surface.test.ts`);
- verified by rebuilding the worker bundle locally: it boots to its own run-spec validation
  where the pre-fix bundle crashed on the binding stack.

**DG-05 handoff (2 lines, owner of `apps/worker`):** add `tree-sitter-php` to the tsup externals
regex and to `apps/worker/package.json` dependencies so the worker sandbox carries the PHP
grammar natively; the lazy path then resolves it and the diagnostic disappears.

---

## 6. What this spike did NOT do

- No `extends`-chasing for inherited controller handlers (§5.4.3).
- No two-pass provider-`require` prefix resolution (§5.4.1) — documented, deferred to DG-05.
- No runtime `route:list` ground-truthing (§5.4.7c).
- No PHP call-graph extraction (upstream has it; no Arxic consumer yet).
- Did not extend the language surface beyond PHP; the other 12 upstream extractors remain
  DG-05 work following the same recipe.
- Did not edit ADR-008 (by instruction); this section is the input to its Decision 5 refinement.
- **Unbounded literal-loop product:** nested literal `foreach` expansion multiplies body walks
  (values × values); a hostile 1 MB route file could declare a pathological product and burn CPU.
  Local-tooling threat model makes this P2 hardening for DG-05 (cap iterations per file, then
  advise) — recorded here rather than half-fixed.

## 7. Reproduction

```
# corpora (outside the repo)
git clone https://github.com/koel/koel.git /tmp/opencode/koel
git clone https://github.com/BookStackApp/BookStack.git /tmp/opencode/bookstack
# measurement
npx tsx packages/source-ua-adapter/scripts/measure-laravel.mjs /tmp/opencode/koel koel \
  docs/evidence/DG-01/koel-summary.json
npx tsx packages/source-ua-adapter/scripts/measure-laravel.mjs /tmp/opencode/bookstack bookstack \
  docs/evidence/DG-01/bookstack-summary.json
# tests (real tree-sitter-php engine, no mocks)
npx vitest run packages/source-ua-adapter
```

Committed summaries carry the exact commit SHAs measured; re-running at a newer HEAD may shift
counts.
