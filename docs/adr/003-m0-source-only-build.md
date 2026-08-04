# ADR-003: M0 source-only build strategy (no emit)

| Field      | Value                                                |
| ---------- | ---------------------------------------------------- |
| Status     | Accepted (2026-08-04)                                |
| Decides    | Whether Arxic packages build/emit during Milestone 0 |
| Relates to | ADR-001 §18 (repository layout), issue #1            |
| Owners     | Arxic maintainers                                    |

## Context

ADR-001 §18 places packages under `packages/*` consumed by `apps/*`. Issue #1
asked for per-package `tsconfig`s and a `pnpm -r build` script. The existing
tooling (`tsconfig.base.json` with `noEmit: true`, every `package.json` `main`
pointing at `src/index.ts`, Bundler module resolution, vitest compiling
TypeScript on demand) already consumes **source directly** with no emit.

## Decision

**M0 is source-only: packages do not build or emit.**

- The gate is `typecheck` (`tsc --noEmit`), `lint`, and `test` — not `build`.
- Workspace packages resolve each other via `main: src/index.ts` (raw `.ts`),
  type-checked by `tsc` and compiled on demand by vitest. No `dist/` is produced.
- A `build`/emit step is **deferred** until a package must ship a published
  artifact or a runtime that cannot consume source (e.g. a standalone worker
  bundle). Introducing one requires a new ADR.

## Consequences

- No `build` script exists in M0; this is intentional, not missing.
- Per-package `tsconfig.json` (extends `tsconfig.base.json`, `noEmit`) + a
  `typecheck` script + root `typecheck:packages` (`pnpm -r typecheck`) give
  deterministic per-package typechecking without emit.
- `pnpm install` stays the single materialization step; nothing compiles ahead
  of the gates.
