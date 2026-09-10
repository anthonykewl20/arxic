# Un-discharged release gates (recorded at tracker closure, 2026-09-09)

The #402 and #423 trackers are closed as **work items**. Closing them does not
discharge anything below, and **no release tag or publication is authorized** by
that closure — the same sentence #402 carried while open. Every item here is a
standing precondition for a promoted release; each says who can discharge it and
what would count as proof.

Truth states follow ADR §2. Nothing below is `verified`: an LLM may never assign
that state, and several of these exist precisely because a machine cannot.

---

## A. Owner-only gates (a machine structurally cannot discharge these)

### A1. Human screenshot inspection — `blocked` on the owner's eyes

- **Gate:** `docs/release-gates/screenshot-inspection.md`, steps 2-6.
- **State:** machine pre-pass complete and recorded
  (`docs/evidence/WEB-402-CENSUS-PRESCREEN/summary.md`): 344/344 PNGs under
  `docs/evidence/WEB-402-*` rendered and read, 344/344 provenance pairing
  machine-verified with zero orphans, no credential/token/session/PII observed,
  two non-credential findings raised (F1, F2).
- **Still owed:** the human pass at native resolution, and a signed-off
  `inspection-sign-off.md`. The gate document itself says an LLM cannot
  discharge it. The pre-pass narrows the work; it does not replace it.
- **Also uncovered:** the wider `docs/evidence/` tree holds 1,460 PNGs; only the
  344 in `WEB-402-*` were pre-screened.

### A2. Disposition of the published operator home path — `blocked` on an owner decision

- 305 tracked files contain the operator's absolute home path, including
  screenshots in `WEB-402-INSTALL` and the `WEB-402-DASHBOARD-UX` admin captures.
  The two **source** defaults that emitted it are fixed in this slice; the
  evidence and doc occurrences are not rewritten.
- **Decision needed:** accept (it is a username and directory layout, not a
  secret) or remediate (which for already-pushed public history means a rewrite,
  not a file edit).

### A3. Independent human release inspection — `blocked`

- #402's last acceptance bullet requires a human release inspection alongside
  the CI campaigns. Unchanged.

### A4. #423 human inspection package — `blocked` on the owner's eyes

- Package prepared and merged at `docs/evidence/VISUAL-SLM/human-review/`:
  seven before/current screenshot pairs across five real apps plus the
  deterministic per-head oracle verdicts and a checklist.
- Truth states there stay `observed` until a human marks them. The README names
  exactly which claim a human review would upgrade.

---

## B. Credential- and money-gated (blocked on access the host does not have)

### B1. Fresh paid Kimi / OpenCode Go / SuperGrok / OpenRouter inference — `blocked`

- One funded proof exists (#532, GLM Coding via the subscription plan, retained
  under `docs/evidence/WEB-402-PAID-INFERENCE/`). The other four have no
  credential on this host and no authorized spend.

### B2. Dashboard-driven browser login into provider accounts — `blocked`

- Requires interactive OAuth consent on the owner's real accounts. No sanctioned
  test tenants exist. The standing subscription-row decision keeps account login
  owned by server-installed native tools.
