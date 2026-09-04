# Koel DG-12 hostbound runs 12–15

Recorded 2026-09-01 on `dg12-exit-gate` with the ratified koel pin
`dfec91ff290509c622ff7cf392fb5e506841ee2b`.

Both launch attempts refused before any model call or pipeline stage because
`ARXIC_MODEL_BASE_URL` and `ARXIC_MODEL_API_KEY` were absent or blank in the
operator environment. The launcher also found neither required persona variable
present. The runner removes an unstarted run directory on this refusal; the
sanitized retained evidence is the fail-closed record plus its adjacent launch
environment proof:

- `refusals/koel-dg12-hostbound-run12-credentials-missing.json`
- `refusals/koel-dg12-hostbound-run13-credentials-missing.json`
- `runs/koel-dg12-hostbound-run12.environ-proof.json`
- `runs/koel-dg12-hostbound-run13.environ-proof.json`

No deterministic verifier result, Chromium replay, validator stage artifact,
or origin-containment result exists for either run because execution did not
reach the pipeline. Both records report `upstreamCallsPlaced: 0`; the spend
ledger therefore remains at `0.0135657` USD of its `1.00` USD ceiling and has
no invented zero-spend entries for these preflight refusals.

An additional no-spend `dg11-koel-…-credentials-missing.json` refusal was
written by the initial dry-preflight invocation before its run id was pinned.
It is retained as the tool's sanitized operational record rather than removed.

## Runs 14 and 15

Runs `koel-dg12-hostbound-run14` and `koel-dg12-hostbound-run15` subsequently
reached the deterministic verifier with fresh per-run SQLite state and
ephemeral application origins. Their launch proofs retain only hashes of the
two intended persona values:

- `runs/koel-dg12-hostbound-run14.environ-proof.json`
- `runs/koel-dg12-hostbound-run15.environ-proof.json`

Both generated suites navigated to the configured root and passed the
pre-action origin-containment assertion. Each then failed, on both required
replays, at the same unique-login-form assertion: `Expected: 1 | Received: 0`.
The deterministic verifier therefore recorded `outcome: "contradicted"` in
each `artifacts/10.json`; the enclosing DG-11-compatible records remain
`status: "partial"`, `outcome: "blocked"`, and `finalStage: "stage-12"`.
No assertion was weakened and neither run was retried after this repeatable
result.

Neither run retained a screenshot or action timeline: the verifier also
reported `ARXIC-SCREENSHOT-INVENTORY-INVALID`, so the evidence artifact list is
empty. This is a second fail-closed blocker, not evidence that the visual flow
passed. Each run additionally retained `ARXIC-SOURCE-DIRTY-TREE` for
`public/img/storage/.gitkeep`; the source clone was restored after execution,
but the diagnostic remains part of the immutable run record.

Post-run checks over the retained evidence reported the following:

- `validate-records.ts` accepted the koel evidence directory with zero secret
  findings; the live-key comparison was clean.
- Both per-run deterministic-ledger rebuilds were byte-identical modulo
  `generatedAt` and matched their recorded ledgers.
- The two-run DG-12 sweep passed coverage, grounded ratio, fabrication audit,
  and two-run difference attribution, but failed replay ratio: `0/2` verified
  replays (`0.00%`, below the required `90%`).

Runs 14 and 15 recorded zero metered calls and zero measured cost. The spend
ledger remains `0.0135657` USD of the `1.00` USD Koel ceiling. The next work is
to investigate the anonymous login-form observation and screenshot-inventory
failure from these retained artifacts before any new campaign is authorized.
