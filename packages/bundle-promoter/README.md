# @arxic/bundle-promoter

M0-10 proves freeze → stage → validate → hash → atomic promotion while preserving the prior promoted bundle on every pre-replace failure (ADR §7.2, §14, §15, §21, §23.12).

## Delivery pattern

`freezeBundle()` recursively orders object keys and emits deterministic UTF-8 JSON bytes without adding timestamps. Promotion validates the frozen `BundleManifest`, `Workflow`, and `EvidenceIndex` through `@arxic/contracts`; resolves every workflow and transition evidence ref with the matching evidence kind; requires workflow id and truth state to agree; and requires manifest file hashes to exactly match staged artifact refs. A `verified` claim additionally requires the exact clean-run set, only passed gates including exactly one verifier gate, no blockers, and complete verified coverage. It then hashes the frozen bytes with SHA-256, writes them to a private staging file, reads the staging file back, and verifies its hash and byte count before publication.

`projectVerifiedBundle()` is the reusable immutable projection mechanic called by action owners after deterministic verification. Its input requires the action-owned gate results. It rejects contradictory input bytes, incomplete runs, failed or missing verifier gates, and artifact-path hash conflicts; on success it projects the verifier-owned status, run records, gate, coverage, and artifact hashes into one coherent bundle. It does not classify verification, manufacture evidence provenance, sanitize artifacts, or repair contradictory identity.

The staging file, lock, public bundle, and last-known-good snapshot are all in the public bundle's directory. This guarantees the final `fs.rename(staging, public)` remains a same-filesystem atomic replacement rather than risking a cross-device rename. Before replacement, the current public file is copied to a private sidecar staging file and renamed to `<public>.lkg`. A failure during staging, validation, hashing, or snapshot creation leaves the public file untouched. After success, `.lkg` contains the previous promoted bytes.

An exclusive `O_EXCL` lock file serializes publishers. `lockTimeoutMs` controls bounded contention retries; its default of zero rejects a concurrent contender immediately with a blocked diagnostic. A process crash can leave a lock requiring operator cleanup; it cannot replace or corrupt the public bundle.

## Layering

`freeze.ts`, `validator.ts`, `verified-projection.ts`, and `atomic-store.ts` are service capability blocks for deterministic serialization, cross-object and byte-integrity validation, immutable verifier-result projection, and filesystem mechanics. `index.ts` is the Actions-style orchestration layer: it owns gate policy, failure classification, operation order, and frozen `PromotionReceipt` construction. `diagnostics.ts` manufactures stable `ARXIC-PROMOTION-*` diagnostics and loop-closes them through the frozen diagnostic validator.

`promote()` implements the frozen `BundlePromoter` interface and throws `PromotionError` with structured diagnostics when blocked. `promoteWithDiagnostics()` exposes the same flow as `{ receipt?, diagnostics }` for orchestration and testing.

Before assembly or promotion, `trace-artifact-gate.ts` classifies bounded artifact bytes rather than trusting `ArtifactRef.kind` or an extension. ZIP content is eligible only as an independently inspected sanitized Playwright action timeline with its exact adjacent sidecar. Screenshots must be structurally complete, bounded, decodable PNGs with no trailing payload or complete raw-trace ZIP carried directly in one or more ancillary chunk payloads; isolated ZIP-magic bytes are not treated as a container. The gate returns the validated bytes so assembly does not perform a second unbounded or time-of-check/time-of-use read. This finite content-classification boundary does not decode semantic metadata carriers or attest valid IDAT/pixel content, metadata privacy, or steganography—#115 owns the separate screenshot privacy boundary. Any mismatch preserves prior output/public bytes.

## Real-world proof

`src/__tests__/promotion-real-world.test.ts` parameterizes the same compile → two-pass real-Chromium verification → promotion → blocked subsequent promotion flow over both entries in `FIXTURE_APPS`. It asserts the verifier-confirmed staged workflow and manifest agree, retains named screenshots and traces, injects a real pre-replace LKG snapshot failure, and compares the prior public bundle bytes exactly. Per-app facts remain data in `@arxic/real-world-testkit`; no application-name branch exists in the proof or promoter.

## Frozen contracts

The package does not modify or extend `StagedBundle`, `GateResult`, or `PromotionReceipt`. In particular, byte counts are checked internally but are not added to the receipt; the frozen receipt contains only `manifest`, `promotedAt`, `location`, and `checksumSha256`. Artifact eligibility and trace sanitization remain upstream responsibilities; this integrity gate does not make a raw trace safe to retain or publish.
