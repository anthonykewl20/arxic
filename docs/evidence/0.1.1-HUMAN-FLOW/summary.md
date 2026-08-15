# 0.1.1 human-flow E2E evidence

The packed CLI was installed into a temporary clean room, drove the independently installed synthetic reference app through a real local OpenAI-compatible HTTP endpoint and real Chromium, then completed a blocked unreachable-origin run without changing the prior promoted bundle. Screenshots contain only synthetic fixture data and retain their adjacent privacy attestations. No raw traces are retained.

## Versions

- Node: v24.19.0
- Arxic bundle generator: @arxic/playwright-compiler@0.1.1
- Playwright: 1.62.1

## Pass/fail

| Check                                                    | Result |
| -------------------------------------------------------- | ------ |
| Packed local run reaches verified promotion              | pass   |
| Model stub receives a structured HTTP request            | pass   |
| Promoted bundle validates and retains screenshots        | pass   |
| Unreachable origin is blocked and preserves prior bundle | pass   |

## Timings

- clean-room-install: 44854 ms
- user-app: 28945 ms
- model-endpoint: 2 ms
- packed-local-run: 9256 ms
- happy-assertions: 2 ms
- sad-path: 1456 ms
- sad-assertions: 1 ms
- evidence-export: 5 ms

## Model endpoint proof

```json
[
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
phase=clean-room-install durationMs=44854
phase=user-app durationMs=28945
phase=model-endpoint durationMs=2
phase=packed-local-run durationMs=9256
phase=happy-assertions durationMs=2
phase=sad-path durationMs=1456
phase=sad-assertions durationMs=1
phase=evidence-export durationMs=5
totalMs=84532
modelRequests=1
```
