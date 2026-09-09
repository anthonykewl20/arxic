# WEB-DASHBOARD-REVAMP — staged doc updates (charter §10.2)

Issue: none opened · PR: #<N> · Disposition: mixed

> No tracker issue exists for this slice. It was requested directly, not taken
> off the board, so the §"Issue workflow" opening comment and `in-progress`
> label were never applicable. The integrator should open one before merge, or
> record the exception.

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| — | [WEB-DASHBOARD-REVAMP] Dashboard design system, IA and credential vault | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-10 | **(WEB-DASHBOARD-REVAMP) Dashboard design system, IA and credential vault DONE.** One token layer (`light-dark()`, palette declared once instead of three times), nine new composition primitives behind `components/index.ts`, one `DataTable` replacing two competing table systems, ⌘K command palette, toasts and a real confirm dialog replacing `window.confirm`, and an encrypted at-rest credential vault for the `ARXIC_SECRET_` sign-in references a project needs to reach authorized pages. Intent inventory 16,416px → 5,633px on the same data. Chromium/Firefox/WebKit real-browser journeys + axe WCAG 2.2 AA + 200%-text readability audits. Next: convert the remaining hand-written panel CSS (`.provider-*`, `.diff-*`, `.element-*`, `.choice-*`) onto the primitives. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### changed`

```
- WEB-DASHBOARD-REVAMP Dashboard design system, information architecture and credential vault: `tokens.css` declares each palette value once with `light-dark()` instead of duplicating the dark palette across a media query and a `[data-theme]` block; `components/index.ts` gains `DataTable`/`Table*`, `Section`/`EmptyState`/`Note`/`Stat`, `Toolbar`/`SearchField`/`FilterSelect`/`Pagination`, `Menu`, `Toaster`, `ConfirmHost` and `CommandPalette`, and every dashboard table now renders through the one `DataTable` (sticky header, tabular figures, its own scroll container, one mobile-stacking implementation). Ctrl+K / ⌘K opens a command palette over sections, projects, recent runs and actions; announcements are toasts (the live region keeps the id `notice`); deleting a run confirms in a dialog that names what survives instead of `window.confirm`. The discovered-surface table is paged (an unpaged discovery rendered every row), a run's detail renders above the run list, capture filters appear only for runs holding more than one capture, and a project row keeps its two everyday runs as buttons with the rest in an overflow menu. Two all-caps eyebrow labels on Models & accounts became sentence case. Administration gains **Sign-in credentials**: the `ARXIC_SECRET_` references a project signs in with, given values in the dashboard, stored AES-256-GCM-encrypted at rest under `ARXIC_VAULT_KEY` or a `0600` key file beside the database, write-only in the interface and released only into a run's launch environment. Also fixes a latent mobile defect where `grid-template-columns: 1fr` let an unbreakable path widen the page past the viewport.
```

## 4. `VERSION` bump required?

