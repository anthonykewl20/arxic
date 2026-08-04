# @arxic/policy-engine

`@arxic/policy-engine` is the pure, fail-closed authorization boundary for M0-14. It performs no filesystem or network IO. `authorize(input: PolicyAuthorization): PolicyDecision` accepts one complete authorization input and returns an allow or deny decision, truth state, reason, diagnostics, and policy snapshot.

## Closed action registry

`ACTION_REGISTRY` is frozen and contains exactly six actions mapped to the frozen `ActionClass` imported from `@arxic/contracts`:

- `navigation` → `read-only`
- `form-submit` → `reversible-mutation`
- `fixture-change` → `reversible-mutation`
- `file-write` → `external-side-effect`
- `promotion` → `destructive`
- `delete-user` → `destructive`

Unknown actions fail closed. A missing or caller-asserted `actionClass` that does not match the registry fails closed with an invariant-violation denial. Every action also requires its exact origin in `allowedOrigins`.

## Class gates

- `read-only` requires a caller-owned budget with `remaining > 0`.
- `reversible-mutation` requires a present, non-`inUse`, parseable, unexpired lease. An optional budget denies when exhausted.
- `external-side-effect` requires `sandboxAdapterPresent === true` and a valid recorded approval at `approvalKey(action, origin)`. An optional budget denies when exhausted.
- `destructive` requires an allowlisted origin and a valid recorded approval at `approvalKey(action, origin)`. It is not budget-gated.

A `HumanApproval` has non-empty `approver`, `approvedAt`, and `reason` strings. Invalid records are treated as missing. `approvalKey(action, origin)` returns the stable `${action}:${origin}` convention used for both external and destructive lookups.

## PolicyEngine

`new PolicyEngine(config).decide(request)` offers a configured interface. The engine merges `allowedOrigins`, optional `policyVersion`, and optional `sandboxAdapterPresent` from `PolicyEngineConfig` into a full `PolicyAuthorization`, then delegates to `authorize`. Neither config nor request data is mutated.

## Leases and budgets

`LeaseState` contains `id`, `owner`, `expiresAt`, and `inUse`. `detectCollision(leases)` is pure and returns the first lease whose `inUse` value is true, or `null`. The package has no mutable lease store, acquisition, or release API.

`BudgetState` contains caller-owned `remaining` capacity. Authorization only reads it and never decrements or otherwise mutates it.

## Snapshots

Every decision includes a `PolicySnapshot` with `policyVersion`, `inputSha256`, `decision`, and `timestamp`. The SHA-256 covers canonical JSON for the full `PolicyAuthorization`: object keys and approval keys are ordered, and `allowedOrigins` is sorted and deduplicated. Identical inputs produce identical hashes; only the output timestamp varies. `authorize` resolves an omitted version to `ARXIC_POLICY_VERSION` and obtains timestamps with `new Date().toISOString()`.

`computePolicySnapshot(input, decision, policyVersion, now)` exposes the same pure snapshot mechanic with an explicit timestamp provider.

## Diagnostics

`POLICY_DIAGNOSTIC_CODES` enumerates the stable `ARXIC-POLICY-*` codes. `policyDiagnostic` manufactures blocked diagnostics and validates each through the frozen `@arxic/contracts` diagnostic validator. `isPolicyDiagnosticCode` checks membership in the policy code set.
