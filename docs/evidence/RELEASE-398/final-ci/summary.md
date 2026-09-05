# Packed CLI release E2E evidence

The packed CLI was installed into a temporary clean room, drove the independently installed reference app (fixture personas) through a controlled model-boundary HTTP stub and real Chromium, then completed a blocked unreachable-origin run without changing the prior promoted bundle. Screenshots use fixture data and capture-time masking, with adjacent privacy attestations. Automated inspection cannot discharge the human release sign-off. No fresh live-provider campaign is claimed. No raw traces are retained.

## Versions

- Node: v22.22.0
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

- clean-room-install: 31726 ms
- user-app: 33524 ms
- model-endpoint: 2 ms
- packed-local-run: 17170 ms
- happy-assertions: 12 ms
- independent-bundle-replay: 9671 ms
- sad-path: 1622 ms
- sad-assertions: 1 ms
- evidence-export: 17 ms

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
phase=clean-room-install durationMs=31726
phase=user-app durationMs=33524
phase=model-endpoint durationMs=2
phase=packed-local-run durationMs=17170
phase=happy-assertions durationMs=12
phase=independent-bundle-replay durationMs=9671
phase=sad-path durationMs=1622
phase=sad-assertions durationMs=1
phase=evidence-export durationMs=17
totalMs=93754
modelRequests=16
```
