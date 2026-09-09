# Frontend

The workspace shell, overview, intent inventory, workflow selection, campaign
history/details, schedules, administration, run/capture details, image review,
model fields and Models & accounts use React, Tailwind CSS and shadcn/ui
components. Vite compiles the local assets once per server process; the server
serves only the bundled JavaScript and CSS. No browser CDN or external script is
required.

## Where things live

`tokens.css` is the single source of colour, type, spacing, radius, motion and
density. Each palette value is declared once with `light-dark()`; `color-scheme`
picks the side, so a theme is one declaration per token rather than a light
block plus a `prefers-color-scheme` block plus a `[data-theme]` block.

`components/index.ts` is the only import path for UI primitives. Beyond the
shadcn set it exports the composition primitives every screen builds from:

- `DataTable` / `Table*` — the one table. It owns the scroll container (the
  document must never scroll sideways), tabular figures, column truncation and
  the stacked layout below 720px, so no screen writes its own grid.
- `Section`, `EmptyState`, `Note`, `Stat` — page scaffolding. A section owns its
  heading and spacing; `#workspace-panel-root` owns the rhythm between sections,
  so panels can add or reorder sections without re-deriving margins.
- `Toolbar`, `SearchField`, `FilterSelect`, `Pagination` — collection controls.
  Pagination names its buttons `Previous <unit>` / `Next <unit>`.
- `Menu` — the overflow menu that keeps a row to one visible action.
- `Toaster` / `toast()` — announcements. The live region keeps the id `notice`.
- `ConfirmHost` / `confirmAction()` — destructive confirmation, replacing
  `window.confirm`.
- `CommandPalette` + `command-registry.tsx` — Ctrl+K / ⌘K over sections,
  projects, recent runs and actions. `app.ts` republishes the command list on
  every render, so the palette reaches whatever exists right now.
- `Tabs` / `TabPanel` — sibling views of one subject.

`app.ts` owns API requests, session-race protection and polling; the project and
agent wizards (`project-wizard.tsx`, `agent-wizard.tsx`) own their forms. The
shell owns mobile disclosure state, including Escape and focus restoration.
Review forms own draft state; shared pending-request tokens preserve submission
state across navigation and reject duplicates. Session invalidation clears
presentation state, while late responses cannot mutate a new session. Provider
suggestions update independently from custom model inputs. Configured default
HTTP connections share provider-driven catalogs with Models & accounts;
unavailable wrappers explain their discovery limitation. Dialogs are native
`<dialog>` elements.

## Constraints every screen inherits

The dashboard audit (`__tests__/dashboard-proof.ts`) fails a view on any axe
WCAG 2.2 AA violation and on any horizontal document overflow, and
`dashboard-readability.real-world.test.ts` repeats it at 200% text and with wide
letter/word spacing. Two rules follow:

- A wide table scrolls inside its own container, never the document. `DataTable`
  does this; a hand-written table must too.
- A grid track that can hold an unbreakable string (a filesystem path, a secret
  reference) uses `minmax(0, 1fr)`, never a bare `1fr` — a bare `1fr` still takes
  its automatic minimum from the item's min-content and widens past the viewport.
- Controls set a minimum height and let text wrap; they never fix a height that
  clips text at 200%.

## Credentials

`credentials-panel.tsx` manages the `ARXIC_SECRET_` references a project signs in
with. It is write-only: the server returns reference names and whether each
resolves, never a value. `secret-store.ts` encrypts records at rest with
AES-256-GCM under a key from `ARXIC_VAULT_KEY`, or, absent that, a `0600` key
file beside the database. That protects a copied database file, not the host.

`components/ui/{button,card,badge,input}.tsx` are adapted from the MIT-licensed
[shadcn/ui New York registry](https://ui.shadcn.com/docs/components), retrieved
2026-09-06. Relative utility imports, an explicit Card border color and repository formatting are local changes.
See `LICENSE.shadcn` for the upstream license. The visual direction uses neutral
surfaces, compact navigation, consistent spacing and restrained color inspired by
[Linear's design reset](https://linear.app/now/a-design-reset).

The measurement inspector shows solid-paint contrast ratios and unverified applicability, with search/verdict filters and viewport-scaled region overlays on loaded, masked capture images. Image-load failures have explicit retry; the full-size artifact remains available. Display rounding never affects the server verdict.

`checkpoint-settings.tsx` edits guided semantic capture declarations without raw
selectors or script. `workflow-checkpoints.tsx` renders authenticated workflow
checkpoint copies with explicit loading/error/retry states, full-size links and
privacy provenance. These images have no visual baseline approval control.

`element-inspector.tsx` displays the validated, screenshot-bound numeric projection
from `element-scene.ts`. It maps responsive preview coordinates to the original CSS
viewport and provides keyboard search/list/parent alternatives. Geometry selection
does not alter solver verdicts or infer paint order. Image errors disable picking;
malformed/unstable scenes remain unavailable. The desktop topbar scrolls with the
page so it cannot cover actions during report inspection.

`retention-panel.tsx` owns the administrator's unsaved age/newest policy, preview
and deletion consent. Controls remain disabled during requests; edits invalidate
the preview and consent. Cleanup applies only the saved policy, and failures
refresh durable recovery status without hiding the original error. Component
unmount prevents late responses from changing a later session's presentation.

`run-panel.tsx` renders the selected run's detail above the run list, so the
capture is on screen without scrolling past the history it came from; the list
stays below for switching runs. `capture-gallery.tsx` offers its search and five
environment filters only when a run holds more than one capture — which controls
exist never depends on which values that run happens to vary, so their position
stays learnable. It distinguishes comparison-at-capture-time status from current
baseline approval. Figure placeholders explain absent historical evidence rather
than asking for approval after approval has already succeeded. This is presentation
of existing records; it does not mutate comparison or approval policy.

Project capture settings now expose native 1×/2×/3× pixel densities. Capture gallery filtering and environment labels retain density identity. High-density Chromium uses full headless rendering after a shell-specific raster-repeatability failure. See the workbench guide for current proof and CI limits.
