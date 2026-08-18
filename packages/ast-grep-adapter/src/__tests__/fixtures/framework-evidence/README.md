# Framework-evidence fixtures for DG-10

Real-source evidence files used by `framework-gate.test.ts` and the CLI
`framework-gate.test.ts`. None of these files are hand-typed version strings;
each is either produced by the real package manager against the real registry,
or copied from a real third-party repository at a pinned commit.

## `campaign-next-16.2.6/`

Reproduces the 2026-08-16 third-party campaign scenario recorded in
ADR-008 Context: a Next.js **16.2.6** application scanned by a rulepack whose
declared range was `>=15 <16`. **The directory name is that campaign
provenance, not the current resolved version** — it was KEPT (not renamed to
something version-neutral) on 2026-08-18 because an out-of-surface evidence
artifact references the path: `docs/evidence/DG-10/README.md:8`. The rename
procedure's grep (`rg -l 'campaign-next-16\.2\.6' --hidden -g '!.git'` from the
repo root at that time) returned exactly four files: that evidence README plus
the three in-repo references (`framework-gate.test.ts`, the fixture README,
`measure-framework-gate.mts`); any out-of-surface path reference forces KEEP
per the issue #278 contract.

### Refresh provenance (issue #278, 2026-08-18)

The original campaign lockfile is **preserved in git history** at commit
`8cf21e61a4e51c99878bb6f11834d6910351b217`
(`sha256:8d0775bdcb309e9ed03f10b889877938c6f8ae3ad32af77f21ecc726fa88ecf8`) —
it resolved `next@16.2.6`, `postcss@8.4.31`, `sharp@0.34.5`, which is what 14
Dependabot alerts keyed to. The **current** `pnpm-lock.yaml` is a REAL
regeneration — `COREPACK_ENABLE_STRICT=0 corepack pnpm@11.17.0 install
--lockfile-only` against the real npm registry in a temp copy of this
directory (never hand-edited; the committed file is byte-identical to the
generated one) — with security floors applied:

- `package.json` — manifest pinning `next@16.2.11` (bumped past the
  `>=16.0.0 <16.2.11` advisory range, matching PR #274's direction) plus
  `pnpm.overrides` floors `postcss ^8.5.23` / `sharp ^0.35.0`.
- `pnpm-workspace.yaml` — the SAME two floors in pnpm 11's settings home
  (pnpm 11 no longer reads `pnpm` fields from package.json; the mirrored
  package.json field covers pnpm ≤10). The effective overrides are recorded
  in the lockfile's own `overrides:` section.
- `pnpm-lock.yaml` — real pnpm 11 (lockfileVersion `9.0`) resolving
  `next@16.2.11`, `postcss@8.5.26` (≥ 8.5.23 floor), `sharp@0.35.3`
  (≥ 0.35.0 floor), `react`/`react-dom` 19.2.3.

Manifest and lockfile agree on `next` — asserted at test time by
`framework-gate.test.ts` (the AC-3 coherence test), so a future bump that
touches only one file fails red.

## `koel/`

Real files from [koel/koel](https://github.com/koel/koel) (MIT) at commit
`dfec91ff290509c622ff7cf392fb5e506841ee2b` — the same commit DG-05 pinned for
its production PHP language-pack measurement.

- `composer.json` — the complete real root manifest (`laravel/framework: ^13.0`).
- `composer.lock` — an **excerpt** of the real lockfile retaining only the
  `laravel/framework` package entry (`v13.24.0`); the full file is 602 KB. The
  JSON structure is unchanged composer v2 lockfile format, so the detector
  parses it exactly as it parses a full lockfile.
