# Frontend migration

The workspace shell, overview, intent inventory, workflow selection, campaign history/details, schedules, administration,
run/capture details, image review, model fields and Models & accounts use React, Tailwind CSS and shadcn/ui components.
Vite compiles the local assets once per server process; the server serves only the
bundled JavaScript and CSS. No browser CDN or external script is required.
The shell owns mobile disclosure state, including Escape and focus restoration.
`app.ts` owns API requests, session-race protection and polling; the project and
agent wizards (`project-wizard.tsx`, `agent-wizard.tsx`) own their forms.
`tokens.css` is the single source of colour, type, spacing and radius for light
and dark; `components/index.ts` is the only import path for UI primitives. Review forms own draft state; shared pending-request tokens preserve submission state across navigation and reject duplicates. Session invalidation clears presentation state, while late responses cannot mutate a new session. Provider suggestions update independently
from custom model inputs. Configured default HTTP connections share provider-driven
catalogs with Models & accounts; unavailable wrappers explain their discovery limitation. Dialogs are native `<dialog>` elements. Broader account-management and campaign controls remain under issue 402.

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

`run-panel.tsx` distinguishes comparison-at-capture-time status from current
baseline approval. Figure placeholders explain absent historical evidence rather
than asking for approval after approval has already succeeded. This is presentation
of existing records; it does not mutate comparison or approval policy.

Project capture settings now expose native 1×/2×/3× pixel densities. Capture gallery filtering and environment labels retain density identity. Native repeatability remains under investigation in #454; see the workbench guide for the current proof limits.