- **Not** the same as project-configured third-party SPA sign-in, which **is**
  delivered and proven against real dockerized koel (#538/#539, `901b5c11`).

### B3. #423 512 MiB VPS full-stack proof — `blocked`

- The window's founding directive prohibits infrastructure purchases. Measured
  capped-process memory/time proof exists; full-VPS qualification is explicitly
  **not** claimed and cannot be until an actual VM and deployment profile exist.

---

## C. Scope genuinely not built (honest `hypothesized`/absent, not blocked)

### C1. #402 — broader state / persona / feature-flag discovery coverage

- Delivered: persona variants (#491, #493), flag and state variants (#495),
  distinct-login-path persona variants (#500), per-route and configuration
  omission coverage (#509/#516), and a fourth discovery rulepack —
  **fastify-auth** (#560, observed 2026-09-10: framework `fastify >=4 <6`, six
  rules, range enforcement and real-fixture chain proof via the real sg engine;
  `test-fixtures/reference-fastify-auth-app`).
- Not delivered: semantic business-intent synthesis, source-to-runtime state
  mapping, and framework breadth beyond the implemented rulepacks (five packs
  shipped: nextjs, express, laravel, fastify — plus the react placeholder).
  Source declarations do not reveal every hidden requirement, and the product
  must not claim they do.

### C2. #402 — richer connection/account and runtime management

- Named providers, default HTTP connections, provider-owned catalog refresh and
  runtime credentials are delivered (#470, default-catalog lane). Opaque
  host/gateway defaults still require an explicit named discovery adapter, and
  metadata never establishes execution entitlement.

### C3. #423 — pilot-scale corpus

- Spec bar: 1,000 adjudicated regions across >=10 families.
  **Delivered 2026-09-10 (#557 slice 2, observed): the full registry captured —
  476 planned → 75 oracle-honest skips, each with a reason class
  (unstable-case 46, overflow-oracle-failed 17, no-text-element 8,
  text-truncation-oracle-failed 4) → 401 scored rows across all 10 families**
  (was 178 rows across 9). This was the registry maximum at the 10-family
  config: gentelella/adminlte are pinned to 1280, so no plan extension
  remained inside that config.
  The ≥1,000 bar stays open under the rows unit this register uses (residual
  ≥599 scored rows); the 401 cases also carry **1,778 non-null oracle labels**,
  which would clear 1,000 under a region-level-label reading of the literal
  wording — the unit choice is recorded, not decided, here. Reaching the bar
  honestly needs registry growth (~11+ more families, or new controlled
  variants — C5-adjacent), not width-grid padding.
  Evidence: [`docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10/`](../evidence/VISUAL-SLM/corpus-scale-2026-09-10/summary.md).
  **Delivered 2026-09-10 (#557 slice 4, observed): the registry grew to 11
  families — material-dashboard (slice 3) captured at the full width grid —
  56 planned → 9 reason-carrying skips (missing-element `unstable-case` ×4:
  the `my-auto`-centered card moves every input box when the control is
  removed; remote-subresource `page.goto` timeouts ×5: the only registry
  family with remote assets) → 47 scored rows carrying 210 non-null oracle
  labels**, with sb-admin-2 56/56 in the same run. Registry totals across the
  two labeled runs: **532 planned → 84 skips → 448 scored rows across 11
  families, 1,988 non-null oracle labels** (additive observations, not one
  plan); residual under the rows unit **≥552**.
  Evidence: [`docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10-s4/`](../evidence/VISUAL-SLM/corpus-scale-2026-09-10-s4/summary.md).
- Two heads qualify on untouched test families (overflow; occlusion at 4/4 recall,
  0 false positives). Clipping, text_truncation and layout_shift stay **disabled**:
  no candidate threshold meets the precision/recall gates on 178 rows, and
  shipping a miscalibrated threshold is prohibited.

### C4. #423 — chronological holdout — **ANSWERED 2026-09-10 (observed: no cross-time generalization)**

Recorded here as unmet while the evaluate-only path was missing; answered by
[#553](https://github.com/anthonykewl20/arxic/issues/553) once that path
shipped (#554) and the holdout ran against the retained trained artifact.
Kept in place so the register shows what was actually run and found.

- The evaluate-only mode (`cli.ts corpus-evaluate`, #554) scores fresh
  captures against the _already trained_ artifact with no retraining; a
  hash/mtime assertion over the trained artifacts proves the side-effect-free
  path, and the report binds results to the exact manifest/bin sha256s.
- **The holdout (2026-09-10, two days after the 2026-09-08 corpus):** fresh
  capture across the third-party roots (`koel`, `directus` via the rehearsal
  containers; `adminlte`, `gentelella`, `sb-admin`, `todomvc` +
  `todomvc-vendor` under `ARXIC_VISUAL_THIRD_PARTY`) — 252 planned cases, 66
  oracle-honest skips, 186 scored rows, artifact integrity sha-verified
  before the run.
- **Observed result for the artifact's only trained head (`clipping`,
  threshold 0.892): 0/65 recall (all controlled clipping regressions
  missed), 117/117 specificity on clean pages.** The reviewer does not
  generalize across time; the blocker was data-and-mechanism, and once both
  existed the measurement answered negatively. `promotion:
blocked-experimental-model` stays correct — see C5.
- Evidence: `docs/evidence/VISUAL-SLM/holdout-2026-09-10/` (sanitized: every
  PNG carries a privacy sidecar, leak-pattern grep over the retained set is
  zero-hit). Truth states: all numbers **observed**; `verified` stays with
  the human review gates, and independent human visual inspection of
  retained screenshots is still owed.

### C5. #423 — model promotion

- Blocked by design and by measurement. No teacher calls, no paid training, and
  no automatic promotion. Promotion stays blocked while C3/C4 stand.

---

### C6. #402 — clean-install fresh live-provider campaign acceptance — **DISCHARGED 2026-09-09**

Recorded here as un-discharged earlier the same day; closed by
[#546](https://github.com/anthonykewl20/arxic/issues/546) with an owner-authorized
live run. Kept in place rather than deleted so the register shows what was
actually closed and how.

- **Proof:** `docs/evidence/WEB-402-CLEAN-INSTALL-LIVE/` — a packed
  `arxic-0.0.401.tgz` clean-room-installed into an empty directory with its own
  `HOME` and a fresh per-run SQLite; the funded credential **deleted from the
  server's environment before spawn** and supplied only through
  `POST /api/provider-secrets` (the Models & accounts surface); one bounded
  campaign on the single `GET /login` row reaching `result.outcome: "verified"`.
- **Replays are measured, not inferred:** `ledger.verification` records
  `{"outcome":"verified","passedRuns":2,"runs":2}`. All thirteen executed engine
  stages completed and all eight gates passed.
- **Sad path proven first:** with no credential configured, the identical
  campaign on the identical discovery settled `blocked`/`blocked` (stage 5 failed
  closed). The runner treats a credential-less `verified` as a failure of the
  proof.
- **Credential never retained:** independently verified after the run — neither
  the value nor any 8-character prefix of it appears in the record; zero
  redaction substitutions were needed because it never entered the payload.
- **What this does not claim:** one row, one campaign — a path proof, not a
  coverage claim. Seven other extracted rows were not attempted and remain in the
  ledger. Limits are recorded in that directory's `summary.md`.

## How to reopen

Any item here can be re-filed as its own issue when the blocking access,
decision or budget exists. Closing #402/#423 removes two stale trackers; it does
not convert any row above into a discharged gate.
