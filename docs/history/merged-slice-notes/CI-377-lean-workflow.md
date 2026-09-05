# CI-377-lean-workflow — staged doc updates (charter §10.2)

Issue: #377 · PR: #378 · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #377 | [CI-377] Lean CI: parallelize the monolithic ci job, shard the 19-minute test suite, cache the worker image build | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-04 | **#377 (CI-377-lean-workflow) Lean CI DONE.** The monolithic `ci` job (22m46s wall clock, run 33766937722; Test step 19m03s serializing static/package/fixture gates) became parallel jobs — `static` (lint/typecheck/format/metadata/slice-notes/command-guard), `test` (vitest `--shard` ×4 on isolated runners, `fileParallelism:false` preserved per-runner), `fixture-apps` (real-Mailpit suites + isolated-Testcontainers smoke), `package` (tarball smoke/license/SBOM) — closed by a gate job that keeps the branch-protection check name `ci` (strict) green-iff-all-green, with `worker-image` unchanged as a conditional sibling. Worker Dockerfile reordered manifest-first (BuildKit wildcard COPY flattens — verified; explicit per-package lines; `.npmrc`+`patches/` before install) + buildx `type=gha` layer cache under Actions only. Zero gates removed/skipped/weakened; shard file counts sum exactly to the monolithic total (51+50+50+50 = 201 files); steady-state critical path 7m27s — slowest gate job test(2/4) 7m25s + 2s gate — vs 22m46s baseline (3.05×, CI run 33789403456, all 10 checks pass; note: that run's absolute wall clock was inflated by staggered runner allocation while the 18:15Z account-wide Actions stall recovered — per-job durations are the honest measure). worker-image 3m41s incl. cold-cache image build + verify + sandbox suite. **Next: per integrator.** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### <added|changed|fixed|security|internal>`

```
- CI-377 Lean CI workflow (#377): ci.yml rebuilt as parallel gate jobs (static ‖ 4-shard vitest ‖ fixture-apps ‖ package) closed by the `ci` check-name-preserving gate job — 22m46s → 7m27s critical path with zero gates removed and shard counts summing exactly to the suite total (201 files); worker image gains manifest-first Docker layers + buildx GHA cache so dependency/Chromium layers survive source-only changes.
```

## 4. `VERSION` bump required?

no — CI infrastructure only; no user-observable package change (RELEASES.md: version decided at release time on the v0.1.x lane).

## 5. Evidence pointers

- Real-world proof: the PR's own CI run IS the proof — PR #378 touches `apps/worker/` + `.github/workflows/ci.yml`, so the `changes` filter triggers the worker-image job (cold buildx cache) AND all gate jobs run sharded against the real suite (real Chromium/Docker/Mailpit via per-shard runners). Timing comparison vs baseline run 33766937722 pasted on issue #377.
- Pre-CI proofs: synthetic Docker build of the manifest COPY block (31 package.json land in correct structure, `patches/` present — caught that `test-fixtures/dg12-fabrication-audit` has no package.json and that `.npmrc` must precede install); local `pnpm install --frozen-lockfile` layer build (worker-install-proof image); YAML parse + prettier clean; `bash -n` clean.
- Artifacts: none retained (no UI behavior change; no screenshots applicable — evidence is run timings + per-shard test-file counts, both on the issue).
- Gates: typecheck ☑ · lint ☑ · format ☑ (prettier on changed files; full-repo `format:check` runs in CI static job) · test (sharded full suite in CI) ☑ · license gate ☑ (CI package job)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                        | Expected disposition                                                                                                                   | Test                                                                                                |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Any gate job fails (e.g. lint red)                             | gate job `ci` goes RED (required check blocks merge) — not skipped/pending                                                             | gate step loops over needs.*.result, `exit 1` on any non-success; `if: always()` guarantees it runs |
| `worker-image` skipped (no worker-relevant paths)              | `ci` gate still green (worker-image is not a gate dependency, matching pre-#377 merge semantics where it was never the required check) | `needs: [static, test, fixture-apps, package]` excludes worker-image by design                      |
| A shard fails, others pass                                     | that shard's check red; siblings complete (`fail-fast: false`) so one run shows all failures; gate red                                 | matrix `fail-fast: false` + gate aggregation of `needs.test.result`                                 |
| New workspace package added without a Dockerfile manifest line | worker-image job FAILS at `pnpm install --frozen-lockfile` (fail-closed, not silently stale image)                                     | pnpm frozen-lockfile importer mismatch                                                              |
| `test-fixtures/<data-only dir>` without package.json           | not copied, not a workspace member — build unaffected (proved: dg12-fabrication-audit)                                                 | synthetic manifest build green                                                                      |
| Local (non-Actions) `build-and-verify.sh`                      | plain `docker build`, no GHA cache credentials needed — behavior identical to pre-#377                                                 | `GITHUB_ACTIONS` unset branch of the script                                                         |
