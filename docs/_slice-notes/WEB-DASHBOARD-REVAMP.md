# WEB-DASHBOARD-REVAMP — staged doc updates (charter §10.2)

Issue: none opened · PR: #<N> · Disposition: mixed

> No tracker issue exists for this slice. It was requested directly, not taken
> off the board, so the §"Issue workflow" opening comment and `in-progress`
> label were never applicable. The integrator should open one before merge, or
> record the exception.

Two waves on `feat/dashboard-revamp`. The first built the design system and the
regression engine; the second re-conceived what the dashboard is _about_, after
the operator read the result and said, of the intent inventory, "this is NOT for
human".

| Commit     | Subject                                                             |
| ---------- | ------------------------------------------------------------------- |
| `35f5264d` | dashboard design system, information architecture, credential vault |
| `e62011c3` | rendering determinism and induced error-state capture               |
| `12448665` | isolated region captures and layout-shift classification            |
| `ac244d26` | stop an empty environment variable shadowing a stored credential    |
| `a92b8172` | tab the intent inventory, campaign surfaces in a table              |
| `abff2e60` | Models & accounts on the shared empty-state and note primitives     |
| `13fb7c00` | make the dashboard about pages, in words a person reads             |
| `757b5c8a` | say what the coverage table holds in ordinary words                 |
| `b88c85fc` | follow the re-cut through the journeys that assert on it            |

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| — | [WEB-DASHBOARD-REVAMP] Pages as the dashboard's subject, the changes review queue, one plain vocabulary, project environments and per-project sign-in details — on the design system, regression determinism, induced states, isolated captures and the credential vault | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-10 | **(WEB-DASHBOARD-REVAMP) Dashboard revamp + regression engine + the re-cut for people DONE.** The dashboard is now about PAGES. The inventory had been the source tier's route table — one row per HTTP method per path, `POST /api/albums` beside `/login`, every row stamped `Hypothesized extracted` — which the operator read and called "NOT for human". Pages is the home view: a card per page a browser can open, with a real screenshot, a name in words, the checks that ran, and a Run test that photographs THAT page (runs accept a `paths` scope, intersected with what the project covers). Changes is the review queue and the only navigation entry carrying a count; approving is the decision, so it reads the baseline pointers, not a capture's immutable `status`. `plain-words.ts` is one vocabulary with every engine term kept as `term` behind "Show technical names", and nothing claims more than was measured — text contrast reports only when it fails, an unstable capture withdraws its overflow claim. Projects record development/staging/production, which is what lets an AI walkthrough ask before acting on the real site and lets nothing else ask at all; sign-in details are set from the project that needs them. Video stays refused (frames cannot carry privacy masks); the sanitized action log is rendered readably instead. Six defects found on the way, including a screen reader announcing "2form fields" and a review queue 20,482px tall. |
| 2026-09-10 | **(WEB-DASHBOARD-REVAMP) Dashboard revamp + regression engine DONE.** One token layer (`light-dark()`, palette declared once instead of three times), nine composition primitives behind `components/index.ts`, one `DataTable` replacing two table systems, ⌘K palette, toasts, real confirm dialogs. Intent inventory 16,416px → 2,452px on the same data via tabs. Encrypted credential vault, verified end to end by a browser journey that types a password into Administration and signs a real run in with it. Regression engine: Chromium raster flags, forced animation end-state, frozen wall clock, image-decode readiness, induced 4xx/5xx and empty-form states, automatic overlay/portal isolation, component isolation, and baseline-vs-current structural diffing that separates a layout shift from a repaint. Proved on real Chromium/Firefox/WebKit. Next: convert the remaining wizard and diff-viewer CSS; promote baselines to an external store. |
```

## 3. `CHANGELOG.md` — entries under `## [Unreleased]`

### changed

```
- WEB-DASHBOARD-REVAMP Dashboard design system and information architecture: `tokens.css` declares each palette value once with `light-dark()` instead of duplicating the dark palette across a media query and a `[data-theme]` block; `components/index.ts` gains `DataTable`/`Table*`, `Section`/`EmptyState`/`Note`/`Stat`, `Toolbar`/`SearchField`/`FilterSelect`/`Pagination`, `Menu`, `Toaster`, `ConfirmHost`, `CommandPalette` and `Tabs`, all on native elements so no dependency is added. Every dashboard table renders through the one `DataTable` (its own scroll container, tabular figures, one mobile-stacking implementation). Ctrl+K / ⌘K opens a command palette over sections, projects, recent runs and actions; announcements are toasts (the live region keeps the id `notice`); deleting a run confirms in a dialog naming what survives. Intent inventory presents surfaces, workflows and declarations as tabs rather than one 16,416-pixel scroll, and the discovered-surface table is paged. A run's detail renders above the run list; capture filters appear only for runs holding more than one capture. Fixes a latent defect where `grid-template-columns: 1fr` let an unbreakable path widen the page past the viewport at 200% text.
```

