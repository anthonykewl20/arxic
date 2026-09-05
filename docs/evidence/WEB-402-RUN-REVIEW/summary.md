# Run, capture and review presentation — refs #402

Run lists, capture comparisons, image hypotheses and provider/model fields now
use React/shadcn. Shared provider metadata updates suggestions without replacing
custom model IDs or draft input. API actions own enqueueing, session epochs and
navigation; presentation components do not assign verifier outcomes.

## Reproduced failures

- Holding the response to a real review enqueue left model and criterion fields
  editable. The new disabled-field assertion failed (`false` versus `true`).
  The review form now disables its settings and submission while pending.
- Selecting another project hid the original run from the list but kept its
  detail visible. The new exact count assertion failed (`1` versus `0`). The
  detail panel now applies the same project filter as the list.
- The first new-project probe used a polling timeout shorter than the dashboard
  refresh interval. Its timeout was increased to 10 seconds; the outcome assertion
  was retained and then reproduced the stale-detail defect.
- Screenshot inspection found the new-session image framed the source capture,
  leaving the cleared consent fields below the viewport. The capture now scrolls
  to the review form. No behavior assertion was changed.

## Validation

Implementation: `5c56b79a7cd6ce76d966780eb2fbe4548f57739a`, based on merged PR #415.
Full web area: **47 tests in 13 files passed, 225.46 s**. Root and package type
checks, lint and the license gate pass. The subsequent test-only screenshot
position change is `520b256`; its real review journey passed independently (25.40 s).
Full-repository format after final docs: `All matched files use Prettier code style!`.
PR #416 required CI 33985669768 passed on `e2985ca9b143c80829b2a5b53f628ca2e2142527`: all four test shards, static, package and fixture apps. Worker-image was conditionally skipped. The slice merged as `804802886e0fe7213c5c5313423c8c5499d4596e`. No release completion is claimed.

| User-level journey | Result | Retained proof |
| --- | --- | --- |
| Real source discovery, project/custom-model persistence, baseline comparison, UTC scheduling/audit, mobile layout and late logout response protection | PASS | [Core timeline](core/timeline.json), [provenance](core/timeline.sanitization.json), 13 named PNGs |
| Actual masked PNG sent to the selected boundary provider, custom ID preserved during polling, explicit consent, disabled pending controls, grounded hypothesis overlay, mobile fit, project filtering and fresh consent after logout | PASS | [Review timeline](review/timeline.json), [provenance](review/timeline.sanitization.json), six named PNGs |

The real Next.js/Express reference apps, Chromium, source scanner, compiler and
Mailpit execute in the full suite. The external model response is a boundary
stub; fresh subscription inference is not claimed by this presentation slice.
Images use capture-time masking and reference data. The inspection manifest
records matching hashes and agent inspection of all 19 retained screenshots and
both sanitized timelines. No raw trace ZIP or credential cache is retained.
Human release inspection has not been performed.

## Remaining scope

Native dialogs and shared dashboard API/form actions remain in use. This slice
adds no browser account login, recurring selected-workflow campaigns, authenticated
visual checkpoints, richer worker/retention administration or full server release
proof. It tests explicit logout cleanup; session-expiration cleanup and navigation
away during pending mutations need further adversarial checks. #402 remains open.
No test was skipped and no business-outcome matcher was widened.
