# M2-WORKER-IMAGE-WIRE — staged doc updates (charter §10.2)

Issue: #103 · PR: #TBD · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #103 | [M2] Worker-backed CLI — B1 image complete: in-repo Dockerfile (#162 spike, #164 non-root-ready, this slice system-wide pnpm + sandbox wiring); next B2 result-volume (#156, in flight as #165) → B3 pipeline-result protocol (#157) → end-to-end stages-0–12 sandbox proof | 🚧 in progress (B1 done; B2 in flight) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-13 | **#103 (M2-WORKER-IMAGE-WIRE) B1-wire step 2 DONE: system-wide pnpm + sandbox image wiring.** Replaced corepack with `npm install -g pnpm@11.17.0` + `PNPM_HOME=/opt/pnpm` in apps/worker/Dockerfile: corepack re-fetches its prepared package per-uid over the network, which fails under the sandbox's no-egress internal network (reproduced red — `ENOENT /home/node/.cache/node/corepack/v1`); the system-wide install puts a real pnpm binary in `/usr/local/bin` every uid can execute with no network. `createLocalWorkerClient` wires the `arxic-worker:dev` image via the existing `spec.image` field (overridable via `ARXIC_WORKER_IMAGE` env / client `image` option); NOT ONE isolation flag changed (--user, --read-only, --security-opt no-new-privileges, --cap-drop ALL, --tmpfs /work, read-only source bind, internal network, quotas all untouched — ADR §16). New real-image hardening suite (`worker-image.real-world.test.ts`, skips if Docker/image unavailable) launches `arxic-worker:dev` under FULL hardening and proves node ≥22.22, pnpm 11.17.0, ast-grep 0.45.0 all run as non-root with NO egress (the red→green pivot); also re-asserts non-root, read-only rootfs, source-readable, metadata-egress-denied. build-and-verify.sh retags `arxic-worker:dev` and adds a no-egress regression guard. `dockerImageInspect` added to docker-cli.ts (end-of-file; distinct region from #165's mid-file volume helpers). **No isolation property weakened.** Disposition: observed. Gates: typecheck ✓ · lint ✓ · format:check ✓ · test (68/68 in affected packages; 2 pre-existing m0-pipeline sad-path failures reproduce on clean main locally, unrelated to this slice, main CI green). Next: B2 (#156/#165 result-volume transport) → B3 (#157 pipeline-result protocol) → end-to-end stages-0–12 sandbox proof → flip ADR-006 Proposed→Accepted. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### changed`

```
- M2-WORKER-IMAGE-WIRE system-wide pnpm + sandbox image wiring (#103): the worker Dockerfile installs pnpm via `npm i -g` (not corepack) so the toolchain runs as any non-root uid under the sandbox's no-egress internal network; `createLocalWorkerClient` launches the `arxic-worker:dev` image through the existing `spec.image` field with zero isolation-flag changes (ADR §16). Real-image hardening suite proves node/pnpm/ast-grep run non-root with no egress.
```

## 4. `VERSION` bump required?

no — infrastructure/plumbing for an unreleased M2 capability; no user-observable change yet (the worker executor still fail-closes on `ARXIC-EXEC-WORKER-PROTOCOL` until B3 lands).

## 5. Evidence pointers

- Real-world proof: `packages/environment/src/__tests__/worker-image.real-world.test.ts` — launches the real `arxic-worker:dev` image (built from `apps/worker/Dockerfile`) under full sandbox hardening (non-root host uid, read-only rootfs, tmpfs /work, read-only source bind, cap-drop ALL, no-new-privileges, internal network, quotas); real `node`/`pnpm`/`sg` exec as non-root with no network egress.
- Build/verify: `apps/worker/build-and-verify.sh` — root + non-root (uid 1000) toolchain checks + a no-egress internal-network regression guard (the B1-spike failure mode).
- Red→green: pre-fix, `pnpm --version` under the internal network threw `ENOENT /home/node/.cache/node/corepack/v1` (corepack fetch); post-fix, resolves locally (11.17.0).
- Gates: typecheck ✓ · lint ✓ · format:check ✓ · test (worker+environment packages 68/68) ✓ · license gate (unchanged graph) ✓

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                             | Expected disposition                                                     | Test                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| corepack re-fetch under no-egress internal network (B1 spike image) | blocked (toolchain unavailable) — RED, now closed by system-wide install | `worker-image.real-world.test.ts` (red confirmed pre-fix) + `build-and-verify.sh` no-egress guard |
| write to read-only rootfs (/etc)                                    | blocked (read-only file system)                                          | `worker-image.real-world.test.ts`                                                                 |
| cloud-metadata egress (169.254.169.254)                             | blocked (network unreachable)                                            | `worker-image.real-world.test.ts`                                                                 |
| Docker unavailable / image not built                                | skip (not a defect)                                                      | `worker-image.real-world.test.ts` beforeAll guard                                                 |
