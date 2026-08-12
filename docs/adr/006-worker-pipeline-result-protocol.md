# ADR-006: Worker→CLI pipeline-result protocol (M2-WORKER-CLI / #103)

| Field      | Value                                                                                 |
| ---------- | ------------------------------------------------------------------------------------- |
| Status     | Proposed                                                                              |
| Decides    | The worker→CLI result transport, wire envelope, validation, promotion, and resumption |
| Relates to | ADR-001 §2/§9/§10/§15/§16/§20/§21/§23, ADR-002, ADR-004, issue #103                   |
| Owners     | Arxic maintainers                                                                     |

## Context

Issue #103 moves pipeline stages 0–12 from the CLI process into an ephemeral
Docker sandbox. The CLI↔worker seam already exists in
`apps/worker/src/run-spec.ts` as `RunSpec`, `RunHandle`, `RunStreamEvent`, and
`WorkerClient`. `apps/cli/src/worker-executor.ts` deliberately fail-closes today
with `ARXIC-EXEC-WORKER-PROTOCOL`: lifecycle completion is not accepted as
pipeline completion until a structured result protocol exists.

The sandbox currently has a read-only root filesystem, a read-only source bind
at `/work/source`, an 8 MiB tmpfs at `/work`, and an `internal: true` Docker
network (default-deny internet egress under ADR-001 §16). Its
`node:20-alpine` keepalive runs no pipeline. The missing capability is a safe way
to convey the complete result back to the CLI: orchestrator `RunState`, every
`StageCheckpoint`, binary artifacts, frozen `Diagnostic`s, and a
`PromotionReceipt`, byte-for-byte equivalent to local mode. Issue #103's
acceptance criterion is that results are identical in shape across both
executors.

This is a hard contract-boundary constraint:

- **Frozen** (`packages/contracts/` and `schemas/`): `Diagnostic`, `TruthState`,
  `PromotionReceipt`, `StagedBundle`/`BundleManifest`, and `GateResult`.
  `verified` is reserved for the deterministic verifier; the CLI must never
  synthesize it from worker bytes.
- **Not frozen, orchestrator-local:** `RunState`, `StageCheckpoint`, and
  `ImmutableArtifactRef`.
- **Not frozen, app-local seam:** `RunSpec`, `RunHandle`, `RunStreamEvent`, and
  `WorkerClient`. The header of `run-spec.ts` explicitly permits this seam to
  evolve while requiring the worker to translate internal pipeline state. The
  protocol extension belongs here, not in the frozen contracts.

This design was reached by an independent luna+terra consensus pair debating in
parallel, then checked against LangGraph persistence, Playwright's worker
transport, and GitHub Actions outputs/artifacts. Both reviewers requested
changes to the premise—principally the unresolved worker image and network peer
model—but independently agreed on the protocol design below. Consequently this
ADR remains **Proposed** until real-world proof lands across the implementation
slices, following ADR-004's acceptance pattern.

## Decision

### 1. Use a per-run writable result volume plus a bounded control stream

Choose hybrid **(a)**. The supervisor creates an empty, per-run,
quota-controlled result volume and mounts it writable into the worker. Bulk
artifacts—including sanitized Playwright screenshots/action timelines,
compiled-spec bytes, promoted-bundle candidate bytes, checkpoints, and
canonical JSON—go to that volume. `RunStreamEvent` and process output carry only
bounded lifecycle/progress events and a terminal `result-ready` pointer to a
sealed manifest in the volume.

The current 8 MiB `/work` tmpfs is too small for browser evidence and is not the
result transport. The implementation must provision a separate result-volume
quota. The result volume is **logically outbound-only**: it is created empty per
run and never contains secrets, sockets, configuration, or control inputs.

