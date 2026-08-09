# M1-SCREENSHOT-PRIVACY — staged doc updates (charter §10.2)

Issue: #115 · PR: pending · Disposition: blocked pending human visual review

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| #115 | [M1-SCREENSHOT-PRIVACY] Screenshot pixel privacy | ☑ done after human visual sign-off |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-08-09 | **#115 (M1-SCREENSHOT-PRIVACY) Screenshot pixel privacy implemented.** The shared trace-sanitizer capture Service now composes strict PNG checks, action-owned approved-region/masking policy, adjacent privacy reports, checkpoint binding, and existing canonical trace sanitization for verifier and M0. Assembly and promotion independently reject raw, forged, malformed, polyglot, or mismatched screenshots while preserving prior public output. Non-browser security suites pass; retained real-Chromium evidence remains provisional until independent HUMAN visual inspection. Disposition: blocked pending human sign-off. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Security`

```text
- M1-SCREENSHOT-PRIVACY screenshot pixel privacy (#115): require an explicit action-owned approved-region or masking policy, retain strict adjacent screenshot provenance through the shared trace-sanitization capture Service, and independently gate PNG bytes plus provenance during assembly and promotion.
```

## 4. `VERSION` bump required?

No. This pre-1.0 security hardening composes existing capture and promotion behavior without changing the frozen contracts.

## 5. Evidence pointers

- Real-world proof: `packages/bundle-promoter/src/__tests__/assembly-real-world.test.ts` — real Playwright/Chromium captures against both fixture apps flow through compiler → verifier shared capture Service → assembly.
- Artifacts: `docs/evidence/M1-SCREENSHOT-PRIVACY/` contains only retained approved-region PNGs and adjacent `.privacy.json` reports; raw screenshots, untrusted capture receipts, and raw traces are not retained there.
- **Independent HUMAN visual inspection is REQUIRED.** An LLM/reviewer cannot prove arbitrary pixels are secret-free, so the screenshot-evidence channel is provisional until a human records sign-off.
- Limits: Linux `O_NOFOLLOW` protections are strongest on the proved platform; other platforms use fail-closed checks without an equivalent no-follow guarantee. Source roots must remain quiescent while bounded inventory and retention run.
- Limits: valid IDAT/pixel steganography cannot be mechanically proven absent. Strict PNG structure, canonical provenance, and visual review reduce risk but do not establish arbitrary pixel secrecy.
- Cleanup: purge is limited to fixed action-created `artifacts` and `test-results` roots and their explicitly inventoried files. It never recursively deletes a caller-controlled root.
- Traversal: directory walking is bounded and streaming (`opendir`), with depth, entry, candidate, file-size, and stability limits.
- Gates: typecheck ☐ · recursive typecheck ☐ · lint ☐ · format ☐ · focused tests ☐ · license gate ☐

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                                | Expected disposition                   | Test                                                                                        |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| Screenshot exists without explicit action-owned policy                                                 | blocked                                | `packages/verifier/src/index.test.ts`                                                       |
| Raw, malformed, ancillary-carrier, trailing-data, or polyglot PNG                                      | blocked                                | `packages/playwright-screenshot-privacy/src/png.test.ts`, verifier/M0 sad paths             |
| Missing, forged, malformed, non-adjacent, hash-mismatched, or source-binding-mismatched privacy report | blocked                                | `packages/playwright-screenshot-privacy/src/attestation.test.ts`                            |
| Symlink, non-regular file, unstable inventory, oversized/deep/wide traversal                           | blocked                                | `packages/playwright-screenshot-privacy/src/safe-filesystem.test.ts`, `attestation.test.ts` |
| Raw or non-canonical trace alongside screenshots                                                       | blocked                                | verifier/M0/bundle-promoter sad paths; prior trace-sanitization tests remain intact         |
| Assembly or promotion receives unattested screenshot bytes                                             | blocked; prior public output preserved | `packages/bundle-promoter/src/__tests__/assembly.test.ts`, `sad-paths.test.ts`              |
| Screenshot pixels have not received independent human review                                           | blocked/provisional evidence channel   | this note and `docs/evidence/M1-SCREENSHOT-PRIVACY/README.md`                               |
