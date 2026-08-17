# @arxic/ast-grep-adapter

M0-08 proves that versioned Next.js and Express auth rule packs can cross the real ast-grep CLI process boundary and emit frozen `EvidenceRef` and `Diagnostic` events for committed source.

## Seams and layering

`runner.ts`, `packs.ts`, and `git.ts` are service capability blocks: they load and validate packs, execute an argument-array-only `execFile` boundary, parse JSON-stream records, and resolve committed provenance. `interpret.ts` is the Actions-style interpretation layer: it selects framework conventions, connects route → handler → guard, and classifies missing links and regex fallback diagnostics.

All static interpretation is advisory `hypothesized` evidence. Final truth-state ownership is in `@arxic/orchestrator-langgraph` (#17); this package never assigns `verified` (ADR §2, §9 stage 3, §12.1/§12.2, §23.14).

## CLI

The adapter declares `@ast-grep/cli` `^0.45.0` (MIT) as its runtime dependency. pnpm is configured to symlink native executables, so the compatibility command works:

```sh
pnpm --filter @arxic/ast-grep-adapter exec ast-grep --version
```

Version 0.45.0 warns that `sg` is deprecated and delegates to `ast-grep`. The adapter resolves the installed native `ast-grep` binary directly, avoiding shell interpolation and pnpm's JavaScript shim. Set `ARXIC_SG_BIN=/absolute/path/to/ast-grep` or pass `sgBinary` to test another engine build.

`@ast-grep/cli` 0.45.0 has a postinstall that links its prebuilt optional-dependency binary, so pnpm's explicit `allowBuilds` approval is required. No source compilation occurs.

## API

`new AstGrepAdapter({ packs, sgBinary?, now? })` exposes `scan({ revision, features?, framework? })` and an `AsyncIterable` `index()` method. The optional `framework` is the caller's pack-selection policy input and runs only packs whose declared framework name matches. Since DG-10 (#254) pack `framework.versions` ranges are NORMATIVE: `framework-gate.ts` detects framework+version from source evidence (lockfile → manifest → imports) and enforcement at selection accepts/rejects/waives with `ARXIC-RULES-FRAMEWORK-*` diagnostics — name-only matching is corroboration, never a version decision.

A dirty or mismatched Git revision, malformed pack/rule, process failure, parse failure, or duplicate rule id fails closed. Conflicts are checked globally across loaded packs before framework selection. Source refs use committed file bytes and rule ids shaped as `<pack>/<rule>@<semver>`.

The regex detector is deliberately narrow and labeled `ARXIC-RULES-FALLBACK`; it emits no primary evidence (ADR §6.1).
