# M2-RESULT-TRANSPORT — staged doc updates (charter §10.2)

Issue: #156 · PR: pending · Disposition: blocked

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #156 | [M2-RESULT-TRANSPORT] Worker→CLI artifact transport | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-12 | **#156 (M2-RESULT-TRANSPORT) Worker→CLI artifact transport DONE.** Added the per-run writable Docker result volume, supervisor-side raw collection, fail-closed manifest/path/type/count/byte/hash import validation, bounded result-ready control event, and CLI artifact ingress. Real Docker proves quota, symlink, traversal, FIFO, forged hash, and missing-manifest rejection plus unchanged internal-network host/metadata egress denial. Disposition: blocked on every invalid ingress; byte transport assigns no verified state. Gates: 106 files / 921 tests. **M2 #103 remains in progress.** Next: #157. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- M2-RESULT-TRANSPORT worker→CLI artifact transport (#156): added a per-run writable result volume, supervisor-owned byte collection, fail-closed manifest/path/type/quota/SHA-256 validation, bounded result-ready signaling, and CLI run-artifact ingress while preserving the internal-network egress deny proven with real Docker.
```

## 4. `VERSION` bump required?

no

## 5. Evidence pointers

- Real-world proof: `packages/environment/src/__tests__/worker-result-volume.real-world.test.ts` — real Docker and real `node:20-alpine` containers write hostile and valid result-volume entries and re-prove host/metadata egress denial.
- Artifacts: sanitized synthetic PNG and JSON bytes imported in ephemeral test directories; no raw traces or screenshots retained.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (921 passing) ☑ · license gate ☑

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                        | Expected disposition                    | Test                                                                                      |
| ---------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| Result bytes exceed declared quota             | blocked / `ARXIC-WORKER-QUOTA-EXCEEDED` | `blocks an over-quota volume import as ARXIC-WORKER-QUOTA-EXCEEDED`                       |
| Result volume contains a symlink               | blocked / `ARXIC-WORKER-RUN-FAILED`     | `rejects a symlink in the result volume as blocked run failure`                           |
| Manifest declares `../etc/passwd`              | blocked / `ARXIC-WORKER-RUN-FAILED`     | `rejects a manifest path-traversal declaration as blocked run failure`                    |
| Result volume contains a FIFO                  | blocked / `ARXIC-WORKER-RUN-FAILED`     | `rejects a FIFO as a non-regular result file`                                             |
| Declared SHA-256 disagrees with bytes          | blocked / `ARXIC-WORKER-RUN-FAILED`     | `rejects a forged SHA-256 as blocked run failure`                                         |
| Terminal manifest is absent                    | blocked / `ARXIC-WORKER-RUN-FAILED`     | `rejects a missing manifest as ARXIC-WORKER-RUN-FAILED`                                   |
| Result volume is mounted during network probes | host and metadata egress remain denied  | `keeps the result-mounted worker on an internal network denying host and metadata egress` |
