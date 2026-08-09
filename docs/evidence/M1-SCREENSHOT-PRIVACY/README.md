# M1 screenshot privacy proof

This directory contains the promotion-shaped screenshot evidence produced by two clean
Chromium runs against each canonical fixture app. Each PNG is an approved-region capture
of one exact accessible heading and has an adjacent authoritative `.privacy.json` sidecar.
The untrusted capture receipts and all source capture files were removed before assembly.

| App                   | Runs | PNG SHA-256                                                        | Reviewed region                    |
| --------------------- | ---: | ------------------------------------------------------------------ | ---------------------------------- |
| `reference-auth-app`  |    2 | `cb77c1fb9c21e2a8f2b64bcf75395f9c4c0e1dba3957a60c98585e0b42212cf0` | `Reference Auth App` heading only  |
| `vulnerable-auth-app` |    2 | `25098bbb4f3f1ab632965d6a554b9f6be5216ed55286d34da4f797967d24ff38` | `Vulnerable Auth App` heading only |

**Provisional evidence channel — independent HUMAN visual inspection is REQUIRED before
publication.** Mechanical validation and an LLM review cannot prove arbitrary pixels are
secret-free. No human visual-review sign-off is recorded yet. Both repeats produced the same
pixel hash for their app, while their sidecars have distinct per-run correlation data.

The sidecar binds the retained PNG to the canonical capture policy, exact compiled spec,
service-owned capture runtime, fixture and Playwright config. `attestedBy` identifies the
mechanical action that performed those checks; it is not a signature. Likewise, the policy
authority and correlation value are declared provenance and freshness data, not proof of
authorization, authentication or secrecy.

The control establishes policy-compliant capture mechanics and bounded provenance. It does
not prove arbitrary pixel secrecy: text inside an approved region could still be sensitive,
and visual review remains necessary before publication. A masked-page policy can only prove
that its declared semantic masks were applied, not that every sensitive pixel was known.
Canonical parsing rejects every PNG ancillary chunk and any trailing bytes, but neither the
parser nor visual inspection proves that valid IDAT/pixel data carries no covert payload.

Implementation choices were checked against pinned upstream sources:

- Playwright applies only the locators supplied in `mask` before delegating the screenshot:
  [screenshotter.ts at `26a9e470`](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/screenshotter.ts#L272-L304).
- Strict PNG CRC and header checks follow the upstream libpng patterns:
  [pngrutil.c at `95ab3fd`](https://github.com/pnggroup/libpng/blob/95ab3fdca83ea294efd3b092e9a53c5a39886444/pngrutil.c).
- Inflated scanline output is bounded with Node's documented `maxOutputLength` behavior:
  [zlib documentation at `20da4ae`](https://github.com/nodejs/node/blob/20da4aeadabc5b0a01e3fcf520f91df8285c68a2/doc/api/zlib.md#L839-L840).
- Node's returned zlib engine reports consumed bytes, so validation also rejects input after the
  completed stream: [`info` and `bytesWritten` at `20da4ae`](https://github.com/nodejs/node/blob/20da4aeadabc5b0a01e3fcf520f91df8285c68a2/doc/api/zlib.md#L1019-L1029).
