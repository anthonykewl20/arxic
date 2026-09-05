# Provider-agnostic model controls — refs #402

Implementation: `9dc3a53c09fd9f82e97b245603398cbc29834e45`.
Final control spacing: `c700bef` (full commit recorded in adjacent UI provenance).
Date: 2026-09-05. Required PR CI pending at authoring. #402 remains open.

| Check | Result |
| --- | --- |
| Real host subprocess receives the selected model argument | Red: no model argument; green: exact `vendor/custom:local` received |
| Unknown provider, malformed connection, invalid rates or missing credentials | Refused/blocked; no fallback to a different connection |
| Provider catalog visibility | Only safe labels, transport, suggested IDs and selection capability; no endpoint, command or credential binding |
| Arbitrary compatible model ID | Exact ID reaches chosen HTTP connection; explicit rates permit models outside the built-in price table |
| Guided Next.js engine and campaign | Pass: actual compiler/browser/verifier, two workflow children with 2/2 replays each, real Mailpit emails |
| Desktop/mobile provider settings | Pass: configured suggestions, custom ID, save/reopen/poll persistence and viewport fit |
| Review connection/credential isolation | Pass: default endpoint deliberately unreachable, selected endpoint receives exact custom ID and selected credential |
| Live installed-agent model forwarding | Pass: two requests explicitly select `openai/gpt-5.6-terra`; zero tool invocations; both probe sessions deleted |
| Live clean screenshot | Pass: zero findings |
| Live controlled Next.js regression | Pass: required submit button missing and horizontal overflow proposed as bounded hypotheses; 27,145 changed pixels |
| Artifact integrity | Seven agent-viewed PNGs, three sanitized timelines, matching hashes/provenance; no raw traces |

The external HTTP model is stubbed only in browser/engine transport tests; the
actual reference apps, Chromium, SQLite, compiler and verifier execute. The live
pair uses the installed coding agent and actual masked PNGs, with the exact model
argument recorded in `live/provider-usage.jsonl`. It is evidence of requested-model
forwarding and returned findings, not independent attestation of provider internals
or billing. This one model/case does not certify every vendor or detector quality.

`settings/` retains the two relevant named settings screenshots from the complete
browser journey and its full allow-listed action timeline. `review/` retains the
three review screenshots. Desktop screenshot inspection prompted an additional
12px gap between provider and model controls; the final two journeys pass in
41.52 s at the spacing commit. No behavioral assertion was widened. An initially
missing accessible select name failed the exact-label browser test; explicit
provider labels corrected it.

Validation: all 42 web tests in 11 files pass (235.98 s); final CLI/host transport
checks pass 45 tests in two files (4.74 s); root/web type checks and lint pass.
Full format: `All matched files use Prettier code style!`.

Configuration remains operator-owned. HTTP is the existing compatible
chat-completions protocol; host connections require an installed wrapper. Native
vendor APIs, automatic account-model discovery, actual model identity attestation
and comprehensive visual/business-state coverage are not claimed. Human release
screenshot inspection has not been performed. [Clean install/recovery proof](../WEB-402-INSTALL/summary.md)
is retained separately at its earlier exact commit.
