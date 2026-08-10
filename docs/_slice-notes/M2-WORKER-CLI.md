# M2-WORKER-CLI — staged doc updates (charter §10.2)

Issue: #103 · PR: not opened · Disposition: blocked

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| #103 | [M2-WORKER-CLI] Wire CLI to ephemeral worker | ☐ blocked: packaged stages 0–12 worker runtime and pipeline-result payload missing |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-08-10 | **#103 (M2-WORKER-CLI) honest groundwork increment BLOCKED on full pipeline execution.** Added explicit `--executor local|worker` selection (local remains default), a CLI-owned `WorkerRunExecutor` over the existing `WorkerClient` lifecycle, fail-closed startup/stream/approval/cancel/cleanup/protocol classification, prose-safe frozen diagnostics, and the same failed-run ADR §20.1 artifact writer as local mode. Real Docker proves CLI selection, worker creation/cleanup, and the honest protocol block. Full stages 0–12 sandbox execution remains blocked on a Node 22 pipeline worker image containing the pinned workspace/native/browser/`git`/`sg` runtime, writable artifact transport plus declared internal-network target/fixture/model peer transport, and a structured pipeline-result protocol payload carrying `RunState`, checkpoints, artifacts, and receipt. This groundwork should merge as an M2 increment; #103 stays open until those capabilities are delivered. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### changed`

```text
- M2-WORKER-CLI worker-backed CLI groundwork (#103): `arxic run` now accepts `--executor local|worker` while retaining local execution by default. The CLI action layer owns worker lifecycle and fail-closed classification over the existing `WorkerClient`; Docker mechanics remain in `@arxic/environment`. Worker mode writes the same failed-run ADR §20.1 schema but blocks with `ARXIC-EXEC-WORKER-PROTOCOL` rather than treating the lifecycle-only worker as a completed stages 0–12 run. Real Docker proves selection and deterministic cleanup; a Node 22 pipeline worker image containing the workspace/native/browser/`git`/`sg` runtime, writable artifact transport plus internal-network peer transport, and a structured pipeline-result payload carrying `RunState`, checkpoints, artifacts, and receipt remain required.
```

## 4. `VERSION` bump required?

no — this is an honest groundwork increment, not the requested worker-hosted pipeline capability; #103 stays open and the integrator should version the completed M2 capability

## 5. Evidence pointers

- Real-world proof: `apps/cli/src/__tests__/worker-real-world.test.ts` — the real Docker-backed WorkerClient is selected through `runCli`, cleaned up, and recorded as an honest blocked run.
- Isolation proof: `packages/environment/src/__tests__/worker-sandbox.real-world.test.ts` and `apps/worker/src/__tests__/worker-client.test.ts` — unchanged real-Docker non-root/read-only/default-deny/no-socket/quota proofs.
- Artifacts: `docs/evidence/M2-WORKER-CLI/README.md`; no screenshots or traces are claimed because the missing worker runtime prevented browser execution.
- Gates: typecheck ☑ (`pnpm typecheck`, `pnpm -r typecheck`) · lint ☑ · format ☑ · test ☑ (96 files / 773 tests; real Docker worker sandbox 31 tests, WorkerClient 10 tests, worker-backed CLI 1 test) · license gate ☑ (782 packages, 0 rejected)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                         | Expected disposition                                               | Test                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| Worker startup rejects or throws                                | blocked, no raw worker prose                                       | `worker-executor.test.ts` startup interruption |
| Event stream interrupts                                         | blocked, cancellation attempted, cleanup diagnostics retained      | `worker-executor.test.ts` stream interruption  |
| Worker requests approval without an explicit CLI approval flow  | blocked and canceled                                               | `worker-executor.test.ts` approval event       |
| Worker lifecycle says completed but supplies no pipeline result | blocked, no fabricated checkpoints/artifacts                       | `worker-executor.test.ts` protocol result      |
| Real Docker worker completes its historical no-op lifecycle     | blocked run directory plus deterministic container/network cleanup | `worker-real-world.test.ts`                    |
