# ADR-002: Evidence reference resolution — opaque IDs via `evidence/index.json`

| Field      | Value                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | Accepted (2026-08-04)                                                                                                                           |
| Decides    | How Workflow IR `evidenceRefs` (ADR-001 §10.3) resolve to structured `EvidenceRef` objects (ADR-001 §10.2); and "required transition" semantics |
| Relates to | ADR-001 §10.2, §10.3, §11, §15 (Evidence gate); issues #2, #3                                                                                   |
| Owners     | Arxic maintainers                                                                                                                               |

## Context

ADR-001 §10.2 defines `EvidenceRef` as a structured discriminated union
(`source | runtime | document`). §10.3's Workflow IR references evidence via
opaque strings (e.g. `"src:forgot-link"`) with **no defined resolution mechanism**.
Verification (§15 Evidence gate) hinges on "every required transition has runtime
evidence," yet "required" was undefined. Freezing the contracts (#2/#3) without
resolving these ambiguities would bake them into the canonical types.

## Decision

**Workflow `evidenceRefs` are opaque IDs, not inline objects.** Each ID resolves
through a bundle/run-local `evidence/index.json` map of `{ id -> EvidenceRef }`.

- **ID grammar:** `<kind>:<subject>[:<qualifier>]`, where `kind ∈ { src, run, doc }`.
  Examples: `src:forgot-link`, `run:reset-submit`, `doc:spec#4.2`.
- IDs are **stable within a run/bundle**; the index is the single source of truth
  binding an ID to a full structured `EvidenceRef` (`commit`/`path`/`range`/
  `blobSha256` for source; `runId`/`browser`/`url`/artifacts for runtime;
  `artifactRef`/`sha256` for document).
- The Workflow IR stays compact and human-readable (intent text + ID refs); full
  provenance lives in the index, not inline in every transition.

## "Required transition" semantics

A transition is **required by default**. A transition may be marked optional
(`"required": false`) only when it is an explicitly documented alternate/edge
path that is non-blocking to the workflow's outcome. The Evidence gate (§15)
requires runtime evidence for every **required** transition; an optional
transition lacking runtime evidence does not block promotion but is reported in
the coverage matrix (§11).

## SourceRevision (ADR-001 §10.1)

`SourceRevision` is frozen as a JSON schema in issue #2 alongside `EvidenceRef`,
encoding the §10.1 rules: dirty working trees produce a content manifest with no
manufactured blob links for uncommitted bytes; submodules record their own commit.

## Consequences

- The Evidence gate validates that every required transition's referenced IDs
  **resolve** in `evidence/index.json` and carry runtime evidence.
- `EvidenceRef` + the index shape freeze in #2; the Workflow IR + `required`
  semantics freeze in #3. Either change after freeze requires a new ADR.
