# M2-SERVICE-WORKERS browser evidence

The raw Playwright trace previously retained in this directory was removed under
the no-raw-trace-retention policy and must not be regenerated or committed. No
screenshot is retained here either: retained screenshots require `.privacy.json`
attestation under the merged #115 screenshot-privacy policy, and this slice's
proof is the real-world test's diagnostic assertions, not a captured image. The
test captures a screenshot only transiently (into a temporary directory that the
suite removes), so no unattested screenshot artifact is committed.

Containment is proven by the real-world test, not by a trace:

- With Service Workers allowed, the hostile fixture registers and activates a worker,
  then reaches both an independent same-origin POST sink and a cross-origin sink.
- Through `CrawleeSurfaceDiscoverer`, Crawlee 3.18 / Playwright 1.62.1 blocks worker
  registration before the worker script is fetched. Neither sink is reached.
- The fixture's page-owned fallback attempts are intercepted and denied, producing
  blocked `ARXIC-SURFACE-001` and `ARXIC-SURFACE-008` diagnostics for the exact
  cross-origin GET and same-origin POST requests.

Proof source:

- `packages/crawlee-adapter/src/__tests__/service-workers.real-world.test.ts`
- `packages/crawlee-adapter/src/__tests__/sad-paths.test.ts` (persistent-context
  cookie/session regression coverage)

Retained artifacts:

- `provenance.json`

Normal test runs capture the screenshot into a temporary directory and remove it;
nothing is retained unless `ARXIC_EVIDENCE_DIR` is set, and even then the screenshot
is not committed (it would require #115 attestation). The test no longer starts or
writes a Playwright trace.

The diagnostics are emitted for page-owned fallback requests after registration is
blocked. They are not attributed to unseen Service Worker-owned requests.