The CLI imports it as untrusted data. Import rejects absolute paths, `..` path
segments, symlinks, non-regular files, excess file counts, and excess bytes; it
recomputes every declared SHA-256 before accepting any artifact. No result is
read from stdout: `packages/environment/src/docker-cli.ts` decodes `docker exec`
as UTF-8, trims output, and caps `maxBuffer` at 4 MiB, so it is neither
binary-safe nor a complete bulk-data channel.

### 2. Add a seam-local, versioned `PipelineResult` envelope

Define versioned `PipelineResult` wire forms beside the existing app-local seam.
Do not put bulk data into `RunStreamEvent` or `RunHandle`; those remain bounded
lifecycle/progress shapes. Do not export orchestrator `RunState`, and do not
maintain a second hand-copy of it as if it were stable. Instead, the envelope
contains seam-owned wire projections that mirror the needed semantics of
`StageCheckpoint` and `ImmutableArtifactRef`, while directly reusing frozen
`Diagnostic`, `StagedBundle`, `GateResult`, and `PromotionReceipt` where those
contracts apply.

The CLI owns one worker-result normalization path alongside
`runResultFromState` in `apps/cli/src/executor.ts`. After validation, that path
translates `PipelineResult` into the local orchestrator `RunState`; downstream
run-directory and result handling therefore sees the same shape in local and
worker modes. Canonical serialization rules must pin ordering, newline policy,
timestamps, and path normalization so byte-equivalence is testable rather than
an informal type-level claim.

### 3. Decode fail-closed at an untrusted content-as-data ingress

Worker output is new content-as-data ingress under ADR-001 §16.3. Before
normalization, the CLI validates:

- the exact supported protocol version and a strict schema with bounded JSON
  depth, string lengths, counts, and total bytes;
- run ID, source/build/config digests, worker-image/tool/browser/orchestrator
  versions, and replay freshness;
- monotonic checkpoint order, a complete stage prefix, and agreement between
  checkpoint and artifact hashes;
- safe relative artifact paths and every file's independently recomputed
  SHA-256;
- every diagnostic with `validateDiagnostic`, while preserving the existing
  known-code/safe-message projection at `worker-executor.ts:99-121` or replacing
  it only with an equally strict registry projection; and
- frozen validation for workflow, evidence, bundle manifest, gates, staged
  bundle, and receipt fields wherever present.

A worker-supplied `verified` is never authority merely because its bytes and
hashes validate. The envelope must carry a versioned stage-10 verifier record
bound to the run, inputs, verification artifacts, clean replay count, and
verifier version. A `verified` claim without that record, or one inconsistent
with it, is rejected as forged. The CLI never promotes an observed or
worker-asserted value into `verified`.

### 4. Keep authoritative promotion CLI-side

The worker transports a validated `StagedBundle`, verification artifacts, and
gate results as a promotion candidate. The CLI runs authoritative stage-12
promotion against the configured public path. Only that durable atomic commit
creates the frozen `PromotionReceipt`, whose `location` is the actual promoted
location.

Worker-side promotion would produce an ephemeral sandbox path and therefore a
misleading receipt. Giving the worker write access to the public bundle would
also bypass the trusted atomic-promotion boundary. This is a deliberate
trust-boundary exception to the statement that stages 0–12 run in the worker:
the worker may execute stage-12 preparation, but the irreversible public commit
and receipt remain CLI-owned. If import or promotion fails, the prior promoted
bundle remains intact as required by ADR-001 §23.12.

### 5. Sanitize worker-side and independently verify CLI-side

Raw Playwright traces and raw screenshots never leave the sandbox and never
enter either the result volume or the CLI run directory. Capture-time
sanitization uses `@arxic/playwright-trace-sanitizer` and
`@arxic/playwright-screenshot-privacy` worker-side before export.

The CLI independently validates the sanitized action timeline, sanitization
provenance, screenshot-privacy provenance, and corresponding bytes. It also
explicitly runs the bundle text/PII scanner. Today `BundlePromoterAdapter` wires
the trace and screenshot gates but not `scanBundleForSensitiveData`; the worker
implementation must not mistake those gates for complete text scanning.

