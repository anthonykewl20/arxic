# ADR-007: Stage-11 healing deferral for 1.0

| Field      | Value                                                                                |
| ---------- | ------------------------------------------------------------------------------------ |
| Status     | Proposed                                                                             |
| Decides    | Whether the pipeline performs bounded stage-11 mechanical healing in the 1.0 release |
| Relates to | ADR-001 §§2, 9, 13.1, 15, 20-23; ADR-004 §6; issue #182                              |
| Owners     | Arxic maintainers                                                                    |

## Context

ADR-001's verification flow sends a mechanical-drift failure to a bounded healing
decision, rejects when no repair budget remains or intent is not preserved, and keeps
runtime contradictions distinct from mechanical drift. It also requires failures to
remain inspectable (`docs/adr/001-arxic-architecture.md:229-267`). The architecture
allows only locator swaps, deterministic readiness fixes, and evidence-aligned route
updates; it forbids skip/fixme/only, assertion weakening, changed business outcomes,
force-click escalation, and unsafe cross-origin behavior (`docs/adr/001-arxic-architecture.md:566-585`).

The current pipeline executes stages 0-12 and names stage 11 `healing`
(`packages/orchestrator-langgraph/src/orchestrator.ts:94-109`). The stage records its
deferred artifact, decision, and diagnostic without attempting repair
(`packages/orchestrator-langgraph/src/orchestrator.ts:327-341`). The only implemented
healing-related control is the Playwright agent proposal policy: it rejects status
directives, deleted or pass-through assertions, origin drift, and destructive or
external-side-effect actions (`packages/playwright-agent-adapter/src/heal-policy.ts:14-43`).
Stage-8 exploration separately records policy-gated, live control observations rather
than attempting repair (`packages/orchestrator-langgraph/src/exploration.ts:97-124`).

ADR-001 places healing clustering in M2, not M1 or 1.0
(`docs/adr/001-arxic-architecture.md:732-737`). Atomic promotion is already designed
to preserve a prior public bundle: it validates private staged bytes, snapshots an
existing public bundle as last-known-good, then renames the staged bytes only after
those checks (`packages/bundle-promoter/src/atomic-store.ts:44-67`).

## Decision

**Defer stage-11 healing for 1.0.** This ADR is Proposed until the designated consensus
review accepts or rejects the decision.

### 1. Recorded no-op, not a silent gap

Stage 11 remains a completed `deferred` stage. It now records the stable,
contract-validated `ARXIC-ORCH-HEALING-DEFERRED` diagnostic with `observed` severity,
subject `stage-11`, and the message that no repair was attempted
(`packages/orchestrator-langgraph/src/orchestrator.ts:327-341`). The diagnostic is
registered through `orchDiagnostic`, which validates every emission with
`validateDiagnostic` from `@arxic/contracts`
(`packages/orchestrator-langgraph/src/diagnostics.ts:1-36`). The exported-code contract
gate iterates that registry through the same validator
(`packages/orchestrator-langgraph/src/__tests__/contract-gate.test.ts:1-14`).

The diagnostic is informational: it records the release capability boundary without
changing a run's truth state or promotion eligibility.

### 2. 1.0 no-healing failure behavior

For a verification failure classified as mechanical drift, 1.0 performs no retry or
repair in stage 11. The verifier's `contradicted` outcome is retained by the run-state
outcome reducer (`packages/orchestrator-langgraph/src/orchestrator.ts:1238-1250`), and
stage 12 skips promotion unless stage 10 produced a `verified` staged bundle
(`packages/orchestrator-langgraph/src/orchestrator.ts:842-857`). Therefore the candidate
is rejected, remains unverified, and cannot replace an existing promoted bundle. The
existing atomic promotion boundary preserves the prior bundle if a prior publication
exists; no healing path may rewrite it.

This is deliberately conservative. A false failure from locator or readiness drift is
visible as a contradicted/rejected candidate rather than silently converted into a
passing test. A missing fixture remains `blocked`; a runtime contradiction remains
`contradicted`; nondeterminism remains outside healing's scope. Only the deterministic
verifier can ever assign `verified` under ADR-001 §2.

### 3. What SHIP would require

A future proposal to ship healing must be an implementation plan, not an activation of
the present agent policy. At minimum it must provide:

1. A bounded stage-11 Action that permits only ADR-001 §13.1's locator swaps,
   deterministic readiness fixes, and evidence-aligned route updates; each candidate
   must preserve the intended business outcome and carry a semantic diff plus recorded
   policy approval.
2. Sad-path-first coverage for rejected proposal classes: status directives,
   assertion deletion or weakening, outcome changes, force-click escalation, origin
   drift, unsafe action classes, ambiguous locators, readiness changes that mask a
   timeout, stale evidence, exhausted heal budgets, and a repair that still fails
   deterministic replay.
3. A reject-weakening policy gate at the healing boundary. The existing
   `evaluateHealProposal` policy is useful input but is lexical/structural, not a
   semantic-equivalence proof (`packages/playwright-agent-adapter/README.md:35-39`);
   shipping must not treat its acceptance as sufficient proof.
4. Real fixture-app, clean-reset evidence that an allowed repair is replayable and
   that every forbidden change is rejected, with the normal two-run verification and
   atomic-promotion preservation sad path.

## Consequences

### Positive

- 1.0 has an explicit, inspectable capability boundary rather than a silent stage gap.
- Mechanical drift cannot weaken assertions or manufacture a passing bundle.
- Existing `contradicted`/`blocked` classifications and last-known-good publication
  semantics remain unchanged.
- Reviewers can challenge the deferral against concrete prerequisites rather than an
  unspecified future healer.

### Negative / risk

- Harmless locator, route, or readiness drift can leave a useful candidate rejected
  until an operator or a later bounded-healing implementation updates it.
- The observed stage-11 diagnostic means healing is unavailable; it does not explain a
  stage-10 failure. Users must inspect the verifier diagnostic as well.
- The current policy does not prove semantic equivalence, so it cannot safely be wired
  into automatic repair without the future evidence and replay gates above.

## References

- `docs/adr/001-arxic-architecture.md`: §§2, 9, 13.1, 20-23.
- `docs/engineering-charter.md`: §§1-4, 6; Action-owned classification and sad-path-first proof.
- `packages/orchestrator-langgraph/src/orchestrator.ts`: stage ordering, stage-11 record,
  truth-state retention, and promotion gate.
- `packages/orchestrator-langgraph/src/diagnostics.ts`: frozen-diagnostic loop closure.
- `packages/playwright-agent-adapter/src/heal-policy.ts`: existing proposal rejection policy.
- `packages/bundle-promoter/src/atomic-store.ts`: last-known-good atomic replacement.
