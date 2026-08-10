# @arxic/playwright-screenshot-privacy

This package provides the reusable screenshot privacy mechanics used by generated
Playwright suites, the verifier, M0 and promotion. It is a service layer: the caller's
Action owns policy selection, authorization, failure classification and whether evidence
may be retained or promoted.

Generated suites import the standalone runtime and call `capturePolicyScreenshot`. The
runtime accepts only a canonical action-supplied policy and semantic role/label locators.
It captures either one exact approved region or a page with at least one declared mask,
then emits a PNG and an explicitly untrusted `.capture.json` receipt. It can never emit the
authoritative `.privacy.json` sidecar. Every declared mask must resolve to a bounded nonzero
element set, and a symlinked output directory blocks capture before pixels are written.

The trusted Action independently re-renders and binds every runnable source byte, injects
the policy and per-run correlation, and requires the exact PNG/receipt inventory. Retention
rejects unexpected, missing, malformed, forged or pre-existing artifacts, writes the
authoritative sidecar beside the retained PNG and requires every source image/receipt to be
removed on both success and failure. The inventory traverses every real directory physically
inside the owned test workspace, including local `node_modules` and `.git` trees, without
following symlinks into external dependency trees. Out-of-root and disguised images or sidecars also block.
Retained files use deterministic numeric names; semantic filename words are never treated as a
pixel-privacy signal. Their sidecars map each numeric file back to the exact bound capture call.
Partial-write or cleanup failure removes promotion-eligible output and reports a blocked result.
Runnable symlinks, source drift and raw screenshot APIs outside the service-owned runtime fail
closed.

PNG parsing is bounded and strict: exact signature and chunk order, only IHDR/IDAT/IEND,
CRC validation, no trailing/polyglot bytes, bounded dimensions/chunks/inflation and exact
scanline/filter lengths. The zlib engine must consume the complete concatenated IDAT stream.
Assembly and promotion can call `validateScreenshotArtifactSet`
to re-check PNG bytes, adjacent provenance and every bound source artifact independently.
Rejecting every ancillary chunk prevents text, metadata or split payloads from sharing an
attested PNG. It cannot detect a covert payload deliberately encoded into otherwise valid
IDAT scanlines or pixels; that limitation is outside mechanical PNG conformance.

The attestation proves that the recorded policy, exact runnable sources and capture receipt
produced the retained bytes. It does not prove arbitrary pixel secrecy. An approved region
can itself contain sensitive content, and masks cover only declared locators. `attestedBy`
and policy authority are provenance labels, not signatures; correlation is freshness data,
not authentication or secrecy.

Pinned upstream evidence:

- [Playwright screenshot masking at `26a9e470`](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/screenshotter.ts#L272-L304)
- [libpng read validation at `95ab3fd`](https://github.com/pnggroup/libpng/blob/95ab3fdca83ea294efd3b092e9a53c5a39886444/pngrutil.c)
- [Node zlib `maxOutputLength` at `20da4ae`](https://github.com/nodejs/node/blob/20da4aeadabc5b0a01e3fcf520f91df8285c68a2/doc/api/zlib.md#L839-L840)
- [Node zlib `info` and `bytesWritten` at `20da4ae`](https://github.com/nodejs/node/blob/20da4aeadabc5b0a01e3fcf520f91df8285c68a2/doc/api/zlib.md#L1019-L1029)
