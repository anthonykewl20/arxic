# FIX-306-transitions-observation-binding — slice note

Issue: #306 · Status: fixed on this branch, awaiting CI + AC-4 round-19 field proof · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #306 | [FIX-306-transitions-observation-binding] transitions binding derived at observation time — url-less fill/submit steps bind by step identity; navigate steps match trailing-slash-normalized URLs only; different paths still unobserved | ☑ done (code; AC-4 round 19 pending) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-25 | **#306 (FIX-306-transitions-observation-binding).** Field evidence (runs 5 AND 14–18): every promoted directus run still recorded four FALSE `ARXIC-EXPLORATION-TRANSITIONS-UNOBSERVED` decisions — all steps observed, all also "not observed". Both filed defects confirmed live: (1) url-less fill/submit steps are structurally unobservable under `successfullyObserved` (`if (!step.url) return false`); (2) navigate steps compare URLs byte-exactly (`…/admin` plan vs browser-normalized `…/admin/`). Run-blocking was already neutralized (the code emits observed severity since its introduction), so this rode as decision-log corruption — fixed because it is the exact defect the issue names. Fix: the drive loop records observed step identity AT OBSERVATION TIME (ok + no drift + a11y sha); url-less steps bind by identity; steps WITH a planned url keep URL semantics with trailing-slash normalization ONLY (different path/query/origin still unobserved — the sole and disclosed loosening). Red-first ×3: url-less fill+submit observed → no TRANSITIONS-UNOBSERVED (red pre-fix); `/admin` vs `/admin/` matches while `/admin` vs `/admin/login` stays unobserved (red pre-fix); failed observation still reports unobserved + not approved (AC-5 pin, passed pre-fix and after). **Next: DG-12 round 19 directus under #256 (AC-4: a promoted round with ZERO false transitions records).** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-306 transitions observation binding (#306): the exploration drive loop binds observed-ness at observation time — url-less fill/submit steps count by step identity (previously structurally unobservable), and navigate steps match trailing-slash-normalized URLs (browser normalization); a different path, query, or origin still does not match, and failed observations still report TRANSITIONS-UNOBSERVED.
```

## 4. `VERSION` bump required?

no — decision-log correctness inside stage 8; no contract, schema, or severity change (the diagnostic's observed severity, present since stage-8's introduction, is untouched).

## 5. Evidence pointers

- Defect evidence: `docs/evidence/DG-12/directus/runs/directus-dg12-run14/artifacts/08.json` decisions — `Observed "observe route /admin" at …/admin/` immediately followed by `ARXIC-EXPLORATION-TRANSITIONS-UNOBSERVED [observed] observe route /admin` (and the same for both fills and the submit); identical shape in runs 5, 17, 18.
- Fix: `packages/orchestrator-langgraph/src/exploration.ts` — `observedSteps` Set recorded in the drive loop at observation time; `successfullyObserved(step, evidenceRefs, observedSteps)` consults identity for url-less steps and `sameResourceUrl` (trailing-slash-only normalization) for planned-URL steps.
- Red-first tests: `packages/orchestrator-langgraph/src/__tests__/exploration.test.ts` — 'counts an observed url-less fill/submit step as observed (#306)' (RED pre-fix; needs a persona lease for the reversible submit, mirroring the existing lease test), 'matches a navigate step modulo a trailing slash, but not a different path (#306)' (RED pre-fix on both assertions' shape), 'still reports a required step whose observation failed as unobserved (#306 AC-5)' (fail-closed pin).
- Gates: orchestrator-langgraph 20 files / 211 tests; verifier + cli 23 files / 232 tests; typecheck/lint clean; `format:check` after this note: `All matched files use Prettier code style!`

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                              | Expected disposition                                                         | Test                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| url-less fill + leased submit observed successfully  | both count observed; NO transitions-unobserved records (observed, unit)      | 'counts an observed url-less fill/submit step as observed (#306)' |
| navigate planned `…/admin`, observed `…/admin/`      | same resource → observed (observed, unit)                                    | 'matches a navigate step modulo a trailing slash…'                |
| navigate planned `…/admin`, observed `…/admin/login` | different path → STILL transitions-unobserved (observed, unit)               | same test, second drive                                           |
| required step whose observation FAILED (`ok: false`) | transitions-unobserved AND run not approved (blocked semantics intact, AC-5) | 'still reports a required step whose observation failed…'         |

## 7. Not done / known-weak spots

- AC-4 executes as round 19 under #256 after this merges; the assertion is "a promoted directus round whose stage-8 decisions contain ZERO transitions-unobserved records" (runs 14/17/18 each carried exactly four false ones).
- Identity binding uses the step OBJECT reference within one exploration run — deliberately not a serializable identity (no run-to-run reuse); a future cross-run binding would need a stable step key.
- `sameResourceUrl` normalizes only a trailing slash; query/fragment/ordering differences still mismatch (could over-report unobserved on apps that reorder query params — unmeasured, no such case in the campaign data).
- The diagnostic's observed severity (vs blocked) predates this slice and is NOT re-litigated here; #306's original AC framing assumed it blocked the run, which the code never did post-#322-era severity map.