The existing limitation remains: arbitrary screenshot pixels cannot be proven
mechanically secret-free. Independent human visual review is still a release
gate, with ownership and retention awaiting an owner decision.

### 6. Resume from incremental sealed checkpoints

For each completed stage, the worker writes and fsyncs artifacts first, then
atomically publishes the checkpoint and its manifest. A checkpoint is resumable
only when all declared bytes exist, hashes agree, and the sequence is the latest
complete monotonic prefix for the same run and pinned versions.

After worker restart, the CLI validates that prefix and resumes after it,
losing at most the active stage. This matches ADR-001 §21 and current
orchestrator behavior. A missing, corrupt, incompatible, stale, or over-quota
checkpoint volume causes a clean rerun; partial data is never silently
continued. Human-approval records must be sealed and persisted across restarts,
replacing the current in-memory-only approval storage in
`apps/worker/src/worker-client.ts`.

### 7. Failure modes are terminal or resumable only after validation

The implementation must enumerate and test these fail-closed outcomes:

- result-volume byte or inode quota exhaustion, including trace/screenshot
  growth beyond the present 8 MiB tmpfs assumption;
- OOM, timeout, container death, and partial writes;
- a missing or invalid terminal manifest—never partial success;
- symlinks, path traversal, compression bombs, deeply nested or unbounded JSON,
  non-regular files, and count/byte-limit violations;
- stale or replayed manifests and any run-ID, source, configuration, or digest
  mismatch;
- result import succeeding but CLI-side promotion failing, leaving the prior
  promoted bundle intact under ADR-001 §23.12;
- cleanup failure after a terminal state, reported without changing the
  already-classified result;
- duplicate or resumed stage commits and artifact-hash disagreement;
- nondeterminism from timestamps, absolute sandbox paths, ordering, or newline
  differences that breaks local/worker byte-equivalence; and
- worker image, tool, browser, or orchestrator version drift.

No terminal manifest means no terminal result. Corrupt resumability data falls
back to a clean run, not a guessed continuation.

## Tensions / alternatives considered

### HTTP result service (b)

HTTP offers explicit request/response semantics, retry behavior, and a possible
path to remote workers. It is rejected for M2 because the peer-network model is
unresolved and a listener adds authentication and SSRF surface to an internal
network. HTTP also does not solve binary safety, bounding, canonicalization, or
untrusted-result validation; it merely moves the ingress.

### Stdout as the result channel (c)

Stdout is retained for bounded reporting only. Docker exec's current UTF-8,
trimmed, 4 MiB implementation cannot safely represent arbitrary binary
artifacts and makes truncation or newline normalization part of the protocol.

### Hand-copy `RunState` versus a seam-local wire projection

The consensus pair had a minor divergence over convenience, resolved in favor
of the seam boundary. A seam-local versioned projection respects
`run-spec.ts`'s rule that `RunState` is not part of the stable seam and the
worker translates internal state. Exporting `RunState` couples the CLI to
orchestrator internals; independently hand-copying it creates two drifting
owners. The selected wire forms express only transport semantics and normalize
through one CLI path.

### Worker-side versus CLI-side promotion

Both reviewers independently chose CLI-side promotion. A worker path is
ephemeral and cannot truthfully populate the durable receipt; worker access to
the public destination would collapse the isolation and atomic-promotion trust
boundary.

## Consequences

### Positive

- Control traffic stays bounded while arbitrary sanitized binary artifacts use
  a quota-controlled, integrity-checked channel.
- Frozen contracts and verifier authority remain unchanged.
- Local and worker execution converge through one normalized `RunState` path.
- Atomic promotion and last-known-good preservation remain CLI-controlled.
- Sealed stage prefixes support restart with at most the active stage lost.

### Negative / risk

- Volume lifecycle, quotas, canonical encoding, and import validation add
  substantial implementation and test surface.