### added

```
- WEB-DASHBOARD-REVAMP Pages is the dashboard's home view. One card per page a browser can open — a real screenshot, a name in words (`/login` reads as "Sign in"), the checks that ran, and one action, Run test, which photographs that page alone (`POST /api/projects/:id/runs` accepts `paths`, intersected with what the project already covers so it can never point the engine at a path nobody configured). Opening a page shows how it looks at each state and screen size, what it is made of (element counts — never the page's text, which the measurement pipeline deliberately never retains), every check as a sentence, what Arxic did to reach and photograph it, the source files it comes from, and the decisions still waiting. `page-inventory.ts` builds it from the state snapshot the dashboard already polls: no extra request, no engine change.
- WEB-DASHBOARD-REVAMP Changes is the review queue, and the only navigation entry carrying a count. Each pending change shows the environment, the size of the difference, what changed by element kind, and the two pictures whole, with the full swipe/overlay viewer one disclosure below. A change stays pending until a person decides; approving IS the decision, so the queue reads the baseline pointers rather than a capture's `status`, which records what a run measured and never changes.
- WEB-DASHBOARD-REVAMP `plain-words.ts` holds one vocabulary for the whole dashboard: `needs-baseline` reads as "First look", `unlabeled-inputs` as "N fields have no label", `hypothesized` as "Read from your code". Every term keeps its engine word as `term`, so precision is one disclosure away rather than lost — "Show technical names" reveals the identifiers beside the sentences. A check is reported as passing only where the pipeline measures it unconditionally: text contrast appears when it fails and never as a pass, because it is measured only when the capture yielded text-paint evidence, and an unstable capture withdraws the overflow claim rather than reporting clean.
- WEB-DASHBOARD-REVAMP A project records which copy of a site it points at — development, staging or production — surfaced on the projects table and on every page. It is what lets an AI walkthrough, or a state checkpoint that submits forms, ask before it acts on the site customers use, and lets nothing else ask at all. Unset reads as development: never guess that an unclassified project is production, nor that a production one is safe to submit forms on.
- WEB-DASHBOARD-REVAMP A project's sign-in details can be set from the project's own menu, into the same write-only encrypted vault, with the reference name suggested from the project (`ARXIC_SECRET_AURORA_EMAIL`) so it stays placeable in a vault list or a server environment. Connecting a site behind a login no longer means leaving the dialog half-finished to visit another screen.
- WEB-DASHBOARD-REVAMP The sanitized action log is rendered readably instead of linked as raw JSON — "Opened the page in Chrome, light, phone" — on a run, and narrowed to one page's own steps on that page. This is what stands in for a recording: video frames cannot carry the privacy masks a screenshot gets, so `recordVideo` stays refused, and `action-log.ts` joins steps to captures by the checkpoint each capture's id encodes, returning nothing rather than attributing another page's work to this one.
- WEB-DASHBOARD-REVAMP Rendering determinism (`determinism.ts`): Chromium font-hinting, subpixel, LCD-text, colour-profile and raster flags; an injected stylesheet forcing every CSS animation and transition to its END state, because the context can only ASK for reduced motion and pages ignore it; a frozen wall clock so rendered dates and relative times repeat. `performance.now`, rAF and the timers are deliberately left running — pinning them renders script animations at their first frame while CSS sits at its last, and stalls anything that waits on a timer. Readiness awaits image decoding; images that cannot decode are reported, not refused.
- WEB-DASHBOARD-REVAMP Induced states (`state-induction.ts`): a state checkpoint may answer the page's own data requests with a status from a closed list, so error banners and boundary fallbacks render, or submit its forms empty to provoke inline validation. Document navigation is untouched, the fault route never forwards what it answers, and the capture context still aborts every non-GET, so both stay read-only against the target. Alerts, live regions and open dialogs are recorded on the capture as geometry only. A checkpoint that answered no request, found no form or raised no surface says so as a finding.
- WEB-DASHBOARD-REVAMP Isolated captures (`element-capture.ts`): overlays and portals are captured in isolation automatically, and declared component selectors alongside them. Each region is its own capture record with its own spec hash, so a component is compared against its own baseline and a sibling's height change no longer reports it as altered. Regions are cropped from the already-masked viewport bytes, so an isolated capture is a strict subset of pixels that already passed the privacy pipeline.
- WEB-DASHBOARD-REVAMP Change classification (`structural-diff.ts`): the baseline's and the new capture's measured layout trees are compared, matching nodes by tree path rather than array position, and each changed region is classified as content-change, layout-shift, visual-change or unclassified. Both assessments must still hash to what their capture recorded. The run detail states the conclusion — "Layout moved: elements changed position or size" — not the category name.
- WEB-DASHBOARD-REVAMP Sign-in credentials (Administration): the `ARXIC_SECRET_` references a project signs in with, discovered from project and campaign declarations, given values in the dashboard and stored AES-256-GCM-encrypted at rest under `ARXIC_VAULT_KEY` or a `0600` key file beside the database. Write-only in the interface; released only into a run's launch environment.
```

