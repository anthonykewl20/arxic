# RELEASE-PACKAGING — staged doc updates (charter §10.2)

Issue: P0-2/P0-3 · PR: pending · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| P0-2/P0-3 | [RELEASE-PACKAGING] Publishable npm CLI and release automation | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-08-13 | **P0-2/P0-3 (RELEASE-PACKAGING) publishable CLI packaging DONE.** tsup bundles the private source-only workspaces into the public `arxic` package while external runtime engines remain npm dependencies; the emitted executable reports 0.2.0 and serves top-level and run help. Tag releases retain the GitHub Release and publish to npm after it when `NPM_TOKEN` is configured. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```text
- RELEASE-PACKAGING (P0-2/P0-3): package the CLI as the public `arxic` npm executable and publish it after successful tagged GitHub releases when the npm token is configured.
```

## 4. `VERSION` bump required?

No. The package adopts the existing 0.2.0 release version from `VERSION`.

## 5. Evidence pointers

- Real-world proof: `apps/cli/dist/cli.js` — the actual tsup artifact ran under Node and returned 0.2.0 for `--version`, plus valid output for `--help` and `run --help`.
- Artifacts: ignored build output `apps/cli/dist/cli.js`; `npm pack --dry-run` contained only README.md, dist/cli.js, and package.json.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (106 files, 921 passing) ☑ · license gate (806 packages, 0 rejected) ☑

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                           | Expected disposition | Test                                                                                                                                                                  |
| ------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace imports leak into the published package | blocked              | tsup build bundles every `@arxic/*` import and `npm pack --dry-run` contains no workspace source package                                                              |
| Runtime engine is unsafe to bundle                | blocked              | tsup externalizes Crawlee, Playwright, Testcontainers, ast-grep, and native Tree-sitter dependencies; the built executable loads and serves all help/version commands |
| npm credentials are unavailable                   | blocked              | publish step is skipped when `NPM_TOKEN` is empty, while the preceding GitHub Release remains intact                                                                  |
