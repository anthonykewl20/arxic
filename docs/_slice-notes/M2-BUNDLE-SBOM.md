# M2-BUNDLE-SBOM — staged doc updates (charter §10.2)

Issue: no dedicated issue (refs ADR §23.13) · PR: integrator to assign · Disposition: mixed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| §23.13 | [M2-BUNDLE-SBOM] Add CycloneDX SBOM to promoted bundle | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-08-12 | **M2-BUNDLE-SBOM (refs §23.13) DONE.** Bundle assembly accepts caller-generated CycloneDX JSON, deterministically strips volatile UUID/timestamp metadata, canonicalizes keys/arrays, scrubs SBOM emails, writes `sbom.cdx.json`, and includes its digest in `checksums.sha256`. Real `pnpm sbom` output passed the unchanged seven-pattern redaction gate in bundles replayed twice through real Chromium against both fixture apps. Raw pnpm output remains non-byte-deterministic beyond UUID/timestamp (dependency-edge attribution varied), so fully reproducible bytes are observed but not guaranteed. Gates: 104 files / 899 tests; license gate 0 rejected. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Added`

```text
- M2-BUNDLE-SBOM (refs ADR §23.13): added caller-supplied, sanitized CycloneDX `sbom.cdx.json` to promoted bundle assembly and its SHA-256 inventory; real pnpm SBOMs passed the unchanged redaction gate in real-Chromium bundle proofs for both fixture apps.
```

## 4. `VERSION` bump required?

yes → 0.2.1, because the promoted bundle layout is user-observable per RELEASES.md

## 5. Evidence pointers

- Real-world proof: `packages/bundle-promoter/src/__tests__/assembly-real-world.test.ts` — pnpm 11.17 generated two real CycloneDX SBOMs; Playwright 1.62.1 compiled and replayed login twice in real Chromium against `reference-auth-app` and `vulnerable-auth-app`, assembled the sanitized SBOM, parsed it, independently rehashed it, and passed `scanBundleForSensitiveData`.
- Artifacts: run-local bundle, SBOM, screenshots, sanitized traces, and reports were created in per-test temporary directories and removed after the test; no raw trace ZIP or generated root SBOM was retained.
- Redaction finding: the real pnpm SBOM tripped only `email-address`, from repeated `git@github.com` SSH VCS URLs (not maintainer email fields). Assembly replaces any non-test email with `redacted@example.test` before canonical serialization. The other six gate patterns remain unchanged and fail closed; a planted password literal proves the scanner still rejects the assembled SBOM.
- Determinism finding: consecutive raw SBOMs differed in `serialNumber`, `metadata.timestamp`, array order, and occasionally pnpm dependency-edge attribution. The transform strips the UUID/timestamp and canonicalizes keys/arrays; because pnpm sometimes emits semantically different dependency edges, byte identity across independent generations remains a known residual.
- Production wiring: `BundleAssemblyInput.sbom` remains optional for compatibility. No production caller currently invokes `assembleBundle`; the future CI/build assembly caller MUST pass generated SBOM bytes to satisfy §23.13.
- Gates: `pnpm -r typecheck` passed · `pnpm lint` passed · `pnpm format:check` passed after this note · `pnpm test` (104 files, 899 tests) passed · license gate (782 packages, 0 rejected) passed

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                           | Expected disposition                                                                                        | Test                                                                                                                             |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| CycloneDX contains a non-test email                               | scrubbed before assembly; run-local bytes remain observed until normal deterministic verification/promotion | `assembly.test.ts` — `sanitizes sensitive CycloneDX content before checksumming the SBOM`                                        |
| CycloneDX contains a password literal                             | blocked by the unchanged redaction gate                                                                     | `assembly.test.ts` — `leaves non-email secrets visible to the unchanged redaction gate`                                          |
| SBOM is malformed JSON                                            | blocked at the assembly caller boundary before prior output changes                                         | `assembly.test.ts` — `rejects malformed SBOM input before changing prior bundle output`                                          |
| Caller omits optional SBOM                                        | observed legacy bundle assembly, not §23.13-complete                                                        | Existing assembly callers/tests continue without an SBOM; production wiring is explicitly deferred to the future build/CI caller |
| Consecutive pnpm generation emits volatile or graph-varying bytes | observed non-determinism; never promoted as a reproducibility claim                                         | `assembly-real-world.test.ts` proves raw outputs differ and that volatile UUID/timestamp fields are removed                      |
