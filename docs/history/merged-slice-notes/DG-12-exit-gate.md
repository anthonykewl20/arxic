# DG-12-exit-gate — staged doc updates (charter §10.2)

Issue: #256 · PR: (this PR) · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #256 | [DG-12] EXIT GATE: ALL-domain intent extraction proven on two real third-party apps | ☑ done — PASSED: directus run3+run4 and koel run24+run25 pairs both verified+promoted; G-1..G-7 all PASS by script (`docs/evidence/DG-12/EXIT-REPORT.md`); ADR-008 flipped Accepted (this PR, strictly last); five gate-findings + #324 closed with the lane's proof |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-05 | **#256 (DG-12-exit-gate) EXIT GATE PASSED — ADR-008 Accepted.** Model-transport repaired first (proxy timeout #389/#390; provider glm-5.3 amendment 3; ceiling $2.50 amendment 4; runs 16–22 reconciled per the DG-11 manual-repair procedure), then the koel lane completed its first-ever full campaigns: run24 + run25 both `verified` + PROMOTED (2/2 clean replays each; bundles under `koel/runs/promoted/`). All gates by script on BOTH apps: G-2 coverage 100% (105/105, 315/315), G-3 grounded/extracted 100% both (all-rows 78.10%/96.51% disclosed; CCR operationalization), G-4 replay 2/2 = 100% ≥ 90%, G-5 zero fabrication, G-6 real-model citations + validator secrets 0, G-7 determinism rebuild + two-run PASS (sampling variance OBSERVED-attributed). Pre-exit history (23 koel attempts, quarantined directus pairs) retained under `archive-pre-exit/` + manifests; exit report `docs/evidence/DG-12/EXIT-REPORT.md`; ADR-008 flipped Accepted as the strictly-last artifact. Gate findings #350/#352/#356/#362/#364 and #324 closed with the lane's proof. Next: #244 tracker close + integrator docs fold. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### internal`

```
- DG-12 exit gate (#256): ALL-domain intent extraction proven on both ratified third-party apps (directus, koel) — two clean verified+promoted campaigns per app; all six ADR-008 exit criteria passed by script (coverage 100%, grounded/extracted 100% both apps, replay 2/2, zero fabrication, real-model citations, determinism); koel campaign templates carry the ratified origin set + glm-5.3 provider; 23 pre-exit koel attempts retained under archive-pre-exit with per-run causes; ADR-008 flipped Proposed→Accepted.
```

## 4. `VERSION` bump required?

no — version-neutral milestone by owner directive (2026-08-16); the release version is decided at release time

## 5. Evidence pointers

- Real-world proof: two real third-party apps at ratified pins — directus `cb846b6a…` (runs 3+4), koel `dfec91f…` (runs 24+25, real glm-5.3 telemetry 48+52 calls, $0.99 total measured spend); real Chromium replays through the campaign AttestationFront
- Artifacts: `docs/evidence/DG-12/EXIT-REPORT.md`, per-app `assertion-logs/` (sweep + determinism + real-model citation), `koel/runs/promoted/*.bundle.json`, `archive-pre-exit/README.md`
- Gates: G-1 campaigns executed (4 promoted runs) · G-2/G-3/G-4/G-5/G-7 sweeps exit 0 · G-6 citations + `validate-records` secretFindings 0, live-key clean · G-8 this flip PR (ci green, merged last)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                     | Expected disposition                                                                                              | Evidence                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| koel stage-10 under an incomplete origin template (run21)   | fail-closed `ARXIC-COMPILE-ORIGIN-DENIED`, promotion skipped, attempt recorded + config corrected with disclosure | run21 record + #256 amendment 4                                |
| recording-proxy abort on >120s reasoning calls (runs 17/18) | accounting gap → run INVALID → headroom frozen until manual repair                                                | #389 fix + #390 closure + reconciled records                   |
| unpriceable model id (run19) / stale provider string        | #337 pre-call refusal, zero calls, $0                                                                             | run19 + amendment 3                                            |
| transient upstream error burst (run22)                      | blocked after bounded retries; gap calls reconciled zero-cost; headroom unfrozen per the DG-11 repair procedure   | run22 events + ledger                                          |
| operator-session interruption mid-run (run20)               | no record invented; partial dir retained; spend bounded by the preflight estimate                                 | run20 partial dir + #256 comment                               |
| every blocked historical attempt                            | recorded, cause-attributed, remediated — never deleted                                                            | `archive-pre-exit/README.md` (23 runs), QUARANTINE-MANIFEST.md |
