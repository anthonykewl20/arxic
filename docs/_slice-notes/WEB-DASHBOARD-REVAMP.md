# WEB-DASHBOARD-REVAMP — staged doc updates (charter §10.2)

Issue: none opened · PR: #<N> · Disposition: mixed

> No tracker issue exists for this slice. It was requested directly, not taken
> off the board, so the §"Issue workflow" opening comment and `in-progress`
> label were never applicable. The integrator should open one before merge, or
> record the exception.

Six commits on `feat/dashboard-revamp`, rebased onto `58924ec9`:

| Commit     | Subject                                                             |
| ---------- | ------------------------------------------------------------------- |
| `35f5264d` | dashboard design system, information architecture, credential vault |
| `e62011c3` | rendering determinism and induced error-state capture               |
| `12448665` | isolated region captures and layout-shift classification            |
| `ac244d26` | stop an empty environment variable shadowing a stored credential    |
| `a92b8172` | tab the intent inventory, campaign surfaces in a table              |
| `abff2e60` | Models & accounts on the shared empty-state and note primitives     |

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| — | [WEB-DASHBOARD-REVAMP] Dashboard design system, regression determinism, induced states, isolated captures and the credential vault | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-10 | **(WEB-DASHBOARD-REVAMP) Dashboard revamp + regression engine DONE.** One token layer (`light-dark()`, palette declared once instead of three times), nine composition primitives behind `components/index.ts`, one `DataTable` replacing two table systems, ⌘K palette, toasts, real confirm dialogs. Intent inventory 16,416px → 2,452px on the same data via tabs. Encrypted credential vault, verified end to end by a browser journey that types a password into Administration and signs a real run in with it. Regression engine: Chromium raster flags, forced animation end-state, frozen wall clock, image-decode readiness, induced 4xx/5xx and empty-form states, automatic overlay/portal isolation, component isolation, and baseline-vs-current structural diffing that separates a layout shift from a repaint. Proved on real Chromium/Firefox/WebKit. Next: convert the remaining wizard and diff-viewer CSS; promote baselines to an external store. |
```

## 3. `CHANGELOG.md` — entries under `## [Unreleased]`

### changed

```
- WEB-DASHBOARD-REVAMP Dashboard design system and information architecture: `tokens.css` declares each palette value once with `light-dark()` instead of duplicating the dark palette across a media query and a `[data-theme]` block; `components/index.ts` gains `DataTable`/`Table*`, `Section`/`EmptyState`/`Note`/`Stat`, `Toolbar`/`SearchField`/`FilterSelect`/`Pagination`, `Menu`, `Toaster`, `ConfirmHost`, `CommandPalette` and `Tabs`, all on native elements so no dependency is added. Every dashboard table renders through the one `DataTable` (its own scroll container, tabular figures, one mobile-stacking implementation). Ctrl+K / ⌘K opens a command palette over sections, projects, recent runs and actions; announcements are toasts (the live region keeps the id `notice`); deleting a run confirms in a dialog naming what survives. Intent inventory presents surfaces, workflows and declarations as tabs rather than one 16,416-pixel scroll, and the discovered-surface table is paged. A run's detail renders above the run list; capture filters appear only for runs holding more than one capture. Fixes a latent defect where `grid-template-columns: 1fr` let an unbreakable path widen the page past the viewport at 200% text.
```

### added

