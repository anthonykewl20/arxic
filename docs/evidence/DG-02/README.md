# DG-02 Evidence — Domain Inventory spike

Artifacts retained because a reader cannot cheaply reproduce them (per
[`../evidence/README.md`](../README.md)): they were produced **outside CI**
against a real third-party repository cloned to `/tmp/opencode/koel` (outside
the arxic tree). Everything else in this spike is reproducible by running
`pnpm vitest run packages/domain-inventory-spike` (the real-world suite boots
both fixture apps with real Chromium + real Tree-sitter on every CI run).

## Provenance

| Artifact                             | Producer                                                                                                                           | Input                                                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `koel-interchange.json`              | `enumeratePhpRoutes()` — the **STAND-IN** deterministic routes-file scanner (`packages/domain-inventory-spike/src/standin-php.ts`) | `koel/koel` @ `dfec91ff290509c622ff7cf392fb5e506841ee2b` (`master`, cloned 2026-08-16, `--depth 1`), `routes/*.php`                                                                                      |
| `koel-inventory.json`                | `buildInventory({ interchanges: [koel-interchange.json] })`                                                                        | the interchange above (source-side only; no runtime crawl — see the spike report §Measurement)                                                                                                           |
| `reference-auth-app-inventory.json`  | `buildInventory({ sourceIndex, surfaceMap })`                                                                                      | real `SourceUaAdapter.collect()` (Tree-sitter) + real `CrawleeSurfaceDiscoverer.collect()` (Playwright Chromium), same engine path as `packages/domain-inventory-spike/src/__tests__/real-world.test.ts` |
| `vulnerable-auth-app-inventory.json` | same                                                                                                                               | same                                                                                                                                                                                                     |

`koel/koel` was selected as the **documented substitution** for the campaign
monorepo (Laravel 13 backend + Next.js frontend): the campaign repo is private
and not locatable on this machine (`/home/soultransit/devtony/arxic-private/`
contains only the internal ADR and upstream gear clones; issues #257–#259 carry
no pointer). Koel is a real production Laravel application — `composer.json`
requires `laravel/framework: ^13.0`, `composer.lock` pins **v13.24.0** (verified
from the lockfile, not memory) — with a Next-free SPA frontend; it matches the
campaign backend's framework major. MIT-licensed. Selection was made by
inspecting real repositories and their composer files (GitHub code search
2026-08-16), not from memory.

No third-party source code is committed here — only extracted route-path data
(methods, URIs, route names, controller identifiers, line anchors) plus hashes,
which is factual inventory output consumed by `koel-interchange.test.ts`.

## Reproduction (offline, requires network)

```bash
git clone --depth 1 https://github.com/koel/koel.git /tmp/opencode/koel
# verify: cd /tmp/opencode/koel && git rev-parse HEAD == dfec91ff…
# verify: grep -A1 '"name": "laravel/framework"' composer.lock  → v13.24.0
pnpm tsx -e 'import { enumeratePhpRoutes } from "./packages/domain-inventory-spike/src/index.ts";
  const x = await enumeratePhpRoutes("/tmp/opencode/koel", { repository: "https://github.com/koel/koel.git", commit: "dfec91ff290509c622ff7cf392fb5e506841ee2b" });
  console.log(x.routes.length, x.gaps.length);'   # → 188 1
```
