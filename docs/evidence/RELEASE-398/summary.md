# Packed CLI release E2E evidence

The packed CLI was installed into a temporary clean room, drove the independently installed reference app (fixture personas) through a controlled model-boundary HTTP stub and real Chromium, then completed a blocked unreachable-origin run without changing the prior promoted bundle. Screenshots use fixture data and capture-time masking, with adjacent privacy attestations. Automated inspection cannot discharge the human release sign-off. No fresh live-provider campaign is claimed. No raw traces are retained.

## Versions

- Node: v24.18.0
- Arxic bundle generator: @arxic/playwright-compiler@0.1.0
- Playwright: 1.62.1

## Pass/fail

| Check | Result |
| --- | --- |
| Packed local run reaches signed-in home with three clean verifier passes | pass |
| Installed native PHP grammar parses real PHP and appears in the bundle SBOM | pass |
| Relocated bundle passes independent Playwright replay | pass |
| Wrong credentials fail replay without raw trace retention | pass |
| Model stub receives a structured HTTP request | pass |
| Promoted bundle validates and retains screenshots | pass |
| Unreachable origin is blocked and preserves prior bundle | pass |

## Timings

- clean-room-install: 76571 ms
- user-app: 33875 ms
- model-endpoint: 2 ms
- packed-local-run: 19927 ms
- happy-assertions: 9 ms
- independent-bundle-replay: 10204 ms
- sad-path: 1214 ms
- sad-assertions: 0 ms
- evidence-export: 8 ms

## Model endpoint proof

```json
[
  {
    "method": "POST",
    "path": "/chat/completions",
    "structuredOutput": true,
    "authorizationPresent": true
  },
  {
    "method": "POST",
    "path": "/chat/completions",
    "structuredOutput": true,
    "authorizationPresent": true
  },
  {
    "method": "POST",
    "path": "/chat/completions",
    "structuredOutput": true,
    "authorizationPresent": true
  },
  {
    "method": "POST",
    "path": "/chat/completions",
    "structuredOutput": true,
    "authorizationPresent": true
  },
  {
    "method": "POST",
    "path": "/chat/completions",
    "structuredOutput": true,
    "authorizationPresent": true
  },
  {
    "method": "POST",
    "path": "/chat/completions",
    "structuredOutput": true,
    "authorizationPresent": true
  },
  {
    "method": "POST",
    "path": "/chat/completions",
    "structuredOutput": true,
    "authorizationPresent": true
  },
  {
    "method": "POST",
    "path": "/chat/completions",
    "structuredOutput": true,
    "authorizationPresent": true
  },
  {
    "method": "POST",
    "path": "/chat/completions",
    "structuredOutput": true,
    "authorizationPresent": true
  },
  {
    "method": "POST",
    "path": "/chat/completions",
    "structuredOutput": true,
    "authorizationPresent": true
  },
  {
    "method": "POST",
    "path": "/chat/completions",
    "structuredOutput": true,
    "authorizationPresent": true
  },
  {
    "method": "POST",
    "path": "/chat/completions",
    "structuredOutput": true,
    "authorizationPresent": true
  },
  {
    "method": "POST",
    "path": "/chat/completions",
    "structuredOutput": true,
    "authorizationPresent": true
  },
  {
    "method": "POST",
    "path": "/chat/completions",
    "structuredOutput": true,
    "authorizationPresent": true
  },
  {
    "method": "POST",
    "path": "/chat/completions",
    "structuredOutput": true,
    "authorizationPresent": true
  },
  {
    "method": "POST",
    "path": "/chat/completions",
    "structuredOutput": true,
    "authorizationPresent": true
  }
]
```

## Final output

```text
HUMAN-FLOW-E2E PASS
phase=clean-room-install durationMs=76571
phase=user-app durationMs=33875
phase=model-endpoint durationMs=2
phase=packed-local-run durationMs=19927
phase=happy-assertions durationMs=9
phase=independent-bundle-replay durationMs=10204
phase=sad-path durationMs=1214
phase=sad-assertions durationMs=0
phase=evidence-export durationMs=8
totalMs=141872
modelRequests=16
cleanRoom=/tmp/arxic-human-flow-UaUDru
```

## Source and review

Arxic source: `e046590` on `audit/release-398`; Node 24.18.0, Linux; generated version 0.1.0.
See [annotations](./annotations.json), [independent timeline inspection](./timeline-inspection.json),
and the [audit report](../../reviews/release-0.1.0-398.md). All three PNGs were viewed
by the agent. This does not discharge the required human release inspection.

A separate [live-provider campaign](./live-provider/summary.md) also passed with
real Mailpit. The combined inspection census contains six screenshots; all six
were viewed by the agent. Human sign-off remains unperformed.