### fixed

```
- WEB-DASHBOARD-REVAMP A page photographed on desktop and on a phone reported the same defect twice, and two identical sentences read as two separate problems. Findings now collapse per kind, keeping the worst measurement.
- WEB-DASHBOARD-REVAMP The element census used flex gap where a screen reader needs a space, so it announced "2form fields".
- WEB-DASHBOARD-REVAMP Connecting a project landed on a screen with nothing on it — a new project has no pages yet — hiding the next thing to do. Saving a new project now lands on Projects, and Pages' empty state names the step.
- WEB-DASHBOARD-REVAMP Navigating away from an open page kept its name in the heading, so the Changes queue announced itself as "Sign in".
- WEB-DASHBOARD-REVAMP `text-transform: capitalize` on every pill was right while pills held engine words and wrong the moment one held a sentence ("2 To Review"). The capitalisation moved to the one caller that shows an engine word.
- WEB-DASHBOARD-REVAMP An empty environment variable no longer shadows a stored credential: a shell profile exporting `ARXIC_SECRET_X=` erased the vault entry and the run refused with "set it in the server environment", pointing the operator away from the value they had just entered. An empty variable carries no credential and is no longer an override; a real one still wins.
```

## 4. `VERSION` bump required?

Not on this branch — at fold time, and by the integrator.

The change IS user-observable per RELEASES.md (new Administration screen, new
keyboard shortcut, tabbed intent inventory, changed run-detail order, new
capture kinds, a new classification on every compared capture), so it warrants
a patch bump when folded. But `VERSION` moves in its own
`docs(integrate): fold … + VERSION 0.0.40x` commit — five precedents in the
history, and twenty-one commits have landed on main since 0.0.401 without one —
and the bump is made with `pnpm version:patch`, which aligns `VERSION` and every
workspace manifest together rather than by hand.

Suggested: `0.0.402`, folded together with whatever other notes are outstanding.

## 3b. CHANGELOG house style

The entries in §3 are grouped under `### changed` / `### added` / `### fixed`,
which this repository's `[Unreleased]` section does not use — it is a flat list
of `- SLICE-ID summary (#N): …` bullets. Flatten them on fold; the grouping
above is only there to show which is which.

## 5. Evidence pointers

- Design and journeys: `apps/web/src/__tests__/*.real-world.test.ts` — real
  Chromium/Firefox/WebKit dashboard journeys against the reference apps, each
  gated on axe WCAG 2.2 AA with zero horizontal document overflow.
  `dashboard-readability.real-world.test.ts` repeats every journey at 200%
  mounted text and with wide letter/word spacing.
- Determinism: `determinism.real-world.test.ts` — the same non-reproducible page
  (wall clock, CSS fade, width transition) captures byte-identically twice under
  all three engines, with a control test proving it genuinely differs without
  the profile, and a test that timers and animation frames still run.
- Induced states: `state-induction.real-world.test.ts` — an application whose
  error banner exists only on a failed request renders it under 500/503/422
  while the origin server records no request at all; empty submission provokes
  inline validation; a page with no form is reported rather than claimed.
- Isolated captures: `element-capture.real-world.test.ts` — a whole-page
  comparison reports changed pixels when only a sibling moved, while the
  isolated component is byte-identical. That contrast is the feature.
- Classification: `structural-diff.test.ts` — path matching survives an
  insertion that shifts every id; moves, resizes, additions and removals are
  separated; sub-pixel jitter is not a layout change; a tampered assessment
  refuses to classify.
- Vault: `secret-vault.test.ts` for the store and inventory, and
  `credential-vault-ui.real-world.test.ts` for the journey — an administrator
  sets both references on the Administration screen, a real visual run signs in
  to the reference auth app with them, and removing the password returns the run
  to refusing, which is what proves the sign-in was reading the vault. The value
  appears in neither `/api/secrets`, `/api/state` nor the rendered page, and no
  file anywhere in the state directory contains it in the clear.
