# Gears

`docs/gears/` holds Arxic's authored provenance metadata + upstream LICENSE texts (pins, seams, license decisions) for the engines Arxic assembles (ADR §6/§27). The actual upstream CODE is NOT in the repo — it is reference-only, fetched locally on demand via `scripts/fetch-gears.sh` (the `gears/` directory is gitignored).

| Gear | License | Consumption mode | Location | ADR section | Pinned ref |
|---|---|---|---|---|---|
| understand-anything | MIT | vendored subset | `docs/gears/understand-anything/` (code: local `gears/understand-anything/` via `scripts/fetch-gears.sh`) | §7.1 | `fe8c5bc591716aafd79b4765549328f08ef5a52e` |
| archify | MIT | adapted patterns + reviewed code | `docs/gears/archify/` (code: local `gears/archify/` via `scripts/fetch-gears.sh`) | §7.2 | `2c1f8ac2ca28a26d0b68043ec80c9554e20ff0e3` |
| playwright | Apache-2.0 | adapter references only | `docs/gears/playwright/` (code: local `gears/playwright/` via `scripts/fetch-gears.sh`) | §7.3 | `1720c55cfaddfb01a5bb4c9ddf43e42053811a25` |
| crawlee | Apache-2.0 | public API behavior references | `docs/gears/crawlee/` (code: local `gears/crawlee/` via `scripts/fetch-gears.sh`) | §7.4 | `5401ab9770bd2e2e5629316c8b2a7690c39e8096` |
| ast-grep | MIT | CLI process boundary + optional nAPI seams | `docs/gears/ast-grep/` (code: local `gears/ast-grep/` via `scripts/fetch-gears.sh`) | §6 | `96c6792b51567ad7f35151027c0e5c0679270303` |
| graphology | MIT | npm public package contracts | `docs/gears/graphology/` (code: local `gears/graphology/` via `scripts/fetch-gears.sh`) | §6 | HEAD (no ADR pin) |
| langgraph | MIT | npm public package contracts | `docs/gears/langgraph/` (code: local `gears/langgraph/` via `scripts/fetch-gears.sh`) | §6, §8.1 | HEAD (no ADR pin) |
| ajv | MIT | npm public package contracts | `docs/gears/ajv/` (code: local `gears/ajv/` via `scripts/fetch-gears.sh`) | §6 | HEAD (no ADR pin) |
| testcontainers | MIT | npm public package contracts | `docs/gears/testcontainers/` (code: local `gears/testcontainers/` via `scripts/fetch-gears.sh`) | §6, §16.1 | HEAD (no ADR pin) |
| mailpit | MIT | container + API references | `docs/gears/mailpit/` (code: local `gears/mailpit/` via `scripts/fetch-gears.sh`) | §6, §12.3 | HEAD (no ADR pin) |
| otplib | MIT | npm public package contracts | `docs/gears/otplib/` (code: local `gears/otplib/` via `scripts/fetch-gears.sh`) | §6, §12.3 | HEAD (no ADR pin) |
| midscene | MIT | optional adapter references | `docs/gears/midscene/` (code: local `gears/midscene/` via `scripts/fetch-gears.sh`) | §6 | HEAD (no ADR pin) |
| stagehand | MIT | optional adapter references | `docs/gears/stagehand/` (code: local `gears/stagehand/` via `scripts/fetch-gears.sh`) | §6.1 | HEAD (no ADR pin) |
| testzeus-hercules | AGPL-3.0 | deferred optional references | `docs/gears/testzeus-hercules/` (code: local `gears/testzeus-hercules/` via `scripts/fetch-gears.sh`) | §6.1, §24 | HEAD (no ADR pin) |
| scip | Apache-2.0 | optional extension references | `docs/gears/scip/` (code: local `gears/scip/` via `scripts/fetch-gears.sh`) | §6.1 | HEAD (no ADR pin) |
| scip-typescript | Apache-2.0 | optional extension references | `docs/gears/scip-typescript/` (code: local `gears/scip-typescript/` via `scripts/fetch-gears.sh`) | §6.1 | HEAD (no ADR pin) |
| tree-sitter | MIT | parser contracts and bindings references | `docs/gears/tree-sitter/` (code: local `gears/tree-sitter/` via `scripts/fetch-gears.sh`) | §6, §7.1 | HEAD (no ADR pin) |
