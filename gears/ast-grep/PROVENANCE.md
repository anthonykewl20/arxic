# ast-grep — Provenance

| Field | Value |
|---|---|
| Upstream repo | https://github.com/ast-grep/ast-grep |
| Pinned ref | 96c6792b51567ad7f35151027c0e5c0679270303 |
| License | MIT |
| Consumed as | CLI process boundary first; optional @ast-grep/napi seams |
| ADR section | §6 |
| Local location | gears/ast-grep/ |

## What Arxic borrows
- Versioned rule directory workflow and stream-style extraction expectations.
- @ast-grep/napi binding entry points and TypeScript declaration surfaces for process boundary integration.

## Exact seams
- `src/crates/napi/index.js` — npm package entry / runtime seam.
- `src/crates/napi/index.d.ts` and `src/crates/napi/package.json` — binding type and package contract.
- `src/crates/napi/scripts/constants.ts` and `src/crates/napi/scripts/generateTypes.ts` — supporting generation flow references.
- `src/crates/napi/types/api.d.ts`, `src/crates/napi/types/config.d.ts`, `src/crates/napi/types/rule.d.ts` — runtime type contract references.
- `src/crates/outline/src/default_rules/typescript.yml` and `src/crates/outline/src/default_rules/javascript.yml` — exemplar rule packs.

## Notes / constraints
- For M0 the process boundary is primary (`sg scan`), with nAPI use limited to startup boundaries where materially needed.
- Rule directories are versioned and treated as data inputs.