- Perceptual comparison: `perceptual-diff.test.ts` — a whole-page tint touches
  strictly more pixels than a localised edit yet scores structurally closer,
  which is the distinction the measure exists to make.
- Baseline store: `baseline-store.test.ts` — a baseline survives deletion of the
  run that produced it, identical pixels are stored once, a corrupted entry is
  treated as absent rather than compared against, and an external root keeps
  nothing in the state directory.
- Gates: typecheck ☑ · lint ☑ · format ☑ (full repo) · test ☑ · license gate ☐
  (no dependency added — every new module is built on native APIs precisely to
  avoid one)

  All 350 test files in the repository ran green: 2,385 tests, zero failures.
  Run in batches rather than one invocation — `vitest.config.ts` sets
  `fileParallelism: false`, so a single pass walks every file in one worker
  whose heap grows the whole way, and on a host already holding ~49GB in
  unrelated services that pass is killed before it finishes. Each batch is its
  own process and returns its memory before the next begins:

  | Set                   | Files | Tests |
  | --------------------- | ----- | ----- |
  | `apps/web` light      | 51    | 277   |
  | `apps/web` real-world | 64    | 125   |
  | other light           | 174   | 1,748 |
  | other real-world      | 61    | 235   |

  Only `apps/web` is touched by this branch; the other 235 files were run to
  confirm that rather than assert it.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                            | Expected disposition                                                                                     | Test                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Run scoped to a path the project does not cover    | 400 before anything is queued; the scope narrows and never substitutes                                   | `page-scoped-run.test.ts`                  |
| Capture that would not settle                      | the overflow claim is withdrawn, not reported clean                                                      | `page-inventory.test.ts`                   |
| Text contrast that was never measured              | absent from the page; never reported as a pass                                                           | `page-inventory.test.ts`                   |
| Action log whose checkpoints belong to another run | nothing shown, rather than another page's work under this page's heading                                 | `action-log.test.ts`                       |
| Project with no environment recorded               | read as development; an AI walkthrough on it does not ask, and does not pretend to be safe on production | `plain-words.test.ts`                      |
| Vault record read under a rotated key              | credential reported missing; run blocks rather than signing in with garbage                              | `secret-vault.test.ts`                     |
| Vault record's ciphertext altered in the database  | GCM tag rejects it; credential reported missing                                                          | `secret-vault.test.ts`                     |
| Reference name that is not `ARXIC_SECRET_`         | 400 before anything is stored                                                                            | `secret-vault.test.ts`                     |
| Environment names a reference but leaves it empty  | the vault value survives and is used                                                                     | `secret-vault.test.ts`                     |
| Stored credential removed                          | the run returns to refusing                                                                              | `credential-vault-ui.real-world.test.ts`   |
| Induced fault that matches no request              | `state-induction-no-request` finding; capture is not read as reaching the state                          | `state-induction.real-world.test.ts`       |
| Empty submission on a page with no form            | `state-induction-no-form` finding                                                                        | `state-induction.real-world.test.ts`       |
| Induction that raises no alert or dialog           | `state-induction-no-surface` finding                                                                     | `visual.ts`                                |
| Image that cannot decode                           | `undecodable-images` finding; capture proceeds                                                           | `determinism.real-world.test.ts`           |
| Region off screen or smaller than four pixels      | no isolated capture rather than a meaningless crop                                                       | `element-capture.real-world.test.ts`       |
| Assessment that no longer hashes to its record     | capture left unclassified rather than classified from altered evidence                                   | `structural-diff.test.ts`                  |
| Either scene truncated                             | diff marked truncated, so absence is not read as removal                                                 | `structural-diff.test.ts`                  |
| Every dashboard view at 200% text and wide spacing | no clipped control text, no horizontal document overflow                                                 | `dashboard-readability.real-world.test.ts` |
| Unbreakable path in a one-column mobile grid       | wraps inside the viewport instead of scrolling the document                                              | `dashboard-readability.real-world.test.ts` |
| Discovery with thousands of surfaces               | paged, not rendered whole                                                                                | `inventory-ledger-ui.real-world.test.ts`   |
| Filter on a run whose captures share one value     | control still present and selectable                                                                     | `capture-gallery-ui.real-world.test.ts`    |
| Visual run on a project with no discovery yet      | "Visual test" is on the row, not hidden behind a menu                                                    | `visual-review-ui.real-world.test.ts`      |
| Opening a project's settings from the overview     | the project name is the control, and carries `data-edit`                                                 | `agent.real-world.test.ts` (guided)        |

