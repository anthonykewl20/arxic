# Dashboard sessions and pending requests — refs #402

Review and campaign pending state survives navigation. A shared request registry
rejects duplicates atomically; request-specific tokens prevent an old completion
from releasing a newer session's request. The action layer rejects API responses
from prior sessions before callers can mutate current dashboard state. Explicit
logout and unauthorized responses share one cleanup path for drafts, image consent,
selections, model metadata and mounted forms. Already accepted server jobs remain
retained; ignoring a stale browser response does not cancel them.

## Red-first failures

| Actual browser trigger | Failure before correction | Expected result |
| --- | --- | --- |
| Invalidate the real session cookie, then sign in again | `Expired-session draft` instead of empty | Fresh draft and unchecked image consent |
| Navigate away/back while a real review enqueue response is held | Review model input disabled state was `false` | Pending settings and submit remain disabled |
| Submit a real Next/Mailpit campaign | Selected workflow checkbox disabled state was `false` | Pending selection remains immutable across navigation |
| Release that campaign response after logout and new login | `Workflow campaigns` instead of `Intent inventory` | New session navigation is preserved |

The outcome assertions are unchanged. The final campaign check waits for actual
response delivery before checking the resulting page. No test is skipped, no
strict locator is relaxed and no business-outcome matcher is widened.

## Committed validation

Source revision: `44af0884946e1fb146d5362148e69bd8eebfeafd`, rebased onto merged
PR #416 (`804802886e0fe7213c5c5313423c8c5499d4596e`). All **47 web tests in 13 files pass (229.62 s)**. Root/package type checks,
lint and the license gate pass locally. Full-repository format after final docs:
`All matched files use Prettier code style!`. PR #417 required CI 33986496965 passed on `7fb62726deb35875bfcc46a2a125fd85432ed125`: all four shards, static, package and fixture apps. Worker-image was conditionally skipped. The slice merged as `1b0f0a0be6d94fd2d03ee36ea8c69f6e0be14634`; no release completion is claimed.

| User-level journey | Result | Retained proof |
| --- | --- | --- |
| Real masked image review, selected custom model, pending controls across navigation, mobile hypotheses, project filter, explicit logout and lost-session consent reset | PASS | [Review timeline](review/timeline.json), [provenance](review/timeline.sanitization.json), eight named PNGs |
| Two real Next workflows each passing two verifier replays with Mailpit emails, immutable pending selection across navigation, late response isolation, mobile evidence and rediscovery selection reset | PASS | [Campaign timeline](campaign/timeline.json), [provenance](campaign/timeline.sanitization.json), eight named PNGs |

All 16 named screenshots were agent-inspected, and their hashes plus both timeline
hashes match adjacent privacy/provenance records: [inspection manifest](inspection.json).
Images use capture-time masking and reference data. Timelines contain only
allow-listed action/assertion results. No raw trace ZIP or credential cache is retained.

## Scope and limits

The real Chromium browser, Express/Next reference apps, source scanner, compiler,
verifier and isolated Mailpit execute. Only external model responses are boundary
stubs. This adds no live paid-provider entitlement proof, browser account login,
recurring campaigns, authenticated visual checkpoints or runtime administration.
The legacy server-default provider's unavailable catalog guidance remains a
separate follow-up. Human release screenshot inspection remains outstanding.
