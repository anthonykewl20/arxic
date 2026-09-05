# Frontend migration

The workspace shell, overview, intent inventory, workflow selection, campaign history/details, schedules, administration,
run/capture details, image review, model fields and Models & accounts use React, Tailwind CSS and shadcn/ui components.
Vite compiles the local assets once per server process; the server serves only the
bundled JavaScript and CSS. No browser CDN or external script is required.
The shell owns mobile disclosure state, including Escape and focus restoration.
The existing dashboard actions still own API requests, session-race protection,
project form submission and polling. Review forms own draft state; shared pending-request tokens preserve submission state across navigation and reject duplicates. Session invalidation clears presentation state, while late responses cannot mutate a new session. Provider suggestions update independently
from custom model inputs. Configured default HTTP connections share provider-driven
catalogs with Models & accounts; unavailable wrappers explain their discovery limitation. The project form retains its native dialog and existing
action handlers. Broader account-management and campaign controls remain under issue 402.

`components/ui/{button,card,badge,input}.tsx` are adapted from the MIT-licensed
[shadcn/ui New York registry](https://ui.shadcn.com/docs/components), retrieved
2026-09-06. Relative utility imports, an explicit Card border color and repository formatting are local changes.
See `LICENSE.shadcn` for the upstream license. The visual direction uses neutral
surfaces, compact navigation, consistent spacing and restrained color inspired by
[Linear's design reset](https://linear.app/now/a-design-reset).
