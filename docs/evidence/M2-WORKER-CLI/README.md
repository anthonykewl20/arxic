# M2-WORKER-CLI evidence summary

## Result

| Test                                                          | Result  | Evidence                                                                                                        |
| ------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| Explicit local/worker CLI selection, local default retained   | PASS    | `apps/cli/src/__tests__/args.test.ts`                                                                           |
| Worker startup/stream/approval/cancel/protocol sad paths      | PASS    | `apps/cli/src/__tests__/worker-executor.test.ts`                                                                |
| Real Docker worker lifecycle selected through `runCli`        | PASS    | `apps/cli/src/__tests__/worker-real-world.test.ts`                                                              |
| ADR §20.1 failed-run artifact shape and deterministic cleanup | PASS    | Real-Docker test's `run.json`, `config.json`, `diagnostics.jsonl`, and absent container/network assertions      |
| Full stages 0–12 pipeline executes inside the sandbox         | BLOCKED | No packaged worker runtime/image or artifact/network transport; WorkerClient exposes no pipeline result payload |

## Browser artifacts

No browser behavior ran in worker mode, so no Playwright trace or screenshot is
claimed. Creating synthetic browser evidence would conceal the packaging
blocker. Existing local-mode browser proofs remain unchanged.

The missing runtime is concrete: the sandbox launches a generic
`node:20-alpine` keepalive while this repository requires Node 22 and also needs
installed workspace/native dependencies, Chromium, `git`, and `sg`. The only
writable filesystem is an 8 MiB tmpfs, with no result transport, and the
internal network cannot use host loopback for the target. A purpose-built,
pinned image; writable artifact transport/quota; declared target/fixture/model
peers; and a structured pipeline result payload are prerequisites.

## Isolation evidence

The CLI real-Docker test proves it uses and cleans up the real WorkerClient
sandbox. The unchanged detailed non-root, read-only-root/source, tmpfs,
default-deny internal-network, no-socket, cap-drop, quota, and OOM proofs remain
in `packages/environment/src/__tests__/worker-sandbox.real-world.test.ts` and
`apps/worker/src/__tests__/worker-client.test.ts`.
