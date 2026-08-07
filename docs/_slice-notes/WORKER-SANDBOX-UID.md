# WORKER-SANDBOX-UID — staged doc updates (charter §10.2)

Issue: #95 · PR: #96 · Disposition: verified (deterministic property re-proved against real Docker; portability defect removed)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

This is a carried follow-up fix, not a milestone item, so there is no milestone-tracker row to flip. The **Carried follow-ups** bullet for this defect should be removed once folded (it is fully resolved by this slice):

```
- (REMOVE) `worker-sandbox.ts` still hardcodes `workerUser` to `'1000:1000'` (lines 71, 99). #93's CI failure was fixed test-side (source dirs `chmod 0755`, files `0644`) rather than at the sandbox, so a real caller whose source is owned by another uid still gets an unreadable bind mount. The hardcoded default is the remaining portability defect.
```

The sibling carried follow-up (#93's read-only-source assertion) is also resolved here and should be removed:

```
- (REMOVE) #93's read-only-source assertion now accepts `permission denied` alongside `can't create`/`read-only file system` to cover busybox vs GNU. That is broader than the property under test — a permissions error could in principle mask a missing `--read-only` mount.
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-07 (8) | **fix(worker-sandbox-uid): host-uid default + tightened read-only assertion (#95).** `@arxic/environment/worker-sandbox.ts` no longer hardcodes `workerUser` to `'1000:1000'`; `defaultWorkerUser()` (service) resolves the `--user` default to `${process.getuid()}:${process.getgid()}` on POSIX so a bind-mounted source stays readable for whoever actually owns it, with a non-root `1000:1000` fallback where `getuid`/`getgid` are undefined (Windows; readability there is mediated by the runtime's file sharing). `assertSafeSpec`'s root rejection is unchanged and runs before any `docker run`; when the host process runs as root the default resolves to `0:0` and fails closed with a clear diagnostic (the worker never silently runs as root). No isolation property changed (internal network, `--read-only` rootfs, read-only source bind, tmpfs `/work`, quotas, `no-new-privileges`, `cap-drop ALL`, no socket / daemon env / privileged / host network). #93's masking `chmod 0755/0644` reverted in both real-world suites so every real-Docker test exercises the real `0700`-host-owned fixture condition; new red-first test reads a `0700`+`0600` source under the default and asserts `id -u`/`id -g` == host uid/gid — red against the old `1000:1000` on any host whose uid != 1000 (the CI runner), green after the fix. #93's read-only-source write assertion tightened from `/read-only file system|can't create|permission denied/i` to `/read-only file system/i` (busybox reuses `can't create` for `Permission denied`, so the old matcher could pass on a permissions failure and mask a missing `--read-only` mount; EROFS renders `Read-only file system` on both glibc and musl). Real Docker proof re-proves non-root, read-only rootfs + source bind, writable tmpfs, readable `0700` source, cross-job/host-path denial, egress denial, OOM quota, network isolation, cleanup idempotency, and injection neutralization. Independent hy3 + deepseek review: APPROVE, no blockers; pre-existing `uid:N`/`gid:0` (root-group) regex gap flagged as a follow-up (concerns explicit `workerUser`, not the default; regex unchanged here). Gates: typecheck/lint/format clean; real Docker sandbox 16/16, worker-client 10/10. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Fixed`

```
- worker-sandbox-uid: default worker sandbox `--user` to the host uid:gid (#95): `@arxic/environment` `defaultWorkerUser()` resolves `${process.getuid()}:${process.getgid()}` on POSIX (non-root `1000:1000` fallback on non-POSIX) so a bind-mounted source owned by a non-1000 host uid stays readable, while `assertSafeSpec` still rejects `root`/`0`/`0:0` fail-closed before any container starts (host-as-root resolves to `0:0` and is rejected with a clear diagnostic). No isolation property weakened. Tightened the read-only-source write assertion to require the kernel EROFS string (`Read-only file system`) so a permissions failure can no longer mask a missing `--read-only` mount; added a red-first real-Docker test for the host-uid default and reverted #93's masking `chmod 0755/0644` in the helpers.
```

## 4. `VERSION` bump required?

No. This is an internal portability/isolation-correctness fix with no new public capability and no breaking API change (`workerUser` remains an optional `string`). The new `defaultWorkerUser()` export is additive. No `VERSION` bump.

## 5. Evidence pointers

- Real-world proof: `packages/environment/src/__tests__/worker-sandbox.real-world.test.ts` — real Docker (`node:20-alpine`) re-proves every isolation property after the change, plus the new `reads a host-private (0700) source directory under the host-uid default` test (red-first). `apps/worker/src/__tests__/worker-client.test.ts` — real Docker worker-client lifecycle incl. injection neutralization read from a `0700` source.
- Empirical EROFS/EACCES wording capture: `node:20-alpine` busybox ash → `sh: can't create /etc/foo: Read-only file system` (EROFS) vs `sh: can't create /etc/foo: Permission denied` (EACCES); `debian:stable-slim` GNU bash → `Read-only file system`. Drove the matcher tightening (`/read-only file system/i`).
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (sandbox 16/16, worker-client 10/10 against real Docker) ☑ · license gate ☑
- CI: PR #96 `gh pr checks` (see report).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                               | Expected disposition                                           | Test                                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Host process runs as root → default resolves to `0:0` | blocked (fail-closed before any `docker run`)                  | `assertSafeSpec` root rejection (`workerUser:'0:0'` unit case); diagnostic distinguishes explicit-root from host-as-root |
| Explicit `workerUser: '0:0'` / `'0'` / `'root'`       | blocked                                                        | `rejects an unsafe sandbox spec before touching Docker: root user`                                                       |
| Source owned by a host uid != 1000, dir mode `0700`   | readable (observed) — the defect is fixed                      | `reads a host-private (0700) source directory under the host-uid default` (red-first; red on uid≠1000 hosts incl. CI)    |
| Write to `--read-only` rootfs (`/etc/foo`)            | blocked by EROFS, not by permissions                           | `enforces non-root, read-only rootfs …` — matcher `/read-only file system/i`                                             |
| Write to read-only source bind (`/work/source/proof`) | blocked by EROFS, not by permissions                           | `enforces non-root, read-only rootfs …` — matcher `/read-only file system/i`                                             |
| Cross-job / host-path source read                     | blocked                                                        | `denies cross-job source and host-path reads`                                                                            |
| Host-gateway / cloud-metadata egress                  | blocked                                                        | `allows a declared sibling but denies host-gateway and metadata egress`                                                  |
| Memory-quota breach                                   | blocked (OOMKilled/137 → `ARXIC-WORKER-QUOTA-EXCEEDED`)        | `terminates a memory quota breach …`                                                                                     |
| Prompt-injection payload read from `0700` source      | observed (`ARXIC-WORKER-INJECTION-NEUTRALIZED`), run completes | `neutralizes a real injection payload …`                                                                                 |
| Non-POSIX host (`getuid`/`getgid` undefined)          | non-root `1000:1000` fallback (never root)                     | `falls back to a non-root default when getuid/getgid are unavailable`                                                    |
