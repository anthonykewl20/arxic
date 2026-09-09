# Clean-install fresh live-provider campaign acceptance (#546)

Owner-authorized live run, 2026-09-09. Runner:
`scripts/clean-install-live-campaign.mts`. Retained record:
`campaign-record.json` (+ adjacent `.sanitization.json`).

The packed-distribution proof and the paid-inference proof each already existed.
This closes the gap between them: they had never been proven **together** — a
packed clean-room install whose live provider is configured through the
**product surface**, driving a real campaign to the engine's own outcome.

## Result

| Acceptance | Evidence |
| --- | --- |
| 1. Packed tarball, clean-room install, empty per-run sqlite, no inherited state | `arxic-0.0.401.tgz` built by `npm pack` from `apps/cli`, installed into an empty directory with its own `HOME`; server started with `ARXIC_WEB_STATE_DIR` pointing at a fresh directory and `ARXIC_WEB_PORT=0`. `installation.inheritedState: false`. |
| 2. Live provider configured through the product surface, value never echoed | `POST /api/provider-secrets {connection:"glm-coding"}` — the same endpoint Models & accounts uses. `ARXIC_SECRET_GLM_CODING_KEY` was **deleted from the server's environment** before spawn, so the credential could only arrive through the API. `provider.serverEnvironmentCarriedCredential: false`. |
| 3. Real target, real discovery, one bounded campaign | Real `reference-auth-app` fixture, per-run seeded persona; discovery on the installed server; one campaign on the single `GET /login` row (`inv:page:GET:7db4b8bf2d28`), per-pass-login persona, model `glm-4.7`, `modelBudgetUsd` 0.025. |
| 4. Outcome `verified` with two real verifier replays | `result.outcome: "verified"`, engine `status: "completed"`. **`ledger.verification: {"outcome":"verified","passedRuns":2,"runs":2}`** — the replay count is measured in the ledger, not inferred from `execution.ts:217`. |
| 5. Sanitized evidence; sad path proven | Record below. Sad path: with **no** credential configured, the identical campaign on the identical discovery returned `blocked`/`blocked`. |
| 6. Scripts + evidence only | `scripts/clean-install-live-campaign.mts` and this directory. No product code changed. |

## Pipeline

All thirteen executed stages completed and every gate passed:

`0 attestation · 1 deterministic-scanning · 2 structural-extraction · 13 domain-inventory · 3 framework-rules · 4 inference-orchestration · 5 bounded-discovery · 6 reconciliation · 7 fixture-prep · 8 targeted-exploration · 9 workflow-compiler · 10 verification · 12 promotion`
(`11 healing` deferred — nothing to heal.)

Gates: `attestation`, `inventory-completeness`, `fixtures`, `exploration-approval`, `compile`, `verify`, `intent-ledger`, `promotion` — all `passed: true`.

Ledger: 9 inventory rows (8 extracted, 1 unextracted-with-reason), candidate
`prop:455b8503247396ab`, `GET /login` extracted in the `login` domain with 5
intents. Coverage denominator derived from the runtime-fused domain inventory
(14 rows). Source commit of the scanned repository `976e9ad3`; Arxic head
`45d70828`.

## Sad path (charter §4, proven first)

Before the credential was configured, the same campaign on the same discovery
run was launched. It did **not** silently succeed and it did **not** invent a
result: the run settled `blocked` with outcome `blocked`, engine stage 5
(`bounded-discovery`) failing closed with decision `"Stage failed closed"`. The
runner asserts explicitly that a credential-less campaign reaching `verified`
is a failure of the proof.

## Credential handling

- Read in-process from the operator's live workbench store, `POST`ed once into
  the clean install, never printed, logged or written.
- Only the SHA-256 fingerprint prefix `7694ef46cce6` appears anywhere — the same
  fingerprint #532 and #546 cite.
- Independently verified after the run: the credential value does **not** appear
  in the retained record, **nor does any 8-character prefix of it**. Zero
  redaction substitutions were needed, because the value never entered the
  payload in the first place.
- `campaign-record.sanitization.json` carries the record's SHA-256; verified to
  match the file as written.

## Honest limits

- **`engineArtifacts` is null.** The runner tries to copy `run.json`,
  `intents.json` and `diagnostics.json` from
  `<state>/runs/<id>/engine`, and all three came back `null` — the installed
  server's run-directory layout differs from the developer workbench's, which is
  where that path came from. Nothing is lost: the authoritative engine record is
  embedded in `result.engineRun` (13 stages, 8 gates, full config) and
  `result.ledger` (verification counts, per-row dispositions). Re-running purely
  to populate a redundant field would spend against the funded credential again,
  so the null is recorded rather than chased.
- **One row, one campaign.** This proves the path end-to-end; it is not a
  coverage claim. Seven other extracted rows were not attempted and remain in
  the ledger.
- **Chromium is provisioned inside the clean room** (`npx playwright install
  chromium`), matching `scripts/human-flow-e2e.mjs`. Browser binaries are a host
  prerequisite, not product state; the first attempt omitted this and stage 5
  failed closed, which is what surfaced the requirement.
- **The `sadPath.kind` label reads `blocked-at-execution`.** That is accurate
  here, but the runner would also apply it to a campaign that *completed* with a
  non-verified outcome. The `detail` field always carries the true
  `state/outcome` pair, so the record is unambiguous either way.
- This discharges #546 only. The human screenshot-inspection gate and every
  other row in `docs/release-gates/undischarged-gates.md` are untouched.

## Reproducing

```sh
pnpm exec tsx scripts/clean-install-live-campaign.mts
```

Requires the funded `ARXIC_SECRET_GLM_CODING_KEY` in the operator's live
workbench store and spends one bounded campaign against it. Do not run it
without the owner's authorization in the session that runs it.
