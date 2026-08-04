# Changelog

All notable changes to Arxic are documented here. Every merged slice adds an
entry - this file is NEVER out of sync with main (see engineering-charter.md
section 8 and RELEASES.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!-- Add new entries under [Unreleased]. One entry per merged slice. Use verbs: added/changed/deprecated/removed/fixed/security/internal. -->

### added

- M0-05 Adapter interfaces contract freeze (#6): the 7 ADR §10.5 TS interfaces (`SourceIndexer`/`SurfaceDiscoverer`/`FixtureProvider`/`WorkflowPlanner`/`WorkflowCompiler`/`WorkflowVerifier`/`BundlePromoter`) + minimal supporting types in `@arxic/contracts`, reusing the frozen #2–#5 types. **Completes M0 goal 1: contract freeze** — `@arxic/contracts` is now the frozen capability boundary. Adapters return contracts, not upstream types — enforced by a **compile-time `@ts-expect-error` type test** (`adapters.test-d.ts`, typechecked by `tsc`, not run by vitest) that turns the gate red if an interface is widened to accept an upstream type. `VerificationResult.outcome` = the 5 `TruthState`s (no 6th "flaky" state — flakiness is verifier-internal #21, derivable from `runs[]`). Supporting types are minimal auxiliary scaffolding (refinable as adapters land). Boundary-double runtime test exercises all 7 interfaces through their typed contracts.
- M0-04 Bundle manifest contract freeze (#5): `schemas/manifest/manifest.schema.json` (2020-12) + AJV validator + TS types (`BundleManifest` + sub-types) in `@arxic/contracts`, encoding ADR §14 + the issue #5 field list (schema/bundle versions, workflow id+status, repo+commit, `appBuildDigest`, environment, generator/model, dependencies, verification runs+timestamps, `fileHashes`, `gateResults`, `blockers`, frozen coverage `denominator` per §11, `runId`). `blockers` inline the frozen Diagnostic shape; a loop-closing test proves a manifest blocker validates via `validateDiagnostic` (#4). Sad-paths (missing digest/commit/hashes, gate-missing, denominator-invalid, bad lengths, blocker `severity:"verified"`, extra property) + tautology guard. **Intentional boundary:** cross-field totals (counts=denominator, runs=requiredRuns) + denominator-after-freeze immutability → coverage (#23) / bundler (#24).
- M0-03 Diagnostics contract freeze (#4): `schemas/diagnostics/diagnostics.schema.json` (2020-12) + AJV validator + widened `Diagnostic`/`DiagnosticSeverity` types in `@arxic/contracts`, encoding ADR §10.4. **`severity` = the four non-`verified` truth states** (`hypothesized`/`observed`/`contradicted`/`blocked` — a diagnostic is never a verified gate-pass; `verified` is a gate outcome); `code` pattern `^ARXIC-[A-Z0-9][A-Z0-9-]*$`; `evidenceRefs` accept arbitrary refs (ADR uses `config:idp-provider`). **Closes the loop:** a contract test dynamically iterates every exported `ARXIC-*` code and validates each as a frozen Diagnostic code (fails if a future code is malformed). Sad-paths (missing field, unknown severity incl. `verified`, malformed code, extra property) + tautology guard.
- M0-02 Workflow v1 IR contract freeze (#3): `schemas/workflow/workflow.schema.json` (2020-12) + AJV validator + TS types (`Workflow`, `WorkflowTransition`, `TruthState`) in `@arxic/contracts`, encoding ADR §10.3 + ADR-002. **Key enforcement: `status:"verified"` is REJECTED unless every required transition carries runtime (`run:`) evidence** — the contract-level realization of "an LLM may never assign verified" (ADR §2/§15/ADR-002 Evidence gate). Transitions are `required:true` by default; an optional (`required:false`) transition is non-blocking. Five truth states; confidence is descriptive-only (non-promotable). Stable diagnostics `ARXIC-WORKFLOW-*`. Sad-paths first + tautology guard; the ADR §10.3 password-reset literal is the independent positive proof.
- M0-01 EvidenceRef contract freeze (#2): frozen JSON Schemas (2020-12) at `schemas/evidence/{evidence-ref,source-revision,evidence-index}.schema.json` + AJV 2020-12 strict validators + hand-written TS types in `@arxic/contracts`. `EvidenceRef` = `source|runtime|document` discriminated union (ADR §10.2); `SourceRevision` (ADR §10.1: 40-hex `commit` + `dirty` + `submodules`); `evidence/index.json` = `{id→EvidenceRef}` with id grammar `(src|run|doc):subject[:qualifier]` (ADR-002). `startLine≤endLine` enforced schema-pure via AJV `$data`. Stable diagnostics `ARXIC-EVIDENCE-*` (full Diagnostics schema deferred to #4). Sad-paths first (missing fields, unknown kind, malformed sha/commit/uri/timestamp, range, id grammar, empty index) + a tautology guard (expected values are ADR literals, not validator echoes). **Scope boundaries:** runtime network/console policy gating → #21; dirty-tree blob-link manufacturing → #8 (deferred by design — the contract is structural).
- M0-00 tooling bootstrap (#1): per-package `tsconfig.json` + `typecheck` script across all 16 workspace packages; root `pnpm typecheck:packages` (`pnpm -r typecheck`); ESLint `no-restricted-syntax` ban on `it.only`/`test.only`/`*.skip`/`xit`/`xdescribe`/`xtest` (ADR §13.1 — no skip/fixme/only); `.env.example` runtime-config stub. New structural test (`packages/contracts/src/__tests__/workspace-contracts.test.ts`) guards the per-package tooling contract by reading real `package.json`/`tsconfig.json` from disk.
- M0 test foundation: vitest + AJV wired in; `pnpm test` now runs real tests (non-vacuous). Seed AJV contract-validation test in `packages/contracts/src/__tests__/` (the pattern for #2–#5). TypeScript switched to Bundler module resolution. `pnpm-workspace.yaml` approves the esbuild build.
- opencode skills + guardrails installed and mandated: `code-structure` + `evidence-driven-testing` (automatic), `global-agent-guardrails` (repo `command-guard` plugin + skill), `remind` (`/remind`, on-demand). Registered via `opencode.json`; mandated in `AGENTS.md` + charter §9. CI runs the guard test.
- `SECURITY.md` disclosure SLA (ack ≤7d, assessment ≤14d, 90-day coordinated-disclosure window), contact path, explicit in/out-of-scope.
- ADR-002 (`docs/adr/002-evidenceref-resolution.md`): evidence references are opaque IDs resolved via `evidence/index.json`; defines "required transition" semantics and the SourceRevision schema home. Resolves the §10.2 vs §10.3 contract ambiguity.
- Filed 5 audit-driven issues (#40 ModelAdapter, #41 policy engine, #42 stage-4 inference, #43 stage-8 exploration, #44 attestation-acceptance); split #13; added §23.14 adapter-contract-suite acceptance to #6/#8/#10/#16/#19/#20; encoded ADR-002 scope in #2/#3; filled real-world-proof + layering in #1–#14. Totals now M0=17, M1=15 (32 total).

### changed

- Added a public summarized ADR `docs/adr/001-arxic-architecture.md` (architecture + contracts + truth states; the detailed assembly recipe is redacted). The detailed internal ADR is local-only; all public references point to the summary.
- `CONTRIBUTING.md` prerequisites corrected to Node.js 22+; how-it-works aligned to the evidence-discovery model.
- Confirmed **trunk-based** branching (no `dev`/`release` branch); documented in `CONTRIBUTING.md` and `docs/SYNC.md`.
- Repository is **PRIVATE during pre-1.0 development** (history still contains pre-mask content, visible only to the owner). Branch protection is **off** (free-tier limit for private repos) → CI enforcement is **discipline-based** (merge only when `ci` is green); re-enable protection on go-public/Pro. A history purge will be performed before the repository is made public.
- Test stack on vitest 3.x (`@vitest` bumped 2→3).

### removed

- Removed vendored upstream reference code from the repository — the product ships only Arxic-authored code (no upstream source is tracked). (Audit: pin drift / license hygiene.)
- Removed all internal references to the upstream reference collection from the public docs and configs.

### fixed

- `release.yml` now declares `permissions: contents: write` and guards against version mismatch (`tag == VERSION == package.json`) and a premature `0.0.0` release.
- CI now asserts `VERSION == package.json` and that `CHANGELOG.md` has an `[Unreleased]` section.
- Bumped `@types/node` to ^22; clarified `LICENSES/README.md`; `.gitignore` excludes `*.orig`.
- Public doc accuracy: README (5 truth states, correct milestone exits), ADR-001 marked Accepted + fixed broken table row, NOTICE/SECURITY/RELEASES/GOVERNANCE accuracy, schema READMEs tense, charter §8 PR-only wording + §1 layering note.

### internal

- ADR-003 (`docs/adr/003-m0-source-only-build.md`): M0 is **source-only (no emit)** — packages consume each other via `main: src/index.ts`; the gates are typecheck/lint/test, with no `build`/`dist`. Resolves #1's `pnpm -r build` line as deferred to when a package needs to ship a published artifact.
- Bootstrap workspace: monorepo layout (ADR §18), pnpm workspaces + tsconfig/eslint/prettier, MIT license + NOTICE.
- Canonical end-to-end architecture diagram in ADR §8.
- `docs/engineering-charter.md` (TDD red-first, Actions/Service layering, sad-path-first, real-world proof, slice-completion ritual).
- `docs/SYNC.md` living progress bookmark.
- GitHub milestones M0/M1, area labels, issue templates.
- Release-ready: CONTRIBUTING/CODE_OF_CONDUCT/SECURITY/SUPPORT/GOVERNANCE + expanded README.
- Versioning: `VERSION` + `RELEASES.md` + always-synced `CHANGELOG.md` (charter §8 + PR template require a CHANGELOG entry + VERSION sync per slice).
- CI + release workflows, Dependabot, CODEOWNERS.
- `.gitattributes` (eol=lf); Node >=22 (pnpm 11 requirement).
