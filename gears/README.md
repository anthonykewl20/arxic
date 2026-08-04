# Gears

gears/ is Arxic's reference collection of the open-source engines it assembles (ADR §6/§27). Each subfolder holds upstream license + `PROVENANCE.md` + the specific seams Arxic borrows. These are reference/audit artifacts; production vendored code lives under `third_party/` (ADR §18).

| Gear | License | Consumption mode | Location | ADR section | Pinned ref |
|---|---|---|---|---|---|
| understand-anything | MIT | vendored subset | `gears/understand-anything/` | §7.1 | `fe8c5bc591716aafd79b4765549328f08ef5a52e` |
| archify | MIT | adapted patterns + reviewed code | `gears/archify/` | §7.2 | `2c1f8ac2ca28a26d0b68043ec80c9554e20ff0e3` |
| playwright | Apache-2.0 | adapter references only | `gears/playwright/` | §7.3 | `1720c55cfaddfb01a5bb4c9ddf43e42053811a25` |
| crawlee | Apache-2.0 | public API behavior references | `gears/crawlee/` | §7.4 | `5401ab9770bd2e2e5629316c8b2a7690c39e8096` |
| ast-grep | MIT | CLI process boundary + optional nAPI seams | `gears/ast-grep/` | §6 | `96c6792b51567ad7f35151027c0e5c0679270303` |
| graphology | MIT | npm public package contracts | `gears/graphology/` | see PROVENANCE | see PROVENANCE.md |
| langgraph | MIT | npm public package contracts | `gears/langgraph/` | see PROVENANCE | see PROVENANCE.md |
| ajv | MIT | npm public package contracts | `gears/ajv/` | see PROVENANCE | see PROVENANCE.md |
| testcontainers | MIT | npm public package contracts | `gears/testcontainers/` | see PROVENANCE | see PROVENANCE.md |
| mailpit | MIT | container + API references | `gears/mailpit/` | see PROVENANCE | see PROVENANCE.md |
| otplib | MIT | npm public package contracts | `gears/otplib/` | see PROVENANCE | see PROVENANCE.md |
| midscene | MIT | optional adapter references | `gears/midscene/` | see PROVENANCE | see PROVENANCE.md |
| stagehand | MIT | optional adapter references | `gears/stagehand/` | see PROVENANCE | see PROVENANCE.md |
| testzeus-hercules | AGPL-3.0 | deferred optional references | `gears/testzeus-hercules/` | see PROVENANCE | see PROVENANCE.md |
| scip | MIT | optional extension references | `gears/scip/` | see PROVENANCE | see PROVENANCE.md |
| scip-typescript | MIT | optional extension references | `gears/scip-typescript/` | see PROVENANCE | see PROVENANCE.md |
| tree-sitter | Apache-2.0 | parser contracts and bindings references | `gears/tree-sitter/` | see PROVENANCE | see PROVENANCE.md |
