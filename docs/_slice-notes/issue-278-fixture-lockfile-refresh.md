# issue-278-fixture-lockfile-refresh — staged doc updates (charter §10.2)

Issue: #278 · PR: (this slice's PR) · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #278 | [issue-278-fixture-lockfile-refresh] [ops] Remediate the 14 lockfile-keyed Dependabot alerts in the campaign-next fixture | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-18 | **#278 (issue-278-fixture-lockfile-refresh) fixture lockfile security refresh DONE.** campaign-next fixture lockfile REAL-regenerated with repo-pinned corepack pnpm@11.17.0 (`install --lockfile-only`, real registry): next 16.2.11 / postcss 8.5.26 (≥8.5.23 floor) / sharp 0.35.3 (≥0.35.0 floor), security floors recorded in fixture pnpm-workspace.yaml (pnpm 11 settings home — package.json `pnpm` fields are no longer read; CCR posted+applied on #278 with OBSERVED evidence) and mirrored in package.json `pnpm.overrides` (pnpm ≤10); DG-10 expected versions now DERIVED from the fixture manifest+lockfile at test time (zero hardcoded 16.2.x literals in fixture-coupled assertions) with a new AC-3 coherence test (red on manifest-without-lockfile drift — proved red-first against a planted 16.2.11-manifest/16.2.6-lockfile mismatch: 6 tests red); precedence test strengthened (lockfile version + tier named in the rejection, lying manifest's 15.4.1 asserted absent); fixture README provenance refreshed (original lockfile preserved at baseline SHA 8cf21e6, sha256 8d0775bd…; dir name KEPT — docs/evidence/DG-10/README.md:8 references the path). 14 lockfile-keyed Dependabot alerts expected to auto-resolve post-merge (G-4/G-5 poll pending). **Full `pnpm test` green.** Next: owner merge + Dependabot rescan verification. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### <added|changed|fixed|security|internal>`

```
- issue-278-fixture-lockfile-refresh fixture lockfile security refresh (#278): the campaign-next DG-10 evidence fixture's pnpm-lock.yaml is regenerated with the repo-pinned pnpm against the real registry past the Dependabot floors — next 16.2.11, postcss 8.5.26, sharp 0.35.3 — with the floors durably recorded (fixture pnpm-workspace.yaml for pnpm 11 + mirrored pnpm.overrides for pnpm ≤10) and the original campaign lockfile preserved in git history at 8cf21e6; framework-gate expectations now derive from the fixture manifest/lockfile at test time (incl. a manifest↔lockfile coherence test, red on the manifest-bumped-without-lockfile drift that caused the alerts), and the lockfile-outranks-manifest precedence assertion is strengthened. Post-merge, all 14 lockfile-keyed Dependabot alerts on the fixture auto-resolve.
```

## 4. `VERSION` bump required?

no — inert test-fixture hygiene; no runtime surface, not user-observable per RELEASES.md.

## 5. Evidence pointers

- Real-world proof: G-3 regen (real `corepack pnpm@11.17.0 install --lockfile-only`, real npm registry, temp copy; committed lockfile byte-identical sha256 `094212ea1123dede8ec722eed1c0752766e7262127216985b7e40c68d17a3149`) + `packages/ast-grep-adapter/src/__tests__/framework-gate.test.ts` (20 tests: derived-version assertions, AC-3 coherence, strengthened precedence) — red-first: 6 tests red on planted 16.2.11-manifest/16.2.6-lockfile mismatch, 20/20 green on the refreshed fixture.
- Artifacts: G-3 assert script output (next 16.2.11 / postcss 8.5.26 / sharp 0.35.3, all occurrences ≥ floors) pasted in issue #278 EVIDENCE comments; original lockfile digest `8d0775bd…ecf8` recorded in the fixture README.
- Gates: typecheck ☐ · lint ☐ · format ☐ · test (full suite) ☐ · license gate ☐ — see issue #278 EVIDENCE comment for the filled-in table.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                            | Expected disposition                                                                                      | Test                                                                                  |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Manifest bumped past the lockfile (the #274-alone state)                           | blocked — AC-3 coherence test + every derived assertion red                                               | `framework-gate.test.ts` "fixture coherence…" (planted-mismatch run: 6 red, OBSERVED) |
| Lying in-range manifest masking an out-of-range lockfile                           | blocked — rejection names the lockfile resolution + tier, never the manifest's version                    | `framework-gate.test.ts` "lockfile outranks a contradicting manifest…" (strengthened) |
| Waiver for the right version but a stale pack range                                | blocked — waiver voided, rejection stands                                                                 | `framework-gate.test.ts` "waiver abuse: … different pack range" (version now derived) |
| Floors dropped/ignored at regen time (pnpm 11 ignoring package.json `pnpm` fields) | blocked — G-3 scripted floor asserts fail (OBSERVED: 8.4.31/0.34.5 without pnpm-workspace.yaml overrides) | G-3 assert script (red/green runs recorded in issue #278)                             |
