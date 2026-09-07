# CFG-452 — fixture provider validation proof

Source base: `bacc2da1`, dirty implementation/test changes in this slice. No human
UI inspection or fixture GUI completion is claimed.

- Red: all three unsupported provider-name cases failed against existing CLI and
  worker policy; the canonical/omitted-provider case passed. Both public boundaries
  were exercised using soft assertions so the CLI failure did not hide the worker.
- Green: 73 tests in four files passed in 4.55 seconds, covering unsupported names,
  malformed values, documented/omitted declarations, existing CLI configuration
  and worker policy, and the real CLI refusal journey.
- Real refusal: the running vulnerable-auth reference app returned its actual
  login page through an ephemeral counting proxy. Each unsupported declaration
  then returned CLI exit 2 without a run directory or target requests. Diagnostics
  named the field and excluded the supplied private canary.
- Compatibility: the existing real CLI pipeline suite passed three tests in
  32.62 seconds against the Next.js reference app, real Chromium and isolated
  Mailpit. The model boundary remains its existing local test endpoint; this is
  not new paid-model evidence.

Commands: `pnpm exec vitest run apps/cli/src/__tests__/fixture-providers.test.ts
apps/cli/src/__tests__/fixture-providers.real-world.test.ts
apps/cli/src/__tests__/config.test.ts apps/worker/src/__tests__/worker-policy.test.ts`
and `pnpm exec vitest run apps/cli/src/__tests__/real-world.test.ts`.

The adjacent text artifacts retain only original test summary/count/timing lines.
Raw process output and exception bodies are not attached. The manifest binds these
selected summaries and the implementation/test bytes. No screenshots were needed
for this configuration-boundary change. The prior full compatibility run predates
only diagnostic de-duplication and malformed-value test additions, not changes to
canonical execution behavior. Current-head CI remains required before integration.

Runtime fixture availability, arbitrary adapter loading, inbox/OTP dashboard setup
and the remaining #402 scope are not established by these tests.

## CI compatibility correction

CI 34081701160 on `feadc452` failed three third-party replay cases because the
allowlist omitted `boot-seeded-admin`, already documented in the quickstart and
configuration guide. This was a production compatibility regression, not a flake.
The unchanged real suite reproduced all three failures locally in 10.33 seconds;
a focused declared-strategy case also failed. Restoring that one documented
strategy makes 76 tests/five files pass in 37.95 seconds, including successful
per-pass login, denied second-origin replay and undeclared endpoint-less refusal.
No replay assertion or fixture configuration was changed. The closed accepted
set was expanded to include the omitted documented strategy; arbitrary names
still fail. The configuration guide's obsolete empty-string acceptance claim
was also corrected.

The initial manifest retains its original hashes; the two superseded source files
are archived from initial review `feadc452`. The follow-up manifest binds current
source and the selected original red/green summary lines. All earlier proof is
historical, not evidence that the first head passed full CI. New final-head CI is
required before integration.
