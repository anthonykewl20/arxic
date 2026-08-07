# ROOT-GROUP-REGEX — staged doc updates (charter §10.2)

Issue: #101 · PR: #106 · Disposition: observed

> Disposition is `observed` per ADR §2 / AGENTS.md: an LLM never assigns
> `verified`. Real Docker 29 + the official `docker run` reference back the
> claims below; the integrator may upgrade the truth state at fold-in.

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #101 | [ROOT-GROUP-REGEX] Worker sandbox: reject root-group (gid 0) workerUser | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-07 | **#101 (ROOT-GROUP-REGEX) Worker sandbox root-group rejection DONE.** `assertSafeSpec` now rejects any caller-supplied `workerUser` whose uid OR gid denotes root, before any Docker call. Coverage goes beyond the issue's `uid:0` to every numeric-zero form Docker 29 parses as 0 (`0`, `00`, `+0`, `-0`), the `root` name (case-insensitive), and — surfaced by independent review (deepseek) and confirmed against real Docker — empty components (`1000:` → gid 0, `:`/`` → uid 0); existing `root`/`0`/`0:0` rejections retained. Red-first (the `1000:0` row resolved to a live container pre-fix). Real Docker re-proved all isolation properties, plus a positive test that a caller-supplied non-root `workerUser` is accepted and runs as that identity. Gates: typecheck ✓ · lint ✓ · test (530) ✓ · license ✓ · format ✓. Next: integrator folds note. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### security`

```
- ROOT-GROUP-REGEX worker sandbox root-group rejection (#101): `assertSafeSpec` rejects a caller-supplied `workerUser` that holds root uid or root group (gid 0) — covering `1000:0`, `1000:root`, every numeric-zero form Docker parses as 0 (`00`, `+0`, `-0`), and empty components (`1000:`, `:`, ``), which Docker also resolves to uid/gid 0 — fail-closed before any Docker call. Existing `root`/`0`/`0:0` rejections are unchanged, no isolation property is weakened, and the resolved default user is untouched. Proven red-first and against real Docker (all isolation properties re-proved, plus a positive caller-supplied non-root user test).
```

## 4. `VERSION` bump required?

Patch (`0.x.y`), integrator-owned. Per `RELEASES.md`, a `security`/`fixed` verb at user-observable level implies a behavior-impacting release: a caller-supplied `workerUser` with gid 0 now throws where it previously ran. `VERSION` and `package.json` are not edited on this branch (charter §10.2); recommend the integrator take a patch bump at fold-in.

## 5. Evidence pointers

- Real-world proof: `packages/environment/src/__tests__/worker-sandbox.real-world.test.ts` — real Docker 29 ran the full isolation suite under the strengthened validation and all of it stayed green: non-root / read-only rootfs / writable tmpfs / readable host-private (0700) source, cross-job + host-gateway + cloud-metadata egress denial, memory-quota OOM kill, per-job network isolation, and cleanup + idempotent stop. A dedicated positive test also proves an explicitly-supplied, non-root `workerUser` is accepted and the container runs as exactly that uid:gid (pins the allow-side against future over-rejection).
- Grammar verification: official `docker container run` reference documents `--user` as `<name|uid>[:<group|gid>]` (two components max; supplementary groups come from `--group-add`, which this sandbox never exposes). Empirical checks against Docker 29.7.1 confirmed (a) `00`, `000`, and `+0` all resolve to uid/gid 0, and (b) an omitted half resolves to 0 — `--user 1000:` → `gid=0(root)`, `--user :` and `--user ""` → `uid=0(root)`. These probes are why the matcher treats any integer parsing to 0 AND any empty component as root, not just the literal `0`.
- Independent review: reviewer-hy3 (APPROVE) and reviewer-deepseek (REQUEST CHANGES) disagreed; deepseek's blocking finding (the empty-component bypass) was reproduced against real Docker and fixed. Consensus would have missed it — ground truth overrode it.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (530 passing) ☑ · license gate ☑

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                                            | Expected disposition                         | Test                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| caller `workerUser` = `1000:0` (non-root uid, root group) — the defect                                             | rejected before any Docker call, fail-closed | `rejects a caller-supplied workerUser holding root uid or root group before Docker: root group on a non-root uid` |
| caller `workerUser` = `1000:root` / `1000:ROOT` (root group by name, case variants)                                | rejected before any Docker call              | same `it.each`, the name / uppercase rows                                                                         |
| caller `workerUser` = `1000:00` / `1000:+0` (numeric-zero gid variants Docker parses as 0)                         | rejected before any Docker call              | same `it.each`, the leading-zero / signed-zero rows                                                               |
| caller `workerUser` = `1000:` / `:` / `` (empty component; Docker resolves an omitted half to 0 — found by review) | rejected before any Docker call, fail-closed | same `it.each`, the empty-gid / empty-both / empty-workerUser rows                                                |
| caller `workerUser` = `00:1000` (numeric-zero uid)                                                                 | rejected before any Docker call              | same `it.each`, the leading-zero uid row                                                                          |
| caller `workerUser` = `0` / `root` / `0:0` / `0:1000` (regression guard for the pre-existing root-uid rejections)  | still rejected, none traded away             | same `it.each`, the respective rows                                                                               |
| caller `workerUser` = a non-root uid:gid (host uid:gid)                                                            | accepted; container runs as that identity    | `accepts a caller-supplied non-root workerUser and runs as that identity` (positive real-Docker test)             |
| default user (host uid:gid) flowing through the strengthened `assertSafeSpec`                                      | proceeds; every isolation property intact    | the real-Docker suite (8 tests)                                                                                   |

All sad paths are **observed** by a red-first test (the `1000:0` row resolved to a live container before the fix) and corroborated by real Docker + the official `docker run` reference. `verified` is reserved for the integrator.
