# DG-12 exit report — ALL-domain intent extraction proven on two real third-party apps

Gate issue: #256 · Milestone: ALL-Domain Business Intent Extraction (#244) ·
Report assembled 2026-09-05 from recorded machine artifacts; every ratio below
is script-asserted (logs retained under `<app>/assertion-logs/`), never
eyeballed.

## Ratified targets (decision 1, #256 comment 5463117847)

| app | stack | pin | gate pair |
| --- | --- | --- | --- |
| directus | TypeScript/JavaScript | `cb846b6a1ddc4811359bc52b74bb31a42eab33db` | `directus-dg12-hostbound-run3` (restored byte-identical from quarantine, zero-findings validator proof) + `directus-dg12-hostbound-run4` (fresh) — both `verified` + promoted |
| koel | PHP/Laravel 13.24 | `dfec91ff290509c622ff7cf392fb5e506841ee2b` | `koel-dg12-hostbound-run24` + `koel-dg12-hostbound-run25` (fresh, post-#385 tree, glm-5.3 real-model telemetry through the recording proxy) — both `verified` + promoted (bundles under `koel/runs/promoted/`) |

## The six ADR-008 exit criteria — all PASS by script on BOTH apps

| # | criterion | script | directus | koel |
| --- | --- | --- | --- | --- |
| 1 | ledger covers 100% of the inventory denominator, disposition per row | `dg12-coverage.mjs` (G-2) | 105/105, 100% join | 315/315, 100% join (both runs) |
| 2 | grounded intents ≥ 80% | `dg12-grounded-ratio.mjs` (G-3; CCR denominator: grounded/`extracted`, all-rows disclosed) | 82/82 extracted = **100%** (all-rows 82/105 = 78.10%, the structural ceiling: 23 parse-error/scan-diagnostic rows) | 304/304 extracted = **100%** per run (all-rows 304/315 = 96.51%) |
| 3 | ≥ 90% of attempted replays verify across two clean runs | `dg12-replay-ratio.mjs` (G-4) | 2/2 = 100% | 2/2 = 100% (1/1 per run) |
| 4 | zero fabricated intents | DG-07 fail-closed resolvability + `dg12-fabrication-audit.mjs` (G-5) | 0 dangling refs | 0 dangling refs |
| 5 | ≥ 1 real-model, non-stub run per app | citation logs (G-6): `directus/assertion-logs/real-model-citation.md`, `koel/assertion-logs/real-model-citation.md` | host-bound transport (decisions trail; $0 metered) | glm-5.3 over the z.ai coding endpoint: 48 + 52 telemetry rows, $0.4667 + $0.5212 measured |
| 6 | repeat-run determinism | `dg12-determinism.mjs` (G-7) | rebuild byte-identical modulo `generatedAt`; two-run comparison PASS (model-sampling variance OBSERVED-attributed) | rebuild byte-identical modulo `generatedAt`; two-run comparison PASS (OBSERVED-attributed) |

Sweep assertion logs: `directus/assertion-logs/sweep-run3-run4.log`,
`directus/assertion-logs/determinism-rebuild-run3.log`,
`koel/assertion-logs/sweep-run24-run25.log`,
`koel/assertion-logs/determinism-rebuild-run24.log` — every log ends
`DG12 GATE: PASS` / `DG12 SWEEP: PASS`.

## Redaction / evidence hygiene (C-9, G-6)

`validate-records.ts --live-key-env ARXIC_MODEL_API_KEY` over both app
directories: **secretFindings 0, problems 0, live-key scan clean** (koel: 2
gate-pair records + 42 archived history records + 5 refusal records accounted;
directus: 2 records + quarantined-pair manifest). No raw trace ZIPs retained;
persona values appear only as SHA-256 commitments in environ proofs.

## Spend accounting

- koel: cumulative **$1.6395315 / $2.50** (ceiling amended from $1.00 by
  recorded decision before measurement — glm-5.3 reasoning tokens inflate
  ~2.7× the gpt-4o-mini-calibrated estimate; see #256 amendments 3–4).
  Every ledger entry accounted; accounting-gap events reconciled in-record
  (runs 16/18/22: zero-token error calls).
- directus: cumulative $0.02318635 / $1.00 (host-bound $0-metered transport;
  historical glm-5.3 pricing correction recorded in `CORRECTION-337-glm53-pricing.md`).

## Honest attempt history (never deleted; `koel/runs/archive-pre-exit/README.md`)

The koel lane recorded 23 pre-exit attempts, each with a distinct remediated
cause (model-timeout, locator, origin, storage-state, start-state,
submit-binding, endpoint, pricing-gate, template, and transient upstream
classes — all traced to merged fixes on main or recorded config amendments).
Directus history: quarantined pre-exit pairs + the SP-5 quarantine manifest.
Every defect found during exit runs became a FINDING + issue + fix on main
outside the gate slice (#350, #352, #356, #362, #364, #383, #390 — all closed
with this lane's proof).

## Decision trail (all recorded on #256 before the measurements they govern)

Targets/spend/threshold ratifications (5463117847) · lemonsqueezy app origin
(5481267509) · assets origin (5492405255) · gravatar (5493582849) · G-3
denominator CCR + DECISION (2026-09-04) · provider `glm-5.3` (amendment 3) ·
ceiling $2.50 + origins-template correction (amendment 4).

## Conclusion

All six exit criteria pass by script on both ratified third-party apps. Per the
frozen contract, ADR-008 flips Proposed→Accepted citing this report — the
strictly-last artifact of #256.
