# Asynchronous replay completion — WEB-422-REPLAY

Refs #422 and the broader #402 product goal. This fixes a reproduced premature-completion defect; it does not establish full production readiness or human release sign-off.

## Causal reproduction

The existing selected-reset test expected at least three emails after exploration and two deterministic replays. In the original full web run it received two, despite both replay reports passing. The exact historical request timing was not retained.

A real HTTP relay around the actual Next.js reference app delays only the first replay POST by 800 ms. It retains request ordinals, fixed route categories, status/redirect booleans and Mailpit totals; no body, cookie, credential, mail contents or raw network log is retained. With the pre-fix replay code, the unchanged assertion receives two emails and the relay observes a closed client before forwarding the delayed request. Delaying both replays leaves only the exploration email. The numeric before artifacts retain those observations.

Exploration already waits for action-related requests and stable page observations. Generated replay previously proceeded from click to pathname/heading assertions that could already be true, took its masked screenshot and closed the browser context. The delay therefore exposed premature completion rather than late SMTP delivery after an awaited successful response. The real application awaits SMTP before its success redirect.

## Fix and boundaries

Generated actions use the same bounded settling service as exploration before assertions, screenshots and receipts. It waits for tracked document/fetch/XHR completion and a 250 ms quiet URL/accessibility observation, within a 30-second action budget. This is an observation-completion boundary, not an independent business oracle: deferred work that has not started and long-lived background traffic remain separate concerns under #402.

A package-owned constant JavaScript source serves both in-process execution and emitted portable runtime. Only that reviewed constant is compiled in-process; no caller or page supplies executable code. A real minified CLI-bundler test requires identical runtime bytes. The service is emitted in the existing independently hash-bound transition runtime, with unchanged forbidden-API/secret checks and unchanged workflow locator permissions.

The first implementation attempt placed the helper in workflow fixture code and was rejected by the locator policy; this was corrected without relaxing the policy. Function serialization then produced different source-vs-bundled hashes; constant source corrected the mismatch. A diagnostic proxy initially failed origin attestation; the app was subsequently launched with the proxy as its configured declared origin. These were development failures, not product passes.

## Validation and evidence

Implementation: `f23d337`; final pre-proof documentation head: `45a1560c527618ee571786f0d77e6dbaf1c5eee0`.

- Original minimum-three-email assertion is unchanged. New exact per-submission assertions require accepted responses and Mailpit totals 1, 2, 3.
- Six-mode real agent suite: 6/6 pass, 110.79 seconds. Includes a controlled model provider boundary, real source discovery/compiler/verifier, Next.js, Chromium and isolated Mailpit. This does not claim paid-provider inference.
- Broader changed-area suite: 338/339 tests across 48 files passed initially (650.54 s); the only failure was the stale sensitivity scenario described below. After the scenario correction, all 15 verifier real-world tests passed (97.88 s); the other 47 files were unchanged..
- Shared-service real HTTP delayed/hanging response cases and real bundler portability: 3/3 pass.
- Lint, root/package typechecks and license pass. Full-repo format after final evidence and slice note: `All matched files use Prettier code style!`. Required current-head CI and merge disposition are recorded in the PR.

Each final proof directory contains one hash-checked screenshot (identical captures deduplicated), two independently inspected sanitized action-timeline archives with adjacent provenance, and per-submission numeric side-effect records. **The generated screenshot masks the entire main region under the existing privacy policy. It cannot establish layout or visible success feedback.** Timeline actions and independent email counts establish completion; no fresh dashboard visual/UX audit is claimed here. Raw trace archives are excluded from export; only archives accepted by the trace sanitizer's independent inspection are retained.

No assertion tolerance or count threshold was reduced, and no accessibility rule was disabled. Full state/persona/browser coverage, business acceptance oracles, visual checkpoint controls, operational release work, integrator notes and human release inspection remain open under #402. No release is tagged or published.

## Sensitivity-test correction

The broad run exposed a pre-existing test that expected `text:Email` to remain visible after **successful** login. The real home page has no such label. Its old unmutated control depended on the same pre-completion race. The corrected rejected-login scenario submits an intentionally incorrect password and preserves the original exact expected tautology diagnostics and both mutation operators. A second successful-login scenario requires an unusable-control result because the stale entry marker is absent. No matcher was broadened or count threshold lowered; the test's input scenario changed explicitly so it tests a real invariant. The rerun covers the complete verifier real-world file.
