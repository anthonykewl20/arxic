# 1.0-TRANSITION-RECEIPTS evidence

`packages/verifier/src/real-world.test.ts` retained this evidence from two
clean real-Chromium verifier passes against both reference fixture apps. Each
`*.sanitized.trace.zip` is the sanitized Playwright action timeline; its
adjacent `.sanitization.json` records the sanitization provenance. The named
`*-verified-login.masked.png` screenshots have adjacent capture provenance and
mask synthetic persona input and rendered email text.

No raw trace ZIPs are retained. The same suite also proves the structured
HTTP-404 and console-error receipt gate, while the unit sad-paths prove missing,
malformed, and forged receipt rejection.