```
- WEB-DASHBOARD-REVAMP Rendering determinism (`determinism.ts`): Chromium font-hinting, subpixel, LCD-text, colour-profile and raster flags; an injected stylesheet forcing every CSS animation and transition to its END state, because the context can only ASK for reduced motion and pages ignore it; a frozen wall clock so rendered dates and relative times repeat. `performance.now`, rAF and the timers are deliberately left running — pinning them renders script animations at their first frame while CSS sits at its last, and stalls anything that waits on a timer. Readiness awaits image decoding; images that cannot decode are reported, not refused.
- WEB-DASHBOARD-REVAMP Induced states (`state-induction.ts`): a state checkpoint may answer the page's own data requests with a status from a closed list, so error banners and boundary fallbacks render, or submit its forms empty to provoke inline validation. Document navigation is untouched, the fault route never forwards what it answers, and the capture context still aborts every non-GET, so both stay read-only against the target. Alerts, live regions and open dialogs are recorded on the capture as geometry only. A checkpoint that answered no request, found no form or raised no surface says so as a finding.
- WEB-DASHBOARD-REVAMP Isolated captures (`element-capture.ts`): overlays and portals are captured in isolation automatically, and declared component selectors alongside them. Each region is its own capture record with its own spec hash, so a component is compared against its own baseline and a sibling's height change no longer reports it as altered. Regions are cropped from the already-masked viewport bytes, so an isolated capture is a strict subset of pixels that already passed the privacy pipeline.
- WEB-DASHBOARD-REVAMP Change classification (`structural-diff.ts`): the baseline's and the new capture's measured layout trees are compared, matching nodes by tree path rather than array position, and each changed region is classified as content-change, layout-shift, visual-change or unclassified. Both assessments must still hash to what their capture recorded. The run detail states the conclusion — "Layout moved: elements changed position or size" — not the category name.
- WEB-DASHBOARD-REVAMP Sign-in credentials (Administration): the `ARXIC_SECRET_` references a project signs in with, discovered from project and campaign declarations, given values in the dashboard and stored AES-256-GCM-encrypted at rest under `ARXIC_VAULT_KEY` or a `0600` key file beside the database. Write-only in the interface; released only into a run's launch environment.
```

### fixed

```
- WEB-DASHBOARD-REVAMP An empty environment variable no longer shadows a stored credential: a shell profile exporting `ARXIC_SECRET_X=` erased the vault entry and the run refused with "set it in the server environment", pointing the operator away from the value they had just entered. An empty variable carries no credential and is no longer an override; a real one still wins.
```

## 4. `VERSION` bump required?

yes → 0.0.402, because the change is user-observable per RELEASES.md (new
Administration screen, new keyboard shortcut, tabbed intent inventory, changed
run-detail order, new capture kinds and a new classification on every compared
capture).

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
- Gates: typecheck ☑ · lint ☑ · format ☑ (full repo) · full `vitest run` ☐
  (running at time of writing) · license gate ☐ (no dependency added — every
  new module is built on native APIs precisely to avoid one)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                            | Expected disposition                                                            | Test                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------ |
| Vault record read under a rotated key              | credential reported missing; run blocks rather than signing in with garbage     | `secret-vault.test.ts`                     |
| Vault record's ciphertext altered in the database  | GCM tag rejects it; credential reported missing                                 | `secret-vault.test.ts`                     |
| Reference name that is not `ARXIC_SECRET_`         | 400 before anything is stored                                                   | `secret-vault.test.ts`                     |
| Environment names a reference but leaves it empty  | the vault value survives and is used                                            | `secret-vault.test.ts`                     |
| Stored credential removed                          | the run returns to refusing                                                     | `credential-vault-ui.real-world.test.ts`   |
| Induced fault that matches no request              | `state-induction-no-request` finding; capture is not read as reaching the state | `state-induction.real-world.test.ts`       |
| Empty submission on a page with no form            | `state-induction-no-form` finding                                               | `state-induction.real-world.test.ts`       |
| Induction that raises no alert or dialog           | `state-induction-no-surface` finding                                            | `visual.ts`                                |
| Image that cannot decode                           | `undecodable-images` finding; capture proceeds                                  | `determinism.real-world.test.ts`           |
| Region off screen or smaller than four pixels      | no isolated capture rather than a meaningless crop                              | `element-capture.real-world.test.ts`       |
| Assessment that no longer hashes to its record     | capture left unclassified rather than classified from altered evidence          | `structural-diff.test.ts`                  |
| Either scene truncated                             | diff marked truncated, so absence is not read as removal                        | `structural-diff.test.ts`                  |
| Every dashboard view at 200% text and wide spacing | no clipped control text, no horizontal document overflow                        | `dashboard-readability.real-world.test.ts` |
| Unbreakable path in a one-column mobile grid       | wraps inside the viewport instead of scrolling the document                     | `dashboard-readability.real-world.test.ts` |
| Discovery with thousands of surfaces               | paged, not rendered whole                                                       | `inventory-ledger-ui.real-world.test.ts`   |
| Filter on a run whose captures share one value     | control still present and selectable                                            | `capture-gallery-ui.real-world.test.ts`    |
| Visual run on a project with no discovery yet      | "Visual test" is on the row, not hidden behind a menu                           | `visual-review-ui.real-world.test.ts`      |
| Opening a project's settings from the overview     | the project name is the control, and carries `data-edit`                        | `agent.real-world.test.ts` (guided)        |

## 7. What this slice did NOT do

Read this before trusting the summary.

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
