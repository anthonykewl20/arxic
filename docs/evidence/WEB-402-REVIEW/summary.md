# Inspected-image dashboard review proof — refs #402

Initial implementation: `d00aa586420285d01f0401da692faddd4b54b1f1`.
Final prompt/presentation: `ef3a126737609604e86191b655e4040a36014a05`.
Date: 2026-09-05. This is slice proof; #402 and human release inspection remain open.

| Check | Result | Evidence |
| --- | --- | --- |
| Missing inspected-image authorization / stale hash | Blocked before provider contact | `visual-review.test.ts` |
| Missing model secret / insufficient estimate | Blocked with zero additional calls; references stay separate from credentials | Policy test |
| Out-of-schema and in-range-but-overflowing rectangles | Blocked; no region assertions were widened | Policy test |
| Source evidence deletion / file tampering | Referenced source protected; changed PNG blocked | Policy test |
| Real host cancellation | Orphan process reproduced before fix; provider stops and private PNG disappears after fix | Linux real subprocess test |
| Polling while inspecting/typing | Closing form reproduced; expanded state, criterion text and focus preserved | Browser test |
| Initial browser journey | Pass, 20.58 s; three screenshots retained | `initial-ui/` |
| Initial live missing-button review | **FAIL: false negative**, zero findings | `initial-live/results.json` |
| Persistent-CSS reproduction | **FAIL: same false negative**, zero findings | `persistent-css-live/results.json` |
| Final live clean baseline | Pass: zero hypotheses for the visible submit button | `final-live/results.json`, clean review |
| Final live missing-button regression | Pass: hypothesis identifies the absent required button and the login-card region | `final-live/results.json`, changed review |
| Final browser journey | Pass, 20.69 s; desktop/mobile rendering and scoped controls | `final-ui/` |
| Retained integrity | Twelve PNGs agent-viewed; five sanitized timelines and image/request hashes pass | Adjacent provenance |

The live probes use the actual Next.js reference app through a local HTTP proxy
that introduces a controlled CSS clipping regression. They do not substitute
model output. The independent expectation is that the submit button remains fully
inside the visible card/viewport. DOM geometry shows the clean button inside the
card and the regressed button beyond its clipping boundary; 27,145 changed pixels
and the retained masked PNGs establish the rendered difference.

An initial visual comparison was mistaken for a probe timing problem. Rechecking
the PNGs and their button-region pixel difference confirmed both failed probes
were real model misses, not a valid reason to discard the failures. Their files
are preserved. Criterion-first prompting then passes a clean/regressed pair
without changing the missing-button expectation or region bounds. The final model
proposes the actual login card rectangle (64,48,672,337), explicitly acknowledges
masked-content uncertainty, and suggests independent rendered-bounds inspection.
The app keeps the finding `hypothesized`; no model assigns `verified`.

The browser tests use real Express/Chromium/SQLite with only external model output
stubbed, so those artifacts prove the GUI/policy flow rather than semantic
correctness. The final live probe uses the installed host coding agent, denied
tool permissions, zero tool invocations and four individually deleted probe
sessions across the failed/final experiments. The actual underlying model ID and
billing cost are not asserted. The automated administrator inspection checkbox in
tests is not independent human release sign-off.

All **37 web tests in ten files pass** (209.42 s) before the final prompt/padding
correction. The two policy/cancellation tests and final browser journey pass after
that correction. Sixteen policy/CLI tests, root/web type checks and lint pass.
Full format: `All matched files use Prettier code style!`. Required current-head CI
is pending at authoring.

No raw trace, prompt, image base64, temporary attachment path or test credential
is retained in JSON artifacts. Named PNGs and their capture-time privacy records
are byte-preserved. The persistent-CSS probe ran the image/engine code at d00aa58;
a dashboard-only spacing edit was pending and had no role in those captures.

Limits: one clean/regressed case is not a comprehensive detector evaluation.
Reviews cover one explicitly inspected anonymous viewport; authenticated states,
broader semantic comparisons and campaign coverage remain under #402. HTTP budget
allowances are estimates, and host-provider tools/billing are operator-managed.

CI installation follow-up: run 33972262170 failed in the static job's dependency
installation, inside node-gyp/undici's Node header download, before type/format
checks. `native-install.json` records the exact Node archive and an isolated red/
green probe: an unavailable header endpoint fails without a local SDK; matching
installed headers permit a forced SQLite source build and SQL round trip with
zero header fetches. CI now validates and selects its installed Node headers.
No test was weakened, skipped or retried to conceal a product assertion failure.