- SHA-256 proves byte integrity, not that Chromium genuinely ran or that the
  originating image was trusted.
- Keeping the irreversible commit CLI-side creates an explicit exception to the
  simple statement that all stages run in the worker.
- The current worker image and peer-network premise remain unresolved, so the
  protocol alone cannot complete issue #103.
- Screenshot privacy still includes an irreducible human-review gate.

## Open questions / owner decisions

These choices affect distribution, threat model, trust, retention, or product
semantics and are not engineer-callable during implementation:

1. **Worker image distribution model.** Build an in-repo `Dockerfile` on cold
   start (matching ADR-003's source-only philosophy), use a published
   digest-pinned registry image, or have CI build and tag by `VERSION`? This may
   require an ADR-003 addendum.
2. **Peer networking and `internal: true`.** The target app, Mailpit, and model
   stub currently run on host loopback and are unreachable. Should they become
   per-run sibling containers on the internal network, preserving
   default-deny internet egress, or should an approved relaxation use an
   explicit allowlist proxy? This changes the ADR-001 §16 threat model. Docker
   `--internal` permits container↔container communication and gateway access; it
   is not a hard host barrier.
3. **Trusted-image attestation.** Is the worker image trusted to originate a
   verifier-backed `verified`, or must the result include signed attestation or
   undergo CLI re-verification? SHA-256 alone does not prove Chromium ran.
4. **Result-volume retention, encryption, and quota.** Set byte/inode limits,
   cleanup lifecycle, encryption requirements, and whether sanitized artifacts
   survive a blocked run under the PII-retention policy.
5. **Promotion-ownership split.** Confirm that the final public commit remains
   CLI-side even though stages 0–12 logically execute in the worker.
6. **Human screenshot privacy review.** Name the responsible party and define
   attachment, retention, and deletion policy.

## References

- `docs/adr/001-arxic-architecture.md`: §§2, 9-10, 15-16, 20-21, 23.
- `apps/worker/src/run-spec.ts`: extensible app-local CLI↔worker seam and the
  rule that workers translate internal pipeline state.
- `apps/cli/src/worker-executor.ts`: current fail-closed protocol placeholder
  and known-code/safe-message diagnostic projection.
- `apps/cli/src/executor.ts`: `runResultFromState`, the existing local result
  normalization path.
- `packages/environment/src/docker-cli.ts` and `worker-sandbox.ts`: UTF-8
  process transport, 4 MiB buffer, internal network, read-only source/root, and
  8 MiB tmpfs sandbox constraints.
- LangGraph persistence/checkpointers: thread-scoped durable checkpoints for
  fault tolerance and resumption. `BaseCheckpointSaver` exposes
  `getTuple`/`list`/`put`/`putWrites`/`deleteThread`; `CheckpointTuple` carries
  `config`, `checkpoint`, optional `metadata`, optional `parentConfig`, and
  optional `pendingWrites`. Arxic's `LangGraphOrchestrator` already combines
  `MemorySaver` with a custom `FileStageCheckpointer`; the worker is a separate
  runtime whose checkpoint-export format is this protocol.
  <https://docs.langchain.com/oss/javascript/langgraph/persistence>
- Playwright worker process transport: `WorkerHost`/`ProcessHost` use typed IPC
  for control, stdout/stderr for reporting, and a worker-owned artifacts
  directory for binary output. Semantics copied, not internals; stdout is not
  an artifact protocol.
  <https://github.com/microsoft/playwright/tree/main/packages/playwright/src/runner>
- GitHub Actions outputs/artifacts: structured step output is written through
  `GITHUB_OUTPUT`; arbitrary data is carried as files. `upload-artifact@v4`
  introduced immutable artifacts, and upload/download expose or verify a
  SHA-256 artifact digest. Semantics copied, not internals.
  <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-an-output-parameter>
  and <https://github.com/actions/upload-artifact>.
