# DG-08 evidence — model-driven candidates end-to-end

Real-engine proof artifacts for DG-08 (#252), produced by the repo's real
suites (no synthetic mocks at the system boundary):

- The **CLI real-world E2E** (`apps/cli/src/__tests__/real-world.test.ts`)
  boots the REAL reference app (Next.js), a REAL Mailpit Testcontainer (own
  container, random ports), and a REAL local OpenAI-compatible model stub that
  derives its proposal from the REAL inventory rows the pipeline sends as
  data. A NON-auth proposal (`account-recovery` on `/forgot-password`, id
  `prop:<sha16>` — never `authentication.login`) flows: stage-13 inventory →
  stage-4 IntentProposer → stage-8 policy-gated form-drive under a persona
  lease (real Chromium navigate → fill → submit) → post-action observation →
  DG-09 form-flow compile (assertions `url:/forgot-password` +
  `text:Forgot password` bound from OBSERVATION, never canned) → real
  Playwright verifier: **2 clean runs → `verified` → promoted bundle**, twice
  consecutively. Reproduce: `pnpm vitest run apps/cli/src/__tests__/real-world.test.ts`.
- The **domain-literal gate** (`packages/orchestrator-langgraph/src/__tests__/domain-literal-gate.test.ts`
  - `apps/cli/src/__tests__/domain-literal-gate.test.ts`) machine-enforces
    ADR-008 Decision 3 in CI: no authentication-domain literals in
    `packages/orchestrator-langgraph/src` or `apps/cli/src` non-test source.
- The **IntentProposer sad-path suite** (`packages/orchestrator-langgraph/src/__tests__/intent-proposer.test.ts`)
  proves over a REAL local OpenAI-compatible endpoint: malformed → bounded
  retry → blocked (fail-closed per run, zero candidates); injection in model
  output → blocked as content-is-data; dangling inventory/evidence citations →
  rejected (honest ledger); honest zero for empty proposals; budget cap blocks
  BEFORE any provider call (zero requests); seeder proposals merge through the
  SAME gates (never override); no truth-state field anywhere.
- The **worker real-Docker E2E** (`apps/cli/src/__tests__/worker-real-world.test.ts`, remediation round): the worker mirror of the canned gate is gone — a NON-auth stub proposal (`sessions` on the real `POST /login` inventory row of the vulnerable Express app, derived from the INVENTORY_DATA the worker sends as data) runs stage-13 inventory → IntentProposer → policy-gated form drive (persona lease; form-scoped fills) → observation → DG-09 compile → **verified 2× in real Chromium inside the sandbox → promoted**, with all #26 isolation invariants re-proven and the promoted bundle asserted to be the model's `prop:<sha16>` workflow with observation-bound assertions.
- The **domain-literal gates** now cover orchestrator + CLI + **worker** non-test source, with an extended vocabulary (signin/signup/register/registration/reset word-shape patterns) and genuine RED-PROOF controls (planted literals in a temp scanned tree are flagged).
- The **demoted auth seeder** (`packages/auth-domain-pack/src/seeder.test.ts`):
  honest-zero without matching rows, deterministic, fixture kinds declared,
  grounding verifiable.
