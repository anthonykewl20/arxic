# @arxic/playwright-trace-sanitizer

This package owns the shared, fail-closed mechanics for converting a Playwright
1.62.1 trace ZIP into a privacy-preserving action timeline. Verifier and
promotion Actions decide truth state and eligibility; they call this service and
block whenever its structured result is not `ok`.

The output is deliberately not a replay-, DOM-, screenshot-, source-, stack-, or
network-complete trace. It contains only fixed `trace-NNN.trace` members, fixed
context metadata, completed actions from the pinned class/method pair map,
empty params, remapped call IDs, and synthetic ordering timestamps. Network and
frame snapshots, resources, screencasts, attachments, logs, errors, results,
stdio, sources, stacks, input payloads, and unrecognized events are omitted.
The archive must contain at least one context that identifies Chromium exactly.
Playwright's standard `test.trace` context is retained with its pinned neutral
`browserName: ""` only when its origin is `testRunner` and it contains solely
`Test.*` actions; it cannot establish the archive-level Chromium requirement by
itself. Other or missing browser identities fail closed.

Input ZIPs and JSONL are bounded by archive, entry, expansion, compression,
line, depth, node, string, value, and action limits. Unsafe paths, normalized
duplicates, malformed/orphan events, unknown-only members, and residual or
non-canonical output fail closed. Output ZIPs use fixed, deterministically
ordered STORED entries and fixed timestamps and attributes. Inspection rebuilds
that container and requires exact byte equality; it also requires every JSONL
member and the sidecar itself to equal their canonical encodings byte for byte.

Every output has an adjacent `.sanitization.json` sidecar containing source and
output SHA-256/size records, canonical logical members, output-derived action
counts, and residual-scan counts. The source digest is capture-reported
provenance, not independent source-origin authentication; raw bytes are deleted
after projection, so the sidecar intentionally makes no unverifiable claim
about dropped-input counts. `inspectPlaywrightTrace()` independently reopens
bounded bytes, reconciles the retained action counts, validates canonical
sidecar/container/member bytes, re-applies the strict projection contract, and
returns the validated bytes to callers so promotion does not trust the sidecar
or re-read unbounded files.

Raw trace ZIPs must never be retained, attached, assembled, or promoted. A
retained timeline without its matching sidecar is ineligible evidence. Capture
callers use `sanitizeCapturedPlaywrightTrace()`, which removes the raw source on
success. If unlink fails, it attempts truncation, removes the eligible output
and sidecar, and returns the primary sanitizer failure plus a separate cleanup
disposition (or `TRACE_SOURCE_CLEANUP_FAILED` after otherwise successful
projection); callers must classify either result as blocked.

The package also owns the narrow, bounded trace-carrier classifier used at
screenshot artifact boundaries. Capture reads each candidate once, rejects a
raw Playwright ZIP regardless of its extension, requires a complete decodable
PNG with no trailing container, and rejects complete raw trace bytes carried
directly in one or more ancillary chunk payloads. Callers retain the exact
validated buffer under a generated numeric name; they do not reopen or copy the
source path. This is a type-confusion boundary, not screenshot attestation: it
does not decode semantic metadata carriers or establish privacy for valid IDAT
or pixel content. #115 owns that separate screenshot privacy service. Verifier
and M0 capture are transactional: any later artifact failure removes the whole
run destination before the Action reports the run blocked.
