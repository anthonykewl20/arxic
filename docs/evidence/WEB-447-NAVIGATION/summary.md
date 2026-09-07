# WebKit navigation diagnostic — #447

Investigation remains open; no error suppression or production lifecycle fix is shipped.
The explicit diagnostic runs real WebKit 26.5 against the real workbench with a
real vulnerable-auth-app visual run, ephemeral ports and isolated state.

```sh
ARXIC_DASHBOARD_BROWSER=webkit ARXIC_NAVIGATION_EVIDENCE_DIR=/tmp/arxic-navigation-proof pnpm exec vitest run --config scripts/navigation-probe.config.ts
```

This is deliberately outside the default test discovery. It tests whether an
intermittent event was reproduced; a zero-event run fails its reproduction
assertion and is **inconclusive for this investigation**, not evidence of a new
product failure or a corrected defect. The regular no-pageerror checks remain
unchanged. No retries or rate-limit bypass are added. The navigation loop uses
one real sign-in and 100 response-boundary navigations.

The retained run passed one diagnostic case in 12.54 s at source `3afd1dd`,
dirty=true (the probe/config were uncommitted). Native error and rejection
canaries each produced one native event plus one driver event. During navigation,
100 document-ready and 100 pagehide events accompanied 94 cancelled requests and
four driver fetch-load diagnostics, with zero native errors/rejections. An
active `/api/runs` request refusal then produced a driver fetch diagnostic and
[visible recovery UI](./03-active-fetch-failure.png). A deliberately thrown
look-alike error produced both the native error and driver fetch-load category.
These adversarial cases rule out message-only and native-event-absence-only
waivers. All counts come from the [allow-listed event record](./navigation-events.json).
Four named masked screenshots were agent-inspected, not human signed off; image,
event and timeline hashes matched. No raw trace, URL, credential, response body
or raw exception text is retained. Injected canaries and request refusal are
explicit diagnostic stimuli, not ordinary product behavior.

## Source corroboration and limits

[WebKit CachedResourceLoader](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/cache/CachedResourceLoader.cpp)
converts an immediate null/cancelled load error into an access-control error in
its synchronous failure path.
[ThreadableLoader](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/ThreadableLoader.cpp)
can emit the fetch-load message as a JavaScript-source console error.
The installed Playwright 1.62.1 `lib/coreBundle.js` WebKit `_onConsoleMessage`
handler maps a JavaScript-source error-level console message to `pageerror`.
This source chain corroborates a browser-diagnostic interpretation of the
recorded navigation event; it is an inference, not an instrumented WebKit stack
trace or proof that every matching message has that cause.

A future runtime classifier must bind a diagnostic to the outgoing document and
its failed request, preserve native exceptions and active-page failures, and
leave ambiguous cases unresolved. This probe records test stages, not such a
production document/request identity. It therefore authorizes **no exemption**.
Back/forward restoration, early-login navigation, durable accepted jobs and
complete lifecycle classification remain acceptance work in #447. #402 remains
open. The failed pagehide/AbortController candidate was removed in earlier work.

## Failed diagnostic attempts

An early observer attempt lacked an explicit browser context; another used an
incorrect exact canary message match. Both harness problems were corrected.
WebKit rejected a route-fulfilled HTTP 302 stimulus, so that harness run failed;
the final active-failure stimulus uses the supported browser request-abort API.
No original production assertion was widened to resolve these failures.
