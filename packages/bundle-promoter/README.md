# @arxic/bundle-promoter

M0-10 proves freeze → stage → validate → hash → atomic promotion while preserving the prior promoted bundle on every pre-replace failure (ADR §7.2, §14, §15, §21, §23.12).

## Delivery pattern

`freezeBundle()` recursively orders object keys and emits deterministic UTF-8 JSON bytes without adding timestamps. Promotion validates the frozen `BundleManifest` through `@arxic/contracts`, hashes the frozen bytes with SHA-256, writes them to a private staging file, reads the staging file back, and verifies its hash and byte count before publication.

The staging file, lock, public bundle, and last-known-good snapshot are all in the public bundle's directory. This guarantees the final `fs.rename(staging, public)` remains a same-filesystem atomic replacement rather than risking a cross-device rename. Before replacement, the current public file is copied to a private sidecar staging file and renamed to `<public>.lkg`. A failure during staging, validation, hashing, or snapshot creation leaves the public file untouched. After success, `.lkg` contains the previous promoted bytes.

An exclusive `O_EXCL` lock file serializes publishers. `lockTimeoutMs` controls bounded contention retries; its default of zero rejects a concurrent contender immediately with a blocked diagnostic. A process crash can leave a lock requiring operator cleanup; it cannot replace or corrupt the public bundle.

## Layering

`freeze.ts`, `validator.ts`, and `atomic-store.ts` are service capability blocks for deterministic serialization, contract and byte-integrity validation, and filesystem mechanics. `index.ts` is the Actions-style orchestration layer: it owns gate policy, failure classification, operation order, and frozen `PromotionReceipt` construction. `diagnostics.ts` manufactures stable `ARXIC-PROMOTION-*` diagnostics and loop-closes them through the frozen diagnostic validator.

`promote()` implements the frozen `BundlePromoter` interface and throws `PromotionError` with structured diagnostics when blocked. `promoteWithDiagnostics()` exposes the same flow as `{ receipt?, diagnostics }` for orchestration and testing.

## Frozen contracts

The package does not modify or extend `StagedBundle`, `GateResult`, or `PromotionReceipt`. In particular, byte counts are checked internally but are not added to the receipt; the frozen receipt contains only `manifest`, `promotedAt`, `location`, and `checksumSha256`.
