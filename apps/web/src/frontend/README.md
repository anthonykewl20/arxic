# Frontend migration

The Models & accounts screen uses React, Tailwind CSS and shadcn/ui components.
Vite compiles the local assets once per server process; the server serves only the
bundled JavaScript and CSS. No browser CDN or external script is required.
The rest of the dashboard is being migrated incrementally under issue 402.

`components/ui/{button,card,badge,input}.tsx` are adapted from the MIT-licensed
[shadcn/ui New York registry](https://ui.shadcn.com/docs/components), retrieved
2026-09-06. Relative utility imports and repository formatting are local changes.
See `LICENSE.shadcn` for the upstream license. The visual direction uses neutral
surfaces, compact navigation, consistent spacing and restrained color inspired by
[Linear's design reset](https://linear.app/now/a-design-reset).
