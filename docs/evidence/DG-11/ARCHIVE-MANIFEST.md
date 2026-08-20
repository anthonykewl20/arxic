# DG-11 evidence archive manifest — oversized raw artifacts (issue #255)

The DG-11 raw source-scan artifacts (`artifacts/01.json` raw scan events,
`artifacts/02.json` normalized index per run) are 15–76 MB each and exceed
any sensible in-repo size. They have been **moved out of the repository to
a local-only archive**; this manifest binds each archived file to its run
record by sha256 so provenance is checkable.

## What moved

| Original repo path (removed)                                         | Run ID           | sha256 (sha256sum)                                               | Bytes    | Archived at (local-only, outside the repo)                                                      |
| -------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| docs/evidence/DG-11/directus/runs/directus-g3-run1/artifacts/01.json | directus-g3-run1 | fa35460e22e2a4ba2532a01bce89aa375a0dce619f1736a8f01e36bde6fee725 | 76067460 | /home/soultransit/devtony/thirdparty-dg/dg11-evidence-archive/directus/directus-g3-run1/01.json |
| docs/evidence/DG-11/directus/runs/directus-g3-run1/artifacts/02.json | directus-g3-run1 | ede11819d30838764a29bf4baa860fbbcaa545b06e9eb28a321f145fdd10709e | 74767477 | /home/soultransit/devtony/thirdparty-dg/dg11-evidence-archive/directus/directus-g3-run1/02.json |
| docs/evidence/DG-11/directus/runs/directus-g3-run2/artifacts/01.json | directus-g3-run2 | 7a53bd83b93437aa69e3ece8cd9586ba85cb867f73f065537d0c2512672857de | 76067460 | /home/soultransit/devtony/thirdparty-dg/dg11-evidence-archive/directus/directus-g3-run2/01.json |
| docs/evidence/DG-11/directus/runs/directus-g3-run2/artifacts/02.json | directus-g3-run2 | ede11819d30838764a29bf4baa860fbbcaa545b06e9eb28a321f145fdd10709e | 74767477 | /home/soultransit/devtony/thirdparty-dg/dg11-evidence-archive/directus/directus-g3-run2/02.json |
| docs/evidence/DG-11/directus/runs/directus-g3-run3/artifacts/01.json | directus-g3-run3 | 1c26645ba502b7e7ec1e2056eceeda244d7f947c4a777f7b7b5b9bc172967796 | 76067460 | /home/soultransit/devtony/thirdparty-dg/dg11-evidence-archive/directus/directus-g3-run3/01.json |
| docs/evidence/DG-11/directus/runs/directus-g3-run3/artifacts/02.json | directus-g3-run3 | ede11819d30838764a29bf4baa860fbbcaa545b06e9eb28a321f145fdd10709e | 74767477 | /home/soultransit/devtony/thirdparty-dg/dg11-evidence-archive/directus/directus-g3-run3/02.json |
| docs/evidence/DG-11/koel/runs/koel-g3-run1/artifacts/01.json         | koel-g3-run1     | 814c84797db6df804ca9567a304dba504feb438476d65854db33fccdf6a73d16 | 16286685 | /home/soultransit/devtony/thirdparty-dg/dg11-evidence-archive/koel/koel-g3-run1/01.json         |
| docs/evidence/DG-11/koel/runs/koel-g3-run1/artifacts/02.json         | koel-g3-run1     | dd6dbac4b9a09cfa277c5e9734f8b0210f3fc428a1780cab132fe62c580aaf0e | 15471386 | /home/soultransit/devtony/thirdparty-dg/dg11-evidence-archive/koel/koel-g3-run1/02.json         |

Total archived: 8 files, 484,262,882 bytes (~462 MiB). Digests were taken
before the move and re-verified at the archive location after it — byte
identical.

Notes:

- The three directus `02.json` files are byte-identical
  (`ede11819…`, deterministic normalization of the same scan tree); each
  run keeps its own archived copy for per-run completeness.
- The directus `01.json` files differ only in run-varying metadata
  (`generatedAt`); their event payloads are the same scan.

## Rationale

- Raw source-scan artifacts (15–76 MB each, ~462 MB total) exceed sensible
  repository size; they are retained **locally outside the repo** — like
  the upstream reference trees, local-only.
- The sha256 digests above bind each archived file to its run record, so
  any future challenge can re-verify the archive against the digest
  recorded here (and the scan's per-file `blobSha256` values inside
  `01.json`/`02.json` bind the scan to the clone at the ratified pin).
- The **gate-relevant artifacts remain in-repo**: `artifacts/13.json`
  (stage-13 inventory), `artifacts/04.json` (stage-4 proposalRun),
  `artifacts/09.json`/`10.json`, `03.json` (≤5 MB), the remaining small
  artifacts, `stages/`, `diagnostics.jsonl`, `intents.json`, `config.json`,
  `run.json`, the run records (`runs/<runId>.json`), refusals, and the
  spend ledgers. The record validator (`validate-records.ts`) scans
  records/ledgers — archived-out raw artifacts are not its concern.
- Files ≤5 MB were not moved.
