# M1 trace-sanitization evidence

`packages/verifier/src/real-world.test.ts` generated these artifacts against the
real Next.js reference app and Express vulnerable app in pinned Playwright
1.62.1 Chromium.

- `*-sanitized.trace.zip` and adjacent sidecars are independently inspected
  privacy-preserving action timelines. They contain two fixed `.trace` members
  and no network, stack, resource, screenshot, source, or arbitrary binary
  members.
- `*-sanitized-trace-viewer.png` shows each timeline loaded in the pinned Trace
  Viewer without processing errors.
- `*-verified-login.masked.png` was captured by Playwright with explicit locator
  masks over credential and rendered identity fields. The adjacent provenance
  records the capture policy and hash; pixels were not post-processed.

Manual visual review found no credential, session identifier, or visible
identity value in the retained screenshots. This is a reviewer observation,
not an automated OCR claim.