## 7. What this slice did NOT do

Read this before trusting the summary.

- **No video, and none is coming from this slice.** The operator asked for
  "screenshots and/or video how it works". `recordVideo: true` still refuses,
  because a video frame cannot carry the privacy masks a screenshot gets, so an
  unmasked recording would leak whatever was on screen. What ships instead is
  what can be shown honestly: the filmstrip of a page's captured states at each
  screen size, and the sanitized action log rendered readably. Frame-level
  masking is real engineering and is not in here.
- **The Pages view invents nothing.** It is a re-projection of evidence the
  dashboard already polls — configured paths, crawled paths, captured paths —
  so a page nothing has reached is shown as untested rather than assumed to
  exist. API endpoints are absent because nobody can look at one, not because
  they were filtered out: they keep their place under Coverage.
- **"What's on this page" is a census, not a reading.** The measurement pipeline
  deliberately retains no text, labels, URLs or values from the target
  application, so the honest answer to "what does this page have" is two form
  fields and a button, never "Email, Password, Sign in". The screen says so.
- **The production confirmation is one question, not a policy.** It asks before
  an AI walkthrough or a form-submitting checkpoint runs against a project
  marked production, and asks nothing otherwise. It is not an access control and
  does not stop anything; a confirmation people meet on every run is one they
  stop reading.
- **The GitHub deep link was not built.** "Where it comes from" names the source
  files and the commit they were read at. Turning that into a repository URL
  needs the project's git remote captured and stored, which is a schema change
  this slice did not make.

- **No visual baseline exists for the redesign itself, and this slice must not
  create one.** Every dashboard screen changed, so the product's own baselines
  for its own dashboard are stale. Approving a baseline is a human judgement
  about whether a change is intended — ADR §2 forbids an LLM assigning
  `verified`, and the same reasoning applies here. The operator approves them
  after reviewing the redesign; nothing automated should.
- **Two panels were examined and deliberately left on their existing patterns.**
  The diff viewer's comparison modes are a toggle group with `aria-pressed`; the
  element inspector's list is a picker. Both are correct for what they do, and
  converting them to `Tabs` and `DataTable` would trade correct semantics for
  uniformity. Models & accounts keeps its master-detail layout: a split-panel
  primitive used by exactly one screen is the over-engineering the brief asked
  to avoid.
- **Isolated component captures are declared, not discovered.** Overlays and
  portals are found automatically; components require a selector in project
  settings. Deriving them from the measured scene would mean the tool choosing
  what counts as a component, which is a product decision, not an inference.
- **The induced-fault list is closed.** Ten statuses, no arbitrary bodies and no
  latency or partial-response injection. A checkpoint is a declaration about the
  product's own error handling, not a general-purpose fault harness.
- **SSIM is reported, not enforced.** It never changes whether a capture counts
  as changed; the changed-pixel ratio still decides, and `visualChangeRatio`
  remains the only gate an operator can set.
- **Three decluttering decisions were reverted or reworked, all for one reason.**
  A per-dimension capture filter and a per-project adaptive primary action each
  made a control's presence depend on the data; moving Settings into the overflow
  menu removed a control a journey clicked directly. All three were caught by
  existing journeys and all three were worse than what they replaced. Two rules
  survived: a control set may switch on the _shape_ of a screen (one capture vs
  many) but never on the _values_ in it; and the way to remove a button is to
  give its job to something already on screen — the project name now opens
  project settings — not to bury it a click deeper.

## 8. Gaps closed after the first pass

Recorded because the earlier revision of this note listed them as outstanding.

- **`app.css` is level with main** at 2,185 lines, after adding a command
  palette, confirm dialog, toast region, stat strip, attention band, tabs and a
  shared table with its own mobile stacking — and removing thirty dead rule
  blocks, two competing table systems and a duplicated stacking implementation.
- **The delegated click dispatcher is gone.** Eighteen `data-*` branches became
  per-control actions behind one registry; the attributes remain for journeys to
  address, but nothing reads them at runtime.
- **Baselines are no longer pointers into run directories.** They are
  content-addressed, immutable, deduplicated, survive deletion of the run that
  produced them, and can live on external storage via `ARXIC_BASELINE_STORE`.
- **Structural similarity is measured** alongside the pixel count, separating a
  page-wide tint from one changed component — two results the changed-pixel
  count alone reports identically.
- **The vault is verified**, not merely observed: a browser journey types a
  password into Administration and a real run signs in with it.
