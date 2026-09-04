# DG-12 quarantine manifest

- **Timestamp:** 2026-09-01T06:24:13Z
- **Rationale:** SP-5 of gate #256 requires quarantine of legacy recorded artifacts after #358 observed persona credential literals in recorded artifacts. The retained copies are host-side only, intact, and were never deleted.
- **Retention root:** `/home/soultransit/devtony/thirdparty-dg/dg12-quarantine/`

## Removed tracked-evidence paths and host-side retention

| Removed worktree path | Host-side destination | Files | Bytes | Contents retained |
| --- | --- | ---: | ---: | --- |
| `docs/evidence/DG-12/directus/runs/` | `/home/soultransit/devtony/thirdparty-dg/dg12-quarantine/directus/runs/` | 144 | 257671718 | Entire directory: directus run1/run2 records and run directories, promoted bundles, and verification artifacts. |
| `docs/evidence/DG-12/koel/runs/` | `/home/soultransit/devtony/thirdparty-dg/dg12-quarantine/koel/runs/` | 177 | 173156568 | Entire directory: koel run4 through run8 records and run directories, including run8 generated verification-suite files. |
| `docs/evidence/DG-12/koel/blocked-stage4/` | `/home/soultransit/devtony/thirdparty-dg/dg12-quarantine/koel/blocked-stage4/` | 49 | 112981666 | Entire directory: blocked stage-4 run1 through run3 records and directories, plus its README. |

For each path, `cp -a` completed before removal was considered. File count and total-byte checks matched source to destination exactly at the timestamp above. The tracked evidence copies were then removed so the loader tolerates zero measurable runs without placeholder files.

The directus run1/run2 pair was measurement-green (G-2/3/4/5/7 PASS in the 2026-08-31 sweep recorded on the gate branch and #256 trail), but the SP-5 zero-findings rule displaces it. It will be re-recorded fresh after the #359 redaction fix. The blocked-stage4 runs (run1 through run3) also moved to the host-side retention root. No credential values are recorded in this manifest.
