# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, plan.md,
playwright.config.ts, stages/*, artifacts/{00,03..13}.json (raw 01/02 dumps
excluded per standing curation; shas live in stages/*.json), fixtures/*,
tests/*.

Run context: campaign round 10 (post-#316 bounded landmark wait, PR #316).
HONEST OUTCOME: BOTH verification runs failed at the checkpoint screenshot
with 'declared mask locator inventory is missing or exceeds its bound' —
with the bounded-wait runtime verifiably baked in (fixtures/screenshot-
privacy.ts line 708 has the waitFor). Root cause (probed live): after the
Sign In click, directus navigates through a TRANSIENT EMPTY WINDOW — the
login form unmounts, the body renders nothing (landmarks=0, empty
innerText), and the admin app mounts ~500ms later. The wait can resolve on
the still-attached form and the subsequent per-tag count loop (slower in
the suite context: trace recording inflates each roundtrip) straddles into
the empty window → every count 0 → fail closed. Fix-315B's wait-then-probe-
ONCE is the flaw: a landmark that vanishes between wait-resolution and
counting defeats it. Follow-up: retry the probe until non-empty within the
bounded budget (bridges the window; never-mounting still fails closed).
Filed on #314 as the second follow-up. AC-4 still open — round 11 next.