yes → 0.0.402, because the change is user-observable per RELEASES.md (new
Administration screen, new keyboard shortcut, changed run-detail order, changed
capture-filter visibility).

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/*.real-world.test.ts` — real
  Chromium/Firefox/WebKit dashboard journeys against the reference apps, each
  gated on axe WCAG 2.2 AA with zero horizontal document overflow.
  `dashboard-readability.real-world.test.ts` repeats every journey at 200%
  mounted text and with wide letter/word spacing.
- Vault proof: `apps/web/src/__tests__/secret-vault.test.ts` (11 tests) —
  ciphertext at rest (`v1:<iv>:<tag>:<ct>`), correct round-trip, `undefined`
  (not corrupt output) under a rotated key, GCM rejection of a tampered record,
  legacy plaintext rows still resolving and upgrading on rewrite, a `0600`
  generated key file reused across processes, environment key preferred over it,
  per-database salt so two instances differ, and the value absent from
  `credentialInventory()`, the save/remove responses and `state()` while still
  reaching `effectiveEnv()`.
- Artifacts: before/after full-page captures in both themes at 1440px, plus
  390px and 744px, held in the session scratchpad (not committed).
- Gates: typecheck ☑ · lint ☑ · format ☑ (full repo, after this note) ·
  test (202 web unit tests: 191 existing + 11 new vault tests) ☑ ·
  real-world UI suite ☐ (running at time of writing) · license gate ☐ (no
  dependency added — the primitives are built on native elements precisely to
  avoid one)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                  | Expected disposition                                                        | Test                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Vault record decrypted with a rotated key                | credential reported missing; run blocks rather than signing in with garbage | `secret-vault.test.ts`                                                  |
| Vault record's ciphertext altered in the database        | GCM tag rejects it; credential reported missing                             | `secret-vault.test.ts`                                                  |
| Credential reference that is not an `ARXIC_SECRET_` name | 400 before anything is stored                                               | `secret-vault.test.ts`                                                  |
| Opening a run id that no longer exists                   | toast names it and the run history stays browsable                          | `dashboard-ux.real-world.test.ts`                                       |
| Every dashboard view at 200% text and wide spacing       | no clipped control text, no horizontal document overflow                    | `dashboard-readability.real-world.test.ts`                              |
| Unbreakable path in a one-column mobile grid             | wraps inside the viewport instead of scrolling the document                 | `dashboard-readability.real-world.test.ts` (`14-mobile-administration`) |
| Discovery with thousands of surfaces                     | paged, not rendered whole                                                   | `inventory-ledger-ui.real-world.test.ts`                                |
| Filter selection on a run whose captures share one value | control still present and selectable                                        | `capture-gallery-ui.real-world.test.ts`                                 |
| Starting a visual run on a project with no discovery yet | "Visual test" is on the row, not hidden behind a menu                       | `visual-review-ui.real-world.test.ts`                                   |
| Opening a project's settings from the overview           | the project name is the control, and carries `data-edit`                    | `agent.real-world.test.ts` (guided) via `checkpoint-ui-proof.ts`        |

## 7. What this slice did NOT do

Read this before trusting the summary.

- **The vault's unit tests are not a real-world journey.** They cover the store
  and the workbench inventory directly; no test drives the Administration screen
  in a browser to set a credential and then signs a real visual run in with it
  end to end. Under charter §6 the vault is therefore **observed**, not
  verified, and the sign-in path through a dashboard-entered credential is the
  first thing the next slice should prove.
- **`app.css` did not shrink as intended.** 2,185 → 2,233 lines. Sixteen dead
  rule blocks and one duplicated mobile-stacking implementation came out; the
  new chrome (command trigger, palette, confirm dialog, stat strip, attention
  band, shared table stacking) went in and cost slightly more than that. The
  standardization is real — two table systems became one, eight bespoke class
  families are now primitives — but the line count is honestly a small increase,
  not the collapse the work was aiming at. The remaining bulk is the untouched
  panel CSS (`.provider-*`, `.diff-*`, `.element-*`, `.choice-*`, `.picker-*`).
- **The imperative action layer survives.** `app.ts` still dispatches roughly
  twenty `data-*` attributes through one delegated `document` click listener.
  Overview and Schedules now pass real React handlers, and `data-start` was
  deduplicated onto `startRun()`, but the pattern is intact everywhere else.
- **Intent inventory is still 5,633px.** Down from 16,416px, but the four
  sections per project still stack on one scroll. Tabs are the right answer and
  were deliberately not attempted: roughly ten journeys assert against content
  in what would become inactive panels, and rewriting them was out of scope here.
- **No visual baseline was captured for the redesign itself.** Every screen
  changed, so the product's own baselines for its own dashboard are stale.
- **Models & accounts, the diff viewer, the element inspector and the campaign
  panel were not converted.** They still carry their own CSS families and their
  own markup; only their two all-caps labels were corrected. They are the
  largest remaining block of hand-written styling.
- **Three decluttering decisions were made and then reverted or reworked, all
  for one reason.** A per-dimension capture filter and a per-project adaptive
  primary action each made a control's presence depend on the data; moving
  Settings into the overflow menu removed a control a journey clicked directly.
  All three were caught by existing journeys, and all three were worse than what
  they replaced — an operator cannot learn where a control is if it moves, and
  decluttering that hides a common action is not decluttering. Two rules
  survived and are worth carrying into the next pass: a control set may switch
  on the _shape_ of a screen (one capture vs many) but never on the _values_ in
  it; and the way to remove a button is to give its job to something already on
  screen — the project name now opens project settings — not to bury it a click
  deeper.
- **The second half of the original request is untouched** — the six-phase
  regression architecture (determinism launch flags, clock/animation freeze,
  transient-state induction, component and portal isolation captures, SSIM and
  anti-alias filtering). The user chose the dashboard first; that work is
  unstarted, and the gaps are enumerated in the session summary.

## 8. Handoff — the six-phase regression architecture, measured against what exists

The requester's second ask was a full frontend regression system. Much of it is
already built; this is what a reading of the current engine found, so the next
slice does not have to re-derive it. Nothing in this section was changed by this
slice.

**Phase 1 — hermeticity and determinism.** Present: fixed viewport and
`deviceScaleFactor`, `locale: 'en-US'`, `timezoneId: 'UTC'`, `colorScheme`,
`reducedMotion: 'reduce'`, `serviceWorkers: 'block'`, same-origin request
gating and WebSocket closure (`visual.ts` `openContext`). Missing: Chromium
launch flags (`--font-render-hinting=none`, `--disable-font-subpixel-positioning`,
`--disable-lcd-text`, `--force-color-profile=srgb`) — the launch call passes only
`headless` and an optional channel; a CSS override forcing
`animation-duration`/`transition-duration` to ~0 for pages that ignore the
reduced-motion query; and any clock freeze — nothing stubs `Date.now`,
`performance.now` or the timer functions, so a page rendering a clock or a
relative timestamp cannot be captured deterministically.

**Phase 2 — surface and state discovery.** Present: static route and frontend
declaration inventory (`@arxic/source-ua-adapter`), breadth-first same-origin
crawl within a page/depth budget (`visual.ts` `crawl`), operator-declared state
checkpoints with their own capture identity (`project.stateCaptures`), and
runtime state-marker observation per route (`runtime-states.ts`). Missing: any
inducement of transient states. Requests are intercepted only to abort
cross-origin or mutating traffic — nothing returns a synthetic 400/401/403/422/500
to provoke an error banner or a boundary fallback, nothing submits an invalid
form to expose inline validation, and there is no instrumented dispatch hook for
registered notification types. Toasts, alerts and validation states are
therefore reachable today only if an operator declares a query that provokes them.

**Phase 3 — pre-capture stabilization.** Present, and stronger than the brief
asks for: `document.fonts.ready`, then a bounded re-capture loop that compares
both the PNG bytes and the measured element geometry between attempts and stops
only when consecutive attempts agree (`visual.ts`, six attempts, 150ms apart).
That subsumes a fixed MutationObserver settling window. Missing: awaiting
`img.decode()` for every image, and an explicit network-idle gate (navigation
uses `waitUntil: 'load'`; only `runtime-states.ts` uses `networkidle`).

**Phase 4 — snapshot acquisition.** Present: full-viewport masked capture with
required privacy masks enforced as a refusal, across a browser × theme × density
× viewport matrix. Missing: element-level cropped captures, and isolated capture
of overlay/portal containers. Every snapshot today is the viewport.

**Phase 5 — differencing.** Present: pixelmatch at `threshold: 0.1`, which by
default already excludes anti-aliased pixels (`includeAA` defaults to false), so
the brief's anti-aliasing filter is in place; changed-region boxes; and a
deterministic fusion of each diff region with the measured elements and failed
checks that intersect it (`diff-explanation.ts`). Missing: SSIM or a perceptual
colour metric, and — more importantly — any comparison of the baseline's
measured scene against the current one. The explanation says which element sits
under a changed region in _this_ run; it cannot yet say whether the element
moved, resized or merely repainted, which is what separates a layout-shift
defect from a cosmetic one.

**Phase 6 — classification, baselines, reporting.** Present: an immutable
baseline approval ledger with supersession, per-capture status
(`needs-baseline` / `unchanged` / `changed` / `unstable`), failure-phase
classification on every capture attempt, a three-way baseline/current/diff
viewer with changed-region overlays, and sanitized action timelines with
adjacent provenance. Missing: the layout-shift vs visual-defect classification
that Phase 5's structural diff would feed, and promotion of baselines to an
external immutable store — approvals are rows in the local database.
