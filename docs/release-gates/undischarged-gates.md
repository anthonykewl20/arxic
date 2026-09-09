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
  omission coverage (#509/#516).
- Not delivered: semantic business-intent synthesis, source-to-runtime state
  mapping, and framework breadth beyond the implemented rulepacks. Source
  declarations do not reveal every hidden requirement, and the product must not
  claim they do.

### C2. #402 — richer connection/account and runtime management

- Named providers, default HTTP connections, provider-owned catalog refresh and
  runtime credentials are delivered (#470, default-catalog lane). Opaque
  host/gateway defaults still require an explicit named discovery adapter, and
  metadata never establishes execution entitlement.

### C3. #423 — pilot-scale corpus

- Spec bar: 1,000 adjudicated regions across >=10 families.
  **Delivered: 178 rows across 9 families**, with 47 recorded skips each carrying
  a reason. The number is reported, not padded.
- Two heads qualify on untouched test families (overflow; occlusion at 4/4 recall,
  0 false positives). Clipping, text_truncation and layout_shift stay **disabled**:
  no candidate threshold meets the precision/recall gates on 178 rows, and
  shipping a miscalibrated threshold is prohibited.

### C4. #423 — chronological holdout

- The merged corpus and its holdout share a capture window, so nothing yet shows
  the reviewer generalizing across **time** rather than only across families.
- A genuinely later capture became possible today (the corpus is dated
  2026-09-08). The data side is **not** the blocker: the third-party roots are
  present on this host — `koel`, `directus` and all five public families
  (`adminlte`, `gentelella`, `sb-admin`, `todomvc`, `todomvc-vendor`) under the
  path `ARXIC_VISUAL_THIRD_PARTY` resolves to. Verified 2026-09-09.
- The blocker is a **missing evaluate-only path**. `cli.ts corpus` runs
  `captureCorpusV2` and then `trainCorpusV2`, which retrains; there is no mode
  that captures fresh cases and scores them against the _already trained_
  artifact, which is exactly what a chronological holdout has to do. Building
  that mode plus running the capture is a slice of its own.
- Not attempted here, and not worked around. Recorded unmet.

### C5. #423 — model promotion

- Blocked by design and by measurement. No teacher calls, no paid training, and
  no automatic promotion. Promotion stays blocked while C3/C4 stand.

---

### C6. #402 — clean-install fresh live-provider campaign acceptance

Out of numeric order on purpose: [#546](https://github.com/anthonykewl20/arxic/issues/546)
was filed four minutes after this register was authored, and renumbering would
strand the `§C4` references already merged in
`docs/history/merged-slice-notes/WEB-402-CLOSURE.md` and posted on #423.

- **Already discharged, separately:** the packed clean-install server/worker
  distribution proof runs in required CI on every qualifying merge — the
  `package` job clean-room-installs the packed CLI tarball and drives the
  installed-dashboard matrix through the packed `arxic web`, including a campaign
  journey that launches a real selected campaign against the real
  reference-auth-app and asserts the real engine outcome. Separately, a dev-mode
  current-head paid campaign reached outcome `verified` (bounded $0.025, model
  glm-4.7; sanitized record staged at
  `docs/evidence/WEB-402-HEAD-CAMPAIGN/campaign-record.json`).
- **Still owed:** those two halves have never been proven _together_. Nothing yet
  shows a **packed clean-room install** whose live provider is configured through
  the **product surface** (Models & accounts / the provider-secrets API) rather
  than a server environment variable or the developer workbench's own SQLite,
  driving a real campaign to `verified` with two verifier replays. That
  combination is what an operator actually performs on a fresh machine, and it is
  the boundary the distribution-proof row in
  `docs/reviews/web-product-progress-402.md` states verbatim.
- **Blocker:** it spends against the owner's funded credential, so it must run in
  a session where the owner has authorized that spend. Recorded here; not
  machine-dischargeable on an agent's own authority.

## How to reopen

Any item here can be re-filed as its own issue when the blocking access,
decision or budget exists. Closing #402/#423 removes two stale trackers; it does
not convert any row above into a discharged gate.
