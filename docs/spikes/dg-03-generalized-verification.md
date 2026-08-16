# DG-03 spike report — generalized verification: observation-derived assertions + API-level replay

| Field   | Value                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Issue   | #247 ([DG-03]) · milestone ALL-Domain Business Intent Extraction                                                                          |
| Status  | **Provisional** — pending `consensus-terra` and/or cross-review (`reviewer-deepseek` + `reviewer-hy3` / `codex-reviewer`) per ADR-008 §11 |
| Package | `packages/verification-spike` (`@arxic/verification-spike`) — spike-owned prototype; not wired into the CLI/pipeline                      |
| Feeds   | ADR-008 Decisions 7–8; implementation slices DG-09 (#253), DG-07 (#251), DG-11 (#255)                                                     |
| Proofs  | `packages/verification-spike/src/__tests__/redirect-login.real-world.test.ts` (4a) · `…/webhook-replay.real-world.test.ts` (4b)           |

Research protocol (issue #247, binding): code is the source of truth; every
load-bearing claim below cites file/line against this repository at branch
`dg03-generalized-verification-spike`, or a URL + commit SHA for external
repositories. Design assumptions were validated against real applications via
GitHub code search, not synthetic examples.

---

## 1. What was measured and why

The 2026-08-16 campaign recorded two verification gaps (issue #247 context;
ADR-008 "Context"):

1. The canned post-login `url:/` assertion cannot pass on redirect-after-login
   apps (#257): the third-party app redirected to its dashboard, the canned
   literal failed, and the failure classification was then masked behind
   `ARXIC-VERIFY-ARTIFACT-MISSING` (#258).
2. Many business intents (webhooks, cron, billing side effects) have no
   browser-replayable surface, so they can never be `verified` by the only
   deterministic verifier that exists today (the Playwright workflow verifier).

This spike prototyped and measured, with real engines, three things:

- **observation-derived assertions**: post-action URL/DOM captured from a
  stage-8-style exploration pass and bound into IntentSpec, replacing canned
  literals (ADR-008 Decision 7);
- **an API-level replay executor**: HTTP-level deterministic replay for non-UI
  intents against the attested target, with leased fixtures and the same
  evidence gates (ADR-008 Decision 8);
- **a truth-state policy**: the four-way surface classification with
  deterministic-replay-only `verified`.

## 2. Finding 0 — neither fixture app can exercise the #257 defect class

Measured from code (not assumed):

- `test-fixtures/reference-auth-app/app/login/actions.ts:28` —
  `redirect('/')` after successful login.
- `test-fixtures/vulnerable-auth-app/src/server.ts:47` —
  `response.redirect(302, '/?message=Logged%20in')`.

Both fixture apps redirect post-login to `/` (modulo a query string, which the
compiler's #87/#100 anchored-regex already tolerates —
`packages/playwright-compiler/src/spec-generator.ts:166-171`). A canned
`url:/` therefore _passes_ on both fixture apps and _cannot_ reproduce #257.
The honest options were: boot a real third-party app (heavy, non-hermetic
CI), or extend the real-app estate. The spike built a **real minimal
application** inside the spike package:
`packages/verification-spike/src/test-app/redirect-login-app.ts` — real
`node:http` server, real `scrypt` password verification, real HMAC session
cookies, real 302 → `/dashboard` post-login, real sqlite (`node:sqlite`
`DatabaseSync`) persistence, real attestation endpoint, real `__arxic`
seed/reset fixture control (same contract as both fixture apps,
`packages/verifier/src/reset.ts:20-43`). It is a real app by Arxic's own
definition (real engines, real sockets, real state), purpose-built to carry
the defect class; that provenance is a documented limitation of this proof,
mitigated by external evidence that the `/dashboard` redirect is the dominant
real-world pattern (§7.2).

## 3. Design A — observation capture → derived assertions (ADR-008 Decision 7)

### 3.1 Capture substrate (reuse, no new browser machinery)

Stage 8 already has the exact seam needed:
`packages/playwright-agent-adapter/src/exploration-driver.ts` —
`PlaywrightExplorationDriver.execute()` records, per step, the post-action
`page.url()` (line 208) and a full CDP `Accessibility.getFullAXTree` snapshot
with a stable `accessibilitySnapshotSha256` (lines 331–337); the orchestrator
already turns those into runtime `EvidenceRef`s
(`packages/orchestrator-langgraph/src/exploration.ts:268-278`).

**Gap found by measurement:** the driver's observation after a `click` that
triggers navigation can race the redirect — the generated-spec world gets
retry semantics from Playwright's auto-retrying `expect(page).toHaveURL(...)`
(`packages/playwright-compiler/src/spec-generator.ts:171`), but the raw driver
observation has no such retry. The spike's
`capturePostActionObservation()` (`src/observation.ts`) adds a **bounded,
read-only stabilization loop**: after the planned action steps, snapshot-only
steps are re-executed until two consecutive reads agree on
`url + accessibilitySnapshotSha256`, or a budget (default 50) is exhausted →
`ARXIC-DG03-OBSERVATION-UNSTABLE` `blocked`. This is trusted-service retry in
the same family as the driver's own bounded locator waits; it is _not_
generated-spec waiting (ADR-001 §13.1 governs generated specs, and the
compile-policy gate is untouched).

Failure classification (charter §2/§4, measured by unit tests):
action-step failure → `ARXIC-DG03-OBSERVATION-STEP_FAILED` `blocked`;
origin drift → `ARXIC-DG03-OBSERVATION-DRIFTED` `blocked`; no stabilization →
`blocked`. Nothing drifts into a silent pass.

**Pre-flight origin gate (review remediation, 2026-08-16).** The first
revision of this spike checked origin drift only _after_ `driver.execute()`
had already run — and the driver performs `page.goto(step.url)` inside
`execute()` (`exploration-driver.ts:133-136`), so a step carrying an off-origin
absolute URL caused one unauthenticated off-origin navigation before the
`blocked` classification (P2 review finding on PR #264).
`capturePostActionObservation()` now runs the same URL-parity gate as the API
replay executor (§4, gate 2) **before any navigation**: every step URL
(navigate steps always carry one; fill/click steps optionally do) must resolve
against the attested origin or the capture fails closed with
`ARXIC-DG03-OBSERVATION-DRIFTED` `blocked` and **zero** `driver.execute()`
invocations — proven by a counting-driver unit test. Unparseable step URLs
fail closed the same way; a merely-garbage _relative_ path is same-origin by
URL semantics and is not a pre-flight concern (it is still subject to the
post-action drift and stabilization gates).

### 3.2 Derivation

`deriveAssertionsFromObservation()` (`src/derive-assertions.ts`):

- `url:` assertion = the observed URL's **pathname only** (origin, query, and
  fragment stripped) — e.g. `url:/dashboard`. This matches the compiler's
  existing assertion grammar (`spec-generator.ts:166-171`) so derived
  assertions compile through the unchanged compiler.
- `text:` assertions = observed heading anchors (role `heading`, capped,
  deduped, trimmed) — the most stable DOM identity signal available in the
  a11y tree; deeper DOM-derived assertions (per-control visibility, landmark
  structure) are DG-09 work, deliberately out of spike scope.
- Unusable URL (`about:blank`, `data:`, empty) or drift → `blocked`
  (`ARXIC-DG03-DERIVATION-EMPTY` / `-OBSERVATION-DRIFTED`) — never an
  invented assertion.

### 3.3 IntentSpec binding (ADR-004 provenance is enforced by the existing service)

`observationDerivedIntentSpec()` (`src/intent-binding.ts`) binds each derived
assertion with `expectedValue = intent`, one `OracleSpec` chosen by the
caller, source refs, and the opaque runtime evidence id of the capture
(`dg03-run:<16hex>`, deterministic over evidence content — ADR-002 opaque-id
semantics). All provenance decisions are delegated to the **real**
`@arxic/intent` service and were re-proven, not re-implemented:

- observed-only oracle → `characterization`
  (`packages/intent/src/resolve.ts:117`);
- independent oracle (domain-rule/repository-specification/human-approved) +
  source **and** runtime refs → `acceptance`; missing refs → `blocked`
  (`ARXIC_INTENT_SOURCE_AS_ACCEPTANCE`, `resolve.ts:137-152`);
- divergent acceptance expected values for one id → `contradicted`
  (`ARXIC_INTENT_ORACLE_CONFLICT`, `packages/intent/src/normalize.ts:140-151`).

**Observed-only characterizations are NOT acceptance oracles** — the spike
additionally consumes `everyRequiredAssertionAcceptance()`
(`packages/intent/src/compile-bridge.ts:80-87`) to prove a
characterization-only spec is promotion-ineligible even when the same
assertion bytes replay clean.

## 4. Design B — API-level replay executor (ADR-008 Decision 8)

`executeApiReplay()` (`src/api-replay.ts`) replays an HTTP-level intent
specification against the attested target under the same trust spine as the
browser verifier. Gate order is fail-closed and each gate was measured to
block **before** the business endpoint is touched:

| #   | Gate                                     | Mechanism (reused seam)                                                                                                                                                                                                                                                                                                 | Failure                                                                                                                                              |
| --- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Target attestation                       | `EnvironmentHandshake.attest()` (`packages/environment/src/attestation.ts:273-303`) with local-test policy; no attestation endpoint or refused attestation → no business request                                                                                                                                        | `ARXIC-DG03-ATTESTATION-UNAVAILABLE` / `-ATTESTATION-REFUSED` `blocked`                                                                              |
| 2   | Pre-flight redaction + origin resolution | a forbidden substring in a request **path** cannot be redacted without changing the request; a step path that resolves off the attested origin (e.g. an absolute off-origin URL) is rejected before any fetch — only redirect containment would not catch it                                                            | `ARXIC-DG03-REDACTION-FAILED` / `ARXIC-DG03-ORIGIN-DRIFT` `blocked`                                                                                  |
| 3   | Policy engine                            | methods map onto the frozen action registry (`packages/policy-engine/src/policy.ts:52-59`): GET/HEAD → `navigation` read-only (budget), POST/PUT/PATCH → `form-submit` reversible-mutation (**lease required**), DELETE → `delete-user` destructive (**recorded approval required**); unknown/mismatched → default-deny | `ARXIC-DG03-POLICY-DENIED` `blocked` (carries the underlying `ARXIC-POLICY-*` codes)                                                                 |
| 4   | Origin containment                       | `redirect: 'manual'` + bounded (5-hop) same-origin redirect following; cross-origin `Location` is never followed                                                                                                                                                                                                        | `ARXIC-DG03-ORIGIN-DRIFT` `blocked`                                                                                                                  |
| 5   | Fixtures per run                         | caller-supplied `resetAndSeed(run)` (the browser verifier's `resetAndSeedFixtures` contract, `packages/verifier/src/reset.ts:20-43`)                                                                                                                                                                                    | `ARXIC-VERIFY-BLOCKED-FIXTURE` `blocked`                                                                                                             |
| 6   | Evidence                                 | per-step request/response artifacts (JSON), sensitive headers retained only as `sha256:<16hex>` digests, bodies redacted of forbidden substrings, final serialized artifact scanned → any survivor fails closed; artifacts SHA-256-hashed and **re-verified by re-reading after the runs**                              | `ARXIC-DG03-REDACTION-FAILED` / `ARXIC-VERIFY-ARTIFACT-HASH-MISMATCH` `blocked`                                                                      |
| 7   | Classification                           | the **real** `classifyVerification()` (`packages/verifier/src/classify.ts:28-151`) — identical ordering and codes as the browser path                                                                                                                                                                                   | split runs → `ARXIC-VERIFY-FLAKY-RUNS` `contradicted`; all-fail → `ARXIC-VERIFY-APP-DEFECT` `contradicted`; all-pass + artifacts intact → `verified` |

HMAC signing follows the real-world webhook convention
(`x-arxic-signature: sha256=<hex>` of HMAC-SHA256 over the exact raw body;
secret resolved from an env var, never a literal) — see §7.2 for the external
citations. The verifier-side comparison in the proof app uses
`timingSafeEqual`.

**Policy mapping honesty note:** mapping HTTP methods onto the _existing_
four action classes means a mutating POST without an acceptably-scoped lease
is denied by the real policy engine (measured: zero business requests). The
spike does NOT register new policy actions — that would edit a forbidden
package; if DG-09 wants first-class `api-replay` actions, that is a
policy-engine change with its own review.

## 5. Design C — truth-state policy (ADR-008 Decision 8)

`src/truth-policy.ts` — pure deterministic functions; no model, no approval,
no observation assigns a truth state. Two-step resolution:

**Surface classification** (`classifyReplaySurface`, normative order):
UI-reachable → `replayable-browser`; else HTTP-replayable → `replayable-api`;
else independent oracle exists → `corroborated-only`; else
`human-approved-only`.

**Cap + resolution matrix** (`truthStateCap` / `resolveReplayTruthState`):

| Surface                   | Oracle provenance                                        | Deterministic replay outcome | Final truth state                                                         |
| ------------------------- | -------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| replayable-browser / -api | ≥1 acceptance oracle on every required assertion         | `verified`                   | **`verified`** (the only path)                                            |
| replayable-browser / -api | acceptance                                               | `contradicted` / `blocked`   | `contradicted` / `blocked`                                                |
| replayable-browser / -api | observed-only only (characterization), or mixed, or none | any (even `verified`)        | **`observed`** (capped)                                                   |
| corroborated-only         | independent oracle(s)                                    | — (no replay surface)        | **`observed`** (cap)                                                      |
| human-approved-only       | approval only                                            | —                            | **`observed`** (cap; approval authorizes scope, never truth — ADR-004 §2) |

This mirrors the existing promotion gate semantics
(`compile-bridge.ts:80-87`) at the truth-state layer and is enforced _above_
the verifier: in proof 4a the same replay bytes that yield `verified` under a
domain-rule oracle are capped to `observed` under an observed-only oracle
(measured assertion in the proof suite).

## 6. Prototype proofs (real engines, real apps)

### 6.1 Proof 4a — redirect-after-login verifies end-to-end (real Chromium)

`src/__tests__/redirect-login.real-world.test.ts`, all green locally
(2026-08-16; Chromium 151.0.7922.34 via pinned `@playwright/test` 1.62.1):

1. **Capture**: stage-8-style exploration (navigate `/login` → fill Email →
   fill Password → click "Log in") through `PlaywrightExplorationDriver`;
   stabilization lands on `http://127.0.0.1:<port>/dashboard`, headings
   `["Dashboard"]`, a11y snapshot sha256 recorded. Retained:
   `docs/evidence/DG-03/observation-capture.json`.
2. **Derive**: `url:/dashboard` + `text:Dashboard` — from the live app, not a
   literal.
3. **Bind**: characterization variant (observed-only) and acceptance variant
   (spike domain-rule oracle) both normalize through the real `@arxic/intent`;
   `enforceIntentProvenancePolicy` ok; `everyRequiredAssertionAcceptance`
   true only for the acceptance variant.
4. **Compile + verify**: the REAL `PlaywrightCompiler` → REAL
   `PlaywrightVerifier`, two clean-fixture replays, screenshot-privacy policy
   bound to the `Dashboard` heading → outcome **`verified`**,
   `runs: [{passed:true},{passed:true}]`, hash-checked artifacts retained.
5. **Canned twin (sad path)**: the same workflow with the canned `url:/`
   literal → `runs: [{passed:false},{passed:false}]` — never a silent pass.
   The reported outcome is **`blocked` with `ARXIC-VERIFY-ARTIFACT-MISSING`**,
   not `contradicted`: the failed assertion aborts the step before
   `capturePolicyScreenshot` runs, the screenshot-privacy inventory gate then
   fails ("source image inventory differs from the exact bound output set"),
   failure-evidence retention is purged, and the artifact gate outranks the
   run classification in `classifyVerification`
   (`packages/verifier/src/classify.ts:59-72` vs `:125-150`). **This is an
   in-repo reproduction of #258 stacking on #257** — recorded here as a spike
   finding (see Dissent D2).

### 6.2 Proof 4b — non-UI intent replays at HTTP level with evidence (real HTTP)

`src/__tests__/webhook-replay.real-world.test.ts`, all green locally:

1. **Happy path**: `POST /api/webhooks/order.created` (HMAC signature from
   env-held secret; sqlite side effect) + `GET /api/orders/by-event/<id>`
   read-back, replayed **2×** against the attested target (decision
   `environmentClass: local-test`) → outcome **`verified`**, 4 retained
   artifacts, each re-hashed after the runs; the signature header is retained
   only as `sha256:<16hex>`; the secret appears in no artifact. Retained:
   `docs/evidence/DG-03/api-replay-*.json`.
2. **Wrong signature** (different secret) → real app answers 401 →
   `contradicted` (`ARXIC-VERIFY-APP-DEFECT`) with `runs: [false,false]`.
3. **No lease** for the mutating POST → `blocked`
   (`ARXIC-DG03-POLICY-DENIED` carrying `ARXIC-POLICY-LEASE-MISSING`) with
   **zero** business requests observed server-side.

Sad-path unit coverage beyond the proofs (all `blocked`/`contradicted`,
red-first): missing attestation endpoint (0 hits), production-looking
attestation (0 hits), expired lease (0 hits), destructive method without
approval (0 hits), forbidden substring in path (0 hits), off-origin absolute
step path (0 hits), off-origin observation step URL rejected pre-flight with
zero navigations, unparseable observation step URL rejected pre-flight with
zero navigations, fixture reset failure mid-run, split runs, zero
requiredRuns, stabilization failures, derivation failures, oracle-provenance
failures.

## 7. Real-world diversity validation (GitHub code search, ADR-008 §11)

### 7.1 Post-login redirect targets are diverse and commonly ≠ `/`

- `swarooppatilx/scruter` — `res.redirect('/dashboard')` after login success,
  `app.js` lines 268/308 at commit
  `915f1f87201a0411698e817d510c4864325b1e12`:
  <https://github.com/swarooppatilx/scruter/blob/915f1f87201a0411698e817d510c4864325b1e12/app.js>
- `laravelcm/laravel.cm` — `redirect()->intended(route('dashboard.index'))`,
  `routes/auth.php:33` at commit `68370fa42da489d4c0bd3a1d8d4d17d43459e5aa`:
  <https://github.com/laravelcm/laravel.cm/blob/68370fa42da489d4c0bd3a1d8d4d17d43459e5aa/routes/auth.php>
- `binitghetiya/nodejs-mongodb-auth`, `brantje/webspy` and others in the same
  search family (`res.redirect "/dashboard"` / `res.redirect('/dashboard')`
  post-login) — same pattern across independent codebases.

Conclusion: a canned post-login path literal is structurally wrong for the
real-app population; observation-derived assertions are the correct default.
Caveat recorded: GitHub code search samples public code; `intended()`-style
redirects also make the _target_ session-dependent (`redirect()->intended`
falls back to a default when no intended URL exists) — derivation captures
the observed target per run, which is the right semantics for
characterization, and acceptance oracles for "user lands where they intended"
would need app-level rules (DG-09 consideration).

### 7.2 Webhook endpoints verify HMAC-SHA256 signatures over the raw body

- `asimolpiq/shopier-integration` — `src/webhook.ts` (signature verification
  and event parsing) at commit `e7423cb2df6b90aff7527d41faf368b5eaa42b41`:
  <https://github.com/asimolpiq/shopier-integration/blob/e7423cb2df6b90aff7527d41faf368b5eaa42b41/src/webhook.ts>
- GitHub's own webhook validation docs (version-matched secondary reference):
  "Validating webhook deliveries" — HMAC-SHA256 over the raw request body with
  a shared secret, compared in constant time:
  <https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries>
- Additional independent implementations found in the same search family
  (`adobe/summit2019-l722-lab-webhook`, `developmentseed/jekyll-hook`, …).

Conclusion: the executor's signing model (HMAC over exact raw body, env-held
secret, `timingSafeEqual` server-side) matches the dominant real-world shape;
API replay of webhook intents is representative, not synthetic.

## 8. Evidence and artifacts

- Retained (sanitized, regenerable by the suites):
  `docs/evidence/DG-03/observation-capture.json` (proof 4a capture),
  `docs/evidence/DG-03/api-replay-run01-webhook.json` (proof 4b step
  artifact), `docs/evidence/DG-03/api-replay-summary.json` (outcome + hashes).
  Generation hook: `ARXIC_DG03_EVIDENCE_DIR=<dir>` on the real-world suites
  (same pattern as `ARXIC_TRACE_SANITIZATION_EVIDENCE_DIR`).
- No raw trace ZIPs, screenshots, or secrets are retained. The API artifacts
  contain only localhost URLs, redacted bodies, hashed signature headers, and
  status codes. No persona credentials appear in any committed artifact.
- Env discipline (charter §10.1): `ARXIC_MAILPIT_*` unset; every server binds
  `127.0.0.1` on a `freePort()` port; every sqlite DB is a per-run `mkdtemp`
  path; the HMAC secret lives in an env var for the test's duration only.

## 9. Recorded dissent and open questions (evidence, not just the verdict)

- **D1 — Stabilization is a new trusted-service waiting loop.** The bounded
  snapshot-stabilization loop (`src/observation.ts`) adds retry semantics the
  raw driver lacks. It lives in spike-owned trusted service code, mirrors the
  auto-retry that generated specs get from `expect().toHaveURL`, and fails
  closed to `blocked`; but reviewers should confirm the placement is
  acceptable vs. extending the driver itself (which would touch a forbidden
  package). Mitigation: the loop is read-only and budget-bounded.
  **Review remediation (2026-08-16, P2):** the same file's first revision
  checked off-origin drift only _post-hoc_, after `driver.execute()` had
  already navigated (`exploration-driver.ts:133-136` performs
  `page.goto(step.url)` before any caller-side check) — one unauthenticated
  off-origin request escaped per capture before the `blocked`. The
  observation path now carries the same pre-flight URL-parity gate as the
  API replay executor, before any navigation, with a counting-driver test
  proving zero `execute()` invocations on rejection (§3.1).
- **D2 — #258 masking reproduced, not fixed.** The canned-literal sad path
  shows `blocked` (artifact gate) masking `contradicted` (run classification)
  on failed runs, because checkpoint screenshots never happen on failure.
  Fixing that ordering/retention is verifier-owned work (#258), explicitly
  out of this spike's file ownership. The spike's runs array still exposes
  the true per-run failures, and the observation-derived assertion removes
  the underlying #257 cause by construction.
- **D3 — The proof app is spike-owned, not a third-party app.** The #257
  defect class is exercised on a purpose-built real app because both fixture
  apps redirect to `/` (§2). External code-search evidence (§7.1) supports
  the pattern's prevalence; DG-12 (#256) remains the authority for
  third-party-app validation.
- **D4 — Policy mapping is method-shaped, not intent-shaped.** Mapping
  HTTP methods to the frozen action classes is conservative (POST needs a
  lease even for conceptually read-only endpoints). A future
  intent-level action classification (e.g. `api-read`/`api-mutate`) belongs
  to the policy package with its own review.
- **D5 — Text-assertion derivation is heading-only.** Derived `text:`
  assertions come from heading anchors only; richer DOM-state binding
  (per-control visibility, landmarks, `role=name` pairs) is DG-09 scope.
- **D6 — Non-deterministic response fields.** API replay expectations must be
  deterministic (status, fixed body fragments, fixed JSON fields); dynamic
  ids (e.g. `orderId`) cannot be asserted directly and required a read-back
  step keyed on a stable provider event id. DG-09 should specify how
  dynamic-field assertions are expressed (or explicitly banned).
- **Open Q1:** should observation-derived characterization replays be _run at
  all_ by default (they consume budget and can only ever produce `observed`),
  or only on demand? The spike runs them; the ledger (DG-07/#251) may prefer
  on-demand.
- **Open Q2:** API replay currently requires the caller to supply
  `resetAndSeed`; for true leased-fixture parity with stage 7
  (`packages/orchestrator-langgraph/src/fixture-coordinator.ts`) the lease
  lifecycle should be owned by the orchestrator, not the caller.

## 10. Provisional conclusions (pending cross-review)

1. **Observation-derived assertions are viable and sufficient to kill #257 by
   construction** on the measured population: capture → derive → bind →
   compile → verify ran end-to-end through the _unchanged_ compiler and
   verifier to `verified`, with the canned literal demonstrably failing the
   same app.
2. **API-level replay is viable under the existing trust spine**: attestation
   - policy + lease + origin + redaction + hash gates composed fail-closed
     around plain `fetch`, and the real `classifyVerification` gives it the
     same semantics as browser verification, including the only legitimate
     `verified` path for non-UI intents.
3. **The truth-state policy is a thin, pure, deterministic layer** that can
   sit above both executors without touching frozen contracts or verifier
   authority; ADR-004's observed-only rule is enforced by capping, not by
   refusing to replay.
4. **Residual risks** are D1–D6 above plus the general one that this is a
   spike: nothing here is wired into the CLI/pipeline, and no frozen contract
   changed.

Nothing in this report edits ADR-008; it is input to its Decisions 7–8
review.

[DG-03]: https://github.com/anthonykewl20/arxic/issues/247
