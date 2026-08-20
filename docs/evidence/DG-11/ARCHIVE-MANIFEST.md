# DG-11 evidence archive manifest — archived raw artifacts (issue #255)

Two artifact groups live in the local-only archive rather than the repo:

1. **Oversized raw source-scan artifacts** (`artifacts/01.json` raw scan
   events, `artifacts/02.json` normalized index per run) — 15–76 MB each,
   exceeding any sensible in-repo size.
2. **Fixture-laden stage-3 match artifacts** (`directus artifacts/03.json`
   per run) — small (~2 MB) but carrying upstream directus public
   test-fixture code that trips the production secret scanner's
   `password-literal` rule (see Disposition below).

Each archived file is bound to its run record by sha256 so provenance is
checkable.

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
| docs/evidence/DG-11/directus/runs/directus-g3-run1/artifacts/03.json | directus-g3-run1 | ac3f7ff019466dfdcc2d3f68354bac1e5a40deee3a78ef4ed18732e7af608c5e | 2062109  | /home/soultransit/devtony/thirdparty-dg/dg11-evidence-archive/directus/directus-g3-run1/03.json |
| docs/evidence/DG-11/directus/runs/directus-g3-run2/artifacts/03.json | directus-g3-run2 | b15b4202495c8869380a8ff5ef14c1c189a22cea795638c687d5dc95798310c3 | 2062109  | /home/soultransit/devtony/thirdparty-dg/dg11-evidence-archive/directus/directus-g3-run2/03.json |
| docs/evidence/DG-11/directus/runs/directus-g3-run3/artifacts/03.json | directus-g3-run3 | a7337593ff56d5bb9895f59a2e2b84c44292735c34ad2bf6ecd87e6953d12ee7 | 2062109  | /home/soultransit/devtony/thirdparty-dg/dg11-evidence-archive/directus/directus-g3-run3/03.json |

Total archived: 11 files, 490,449,209 bytes (~468 MiB). Digests were taken
before the move and re-verified at the archive location after it — byte
identical.

Notes:

- The three directus `02.json` files are byte-identical
  (`ede11819…`, deterministic normalization of the same scan tree); each
  run keeps its own archived copy for per-run completeness.
- The directus `01.json` files differ only in run-varying metadata
  (`generatedAt`); their event payloads are the same scan.
- The three directus `03.json` files are same-sized (2,062,109 bytes) but
  digest-distinct (run-varying match metadata); each is the stage-3
  `express-form-fields` match set for its run.

## Rationale

- Raw source-scan artifacts (15–76 MB each, ~462 MB total) exceed sensible
  repository size; they are retained **locally outside the repo** — like
  the upstream reference trees, local-only.
- The fixture-laden directus `artifacts/03.json` files are archived for the
  security-hygiene reason documented in the Disposition below, not size.
- The sha256 digests above bind each archived file to its run record, so
  any future challenge can re-verify the archive against the digest
  recorded here (and the scan's per-file `blobSha256` values inside
  `01.json`/`02.json` bind the scan to the clone at the ratified pin).
- The **gate-relevant artifacts remain in-repo**: `artifacts/13.json`
  (stage-13 inventory), `artifacts/04.json` (stage-4 proposalRun),
  `artifacts/09.json`/`10.json`, `koel artifacts/03.json`, the remaining
  small artifacts, `stages/` (including every `stages/03.json` checkpoint),
  `diagnostics.jsonl`, `intents.json`, `config.json`, `run.json`, the run
  records (`runs/<runId>.json`), refusals, and the spend ledgers. The
  record validator (`validate-records.ts`) scans records/ledgers —
  archived-out raw artifacts are not its concern.
- Files ≤5 MB were not moved, except the three directus `03.json` files
  covered by the Disposition below.

## Disposition — scanTextForSecrets password-literal findings (FINDING 5356672827)

The offline record validator flagged 3 `secretFindings`, all of class
`password-literal`, one per directus run's `artifacts/03.json`. Each
flagged string is the fixture-keyed login-field pair from directus's
blackbox auth tests: it assigns `USER[userKey].PASSWORD` (and the matching
fixture email) into a login-request body, and the scanner's regex matches
the `USER[...]` expression tail following the password key. It is verbatim
upstream **directus public test-fixture code** — not an arxic-invented or
real credential. Proof — the
flagged captures cite, at clone commit
`cb846b6a1ddc4811359bc52b74bb31a42eab33db` (pinned clone
`/home/soultransit/devtony/thirdparty-dg/directus`, remote
`https://github.com/directus/directus.git`), these public files and lines:

- `tests/blackbox/tests/common/auth/refresh.test.ts:19` and `:29` —
  <https://github.com/directus/directus/blob/cb846b6a1ddc4811359bc52b74bb31a42eab33db/tests/blackbox/tests/common/auth/refresh.test.ts#L19>
- `tests/blackbox/tests/common/logger/redact.test.ts:60` and `:70` —
  <https://github.com/directus/directus/blob/cb846b6a1ddc4811359bc52b74bb31a42eab33db/tests/blackbox/tests/common/logger/redact.test.ts#L60>
- `tests/blackbox/tests/db/websocket/auth.test.ts:150` and `:243` —
  <https://github.com/directus/directus/blob/cb846b6a1ddc4811359bc52b74bb31a42eab33db/tests/blackbox/tests/db/websocket/auth.test.ts#L150>

`USER` itself is the shared public fixture object defined at
`tests/blackbox/common/variables.ts:56` —
<https://github.com/directus/directus/blob/cb846b6a1ddc4811359bc52b74bb31a42eab33db/tests/blackbox/common/variables.ts#L56>
— whose dummy values (`AdminPassword`, `TestsFlowPassword`, …) are public
upstream test credentials, not secrets.

Disposition:

- The content is upstream-public; per security-hygiene minimization the
  three `artifacts/03.json` files are **retained locally under sha256
  digest** (table above), **not committed**. No record was hand-redacted —
  the match data moves verbatim to the archive.
- The in-repo evidence directory is now scan-clean: the offline validator
  reports `secretFindings: 0` over `docs/evidence/DG-11`.
- The **gate itself was NOT modified** — the `scanTextForSecrets` scanner
  and the redaction gate are untouched (no allowlisting, no pattern
  loosening); this is a class disposition for FINDING 5356672827, recorded
  here, not a scanner change. The finding was true-positive-by-design
  fixture code carried in match `REQUEST` fields; the resolution is
  minimizing where that fixture text lives, not weakening the scan.
- The live-key scan (`--live-key-env ARXIC_MODEL_API_KEY`) remains the
  closure-time binding check and is unaffected by this archive.
