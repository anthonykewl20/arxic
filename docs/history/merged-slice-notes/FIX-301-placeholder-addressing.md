# FIX-301-placeholder-addressing — staged doc updates (charter §10.2)

Issue: #301 · PR: #TBD · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #301 | [FIX-301-placeholder-addressing] exploration lane addresses fill controls label-only — placeholder-addressed forms (real directus login) block LOCATOR-AMBIGUOUS (F-E3A; blocks DG-12 exit) | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-24 | **#301 (FIX-301-placeholder-addressing) placeholder addressing in the exploration lane DONE.** Label-kind locator resolution and the DG-08 formScope filter now resolve label-first with placeholder fallback (#295 semantics; `getByLabel(...).or(getByPlaceholder(...))` union so an unhydrated page still settles through the attach-wait gate — no count probe before the wait). Red-first real-Chromium: a placeholder-only form (the measured directus login shape — zero <label>, getByLabel=0, getByPlaceholder=1) blocked semantic-ambiguous before, drives and submits after; two same-placeholder controls still block ambiguous (exactly-one gate intact, pinned by test). AC-4 rides here: SURFACE-009 now carries the login core's bounded failure cause (run-3's refusal was undiagnosable). **Next: #302 (harness front), then DG-12 round 4.** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-301 placeholder addressing in the exploration lane (#301): label-kind locators and the DG-08 formScope filter resolve label-first with placeholder fallback (the #295 semantics, third consumer — the real directus login page is placeholder-addressed: zero <label> elements, so every fill/submit blocked LOCATOR-AMBIGUOUS in campaign round 3). Implemented as a getByLabel().or(getByPlaceholder()) union so client-rendered controls still settle through the attach-wait gate; the exactly-one (unique control, unique form) gates are unchanged. SURFACE-009 additionally carries the login core's bounded failure cause.
```

## 4. `VERSION` bump required?

no — agent-adapter-internal addressing fix; no user-observable contract change (locator kinds unchanged).

## 5. Evidence pointers

- Real-world proof: `packages/playwright-agent-adapter/src/__tests__/placeholder-addressing.real-world.test.ts` — real Chromium against a raw placeholder-only form (no `<label>`, no aria-label — the live directus login shape measured in campaign round 3): fills resolve and the submit reaches the signed-in page; two same-placeholder controls still block `semantic-ambiguous`.
- Regression proof: the pre-existing client-rendered control test (attach-wait under hydration) stays green — the union locator waits, no premature count probe.
- AC-4: `packages/crawlee-adapter/src/__tests__/authenticated-crawl.real-world.test.ts` — the refused-login 009 message now matches `/login core: .+/` and still never leaks the persona secret.
- Artifacts: campaign round-3 evidence `docs/evidence/DG-12/*/runs/*-run{3,2}/` on `issue/256` (the measured finding).
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (adapter 48/48 + crawler 27/27 + orchestrator 203/203 = 278/278) ☐ license gate (CI)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                            | Expected disposition                                                                 | Test                                                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| placeholder-only form (no label/aria — directus shape), fill+submit with formScope | resolves and drives (observed)                                                       | `resolves and drives a placeholder-only form (label-first with placeholder fallback)`    |
| two controls sharing one placeholder                                               | blocked `semantic-ambiguous` — exactly-one gate intact                               | `still blocks ambiguous placeholder addressing (two same-placeholder controls)`          |
| client-rendered control (hydration)                                                | attach-wait still applies before the exactly-one gate (pre-existing test, unchanged) | `waits for a client-rendered control before applying the exactly-one gate`               |
| crawl-tier login refused                                                           | 009 blocked WITH bounded cause; anonymous crawl; no secret leak                      | `emits a blocked diagnostic and still maps the anonymous tier when the login is refused` |

## 7. Not done / known-weak spots

- The fallback treats a label match and a placeholder match as interchangeable addressing of the SAME control; a page with BOTH a `<label>Email</label>` control AND a different `placeholder="Email"` control could address either (union matches both → ambiguous → fail-closed; honest but conservative). No such page was observed; if one appears, addressing should prefer exact-label and fall back per-control.
- Driver post-click snapshot timing (snapshot fires before a server-redirect settles) is unchanged and out of scope — the accepted follow-up-snapshot polling pattern is used by the tests; the compile lane's post-action observation anchoring already handles it upstream.
- AC-3 (campaign round 4 proceeding past the fill blocks) executes under #256 after #302 (harness front) lands — koel first needs the front fixed to boot at all.
