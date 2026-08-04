# Arxic Engineering Charter

> Canonical engineering rules. Every slice (issue → PR) follows this. Source of truth for *how* we build; `docs/adr/001-arxic-architecture.md` is the architecture record for *what* we build.
>
> This charter aligns Arxic with two upstream engineering skills:
> - TDD — <https://github.com/mattpocock/skills/tree/main/skills/engineering/tdd>
> - Code structure (Actions vs Service) — <https://github.com/michaelshimeles/skills/blob/main/code-structure/SKILL.md>

---

## 1. Two-layer architecture (code-structure)

Arxic separates **orchestration (actions)** from **operational mechanics (services)**. This is not optional.

| Layer | Owns | In Arxic |
|---|---|---|
| **Actions / orchestration** | the *why/when*: business rules, state transitions, auth/ownership + policy checks, **failure classification**, user-facing errors | `packages/orchestrator-langgraph` (RunState + pipeline stages 0–12, §8.1/§9), `packages/reconciler` (dispositions), `packages/verifier` (gate decision), `packages/bundle-promoter` (promotion policy) |
| **Service / capability blocks** | the *how*: reusable operational mechanics, provider/SDK interactions, readiness, retries — returning **structured results** | the §10.5 adapters: `SourceIndexer`, `SurfaceDiscoverer`, `FixtureProvider`, `WorkflowPlanner`, `WorkflowCompiler`, `WorkflowVerifier`, `BundlePromoter` (+ `EnvironmentAdapter`, `ModelAdapter`, `PersonaProvisioner`, `InboxAdapter`, `OtpAdapter`) |

`verifier` and `bundle-promoter` are orchestration components because they own
the promotion/verification **DECISION**; their `WorkflowVerifier` and
`BundlePromoter` interfaces are service capability blocks.

**Rules:**
- Design service functions as **composable capability blocks** with explicit params and structured returns (e.g. `{ ready, previewUrl }`), never a god-method. This is exactly the §10.5 contract shape: adapters return contracts, not upstream types.
- **Actions own failure classification.** A service returns a structured result; the orchestrator maps it to a truth state (§2). Services never mutate domain state directly.
- **Don't pre-extract.** Write the flow in orchestration first; extract to a service only when ≥2 callers repeat the same non-domain mechanics. Single-caller "abstraction" is an anti-pattern.
- Migration: extract one block → replace one caller → verify → migrate the rest. Never a big-bang refactor.

---

## 2. Truth states are the failure-classification contract (ADR §2)

Every observable outcome — especially every *sad path* — must resolve to one of five documented dispositions. An LLM may create hypotheses but **may never assign `verified`** (only the deterministic verifier can).

| State | Means | Assigned by |
|---|---|---|
| hypothesized | suggested by source/docs/model, not observed | static analyzers / model |
| observed | runtime surface seen, outcome not fully proved | runtime collector |
| **verified** | preconditions+actions+assertions+expected transition passed in a replayable run | deterministic verifier |
| **contradicted** | runtime disproved the candidate, or source evidence conflicts | reconciler / verifier |
| **blocked** | could not safely proceed (fixture/account/flag/env/approval missing) | orchestrator / verifier |

If a sad path cannot be mapped to one of these, the design is incomplete — fix the design before writing code.

---

## 3. TDD loop (red → green, vertical slices)

The loop is **red → green**, one vertical slice at a time. Refactoring is a separate review step, not part of the loop.

- **Red before green.** Write the failing test first; write only enough code to pass it. No speculative features, no anticipated future tests.
- **One slice per cycle:** one seam, one test, one minimal implementation. Each test is a tracer bullet that informs the next.
- **Vertical, not horizontal.** Never write all tests up-front then all implementation — that tests imagined shape, not behavior.
- **Test at pre-agreed seams only.** Before writing tests for a slice, list the seams and confirm them. Arxic's default seams (§5). No test against internals.
- **Tests verify behavior through public interfaces** and read like a spec ("`verified` is rejected when a required transition is only hypothesized"). They survive refactors because they don't care about internals.

**Anti-patterns we reject:**
- *Implementation-coupled* — mocking internal collaborators, testing private methods, asserting call counts/order, verifying through a side channel. Tell-tale: breaks on refactor with no behavior change.
- *Tautological* — the expected value is recomputed the way the code computes it, so it can never fail. Expected values must come from an independent source of truth (a known literal, a worked example, the spec/ADR).
- *Horizontal slicing* — bulk imagined tests.

**Mocking:** mock at **system boundaries only** (external APIs, the browser, Mailpit/OTP/IdP providers, the filesystem, time/randomness, the model endpoint). Never mock Arxic's own modules or internal collaborators. At boundaries, design SDK-style interfaces (one specific function per operation) so each fake returns one shape.

---

## 4. Sad-path-first discipline (mandatory)

Happy path is the last test written, not the first. **Every slice must enumerate its sad paths and edge cases as red-first scenarios before any happy-path test.** "Cover all sad paths, not just happy path."

For each sad path, write down:
1. the **trigger** (the hostile/malformed/missing/edge input or event);
2. the **expected disposition** (truth state from §2 — usually `contradicted`, `blocked`, or a fail-closed rejection);
3. the **failing test** that proves the system reaches that disposition.

If a slice's design has no sad paths, you haven't found them yet. Re-read ADR §16 (security), §24 (risks), §13.1 (forbidden healing), §15 (gates).

### Per-slice sad-path catalog (selection — see ADR §16/§24 for the full set)

- **Contracts** (#2–#6): malformed/missing fields → AJV rejects with *stable* diagnostic; source `EvidenceRef` with commit/path/range/blob-sha mismatch → reject; uncommitted/dirty bytes → no blob link manufactured, labeled uncommitted; workflow transition missing assertions → reject; `status:verified` with any hypothesized-only transition → **reject** (LLM may not assign verified); runtime evidence violating network/console policy → flagged. Tautology guard: validator must reject a self-derived/constant-asserted expected value.
- **Source indexer (UA)** (#8): unsupported language → emitted as gap, not parsed (never invent facts); dirty tree → content manifest, no uncommitted blob links; binary/huge file → skipped+diagnosed, bounded; parse error/partial Tree-sitter → retain diagnostic, no crash; **non-determinism** → re-run byte-identical pre-timestamp (property test); missing/shallow commit → fail closed.
- **ast-grep rules** (#9): false positive (conventional route name with no handler/guard) → must **not** claim a feature (ADR §12.1); unsupported syntax (decorators/JSX/composition) → labeled fallback diagnostic, never primary evidence; rule version conflict → deterministic resolution; **negative fixtures must fail** the rule.
- **PlaywrightAgentAdapter** (#10): required tool missing in handshake → **fail closed**; capability/schema drift on upgrade → fail closed (contract test); healer proposes `skip`/`fixme`/`only`/assertion-weakening/quarantine or crosses origin/action boundary → **rejected** by policy; shell-injection in process start → no interpolation, error; agent unavailable → fallback generator still yields a runnable spec.
- **Promotion** (#11): mid-promotion crash → last-known-good intact; post-freeze hash mismatch → blocked; validation failure → no public replace; concurrent promotion → serialized, no corruption; receipt SHA-256 + byte-count verify.
- **Target attestation** (#12): production-looking target → **refused by default**; missing nonce/unsigned receipt → refused; origin not allow-listed → refused; override without recorded human approval → refused (LLM cannot approve); attested local/test/preview target → passes.
- **Crawlee breadth** (#16): link to external origin → not followed; destructive form → not submitted without approved policy; frontier blowup → bounded by `maxUrls`/`maxDepth`, terminates safely; two workflows sharing a mutable persona → serialized; transient nav failure → retry then bounded give-up (observed, **not** verified).
- **Compiler** (#20): unsupported/invalid step → remains uncompiled (not silently dropped); `waitForTimeout`/arbitrary `waitForLoadState`/`page.evaluate` → policy rejects; CSS/XPath locator without a diagnostic → reject; secret/PII in generated code → reject.
- **Verifier** (#21): 1 pass + 1 fail → **flaky, not verified**; assertion fails because the app is broken → **contradicted**, not "fixed"; missing fixture → **blocked**; network/console error → policy-gated (`forbidNetworkErrors`); required screenshot/trace missing or hash mismatch → fail; nondeterministic result → flaky.
- **Fixtures** (#19): missing required adapter → workflow **blocked**, never faked; lease not released (leakage) → detected + reset; secret in fixture value → redacted; Mailpit message missing/ambiguous → not fabricated; persona provisioning via unknown-prod DB → forbidden.
- **Worker** (#26): cross-job read attempt → denied; outbound egress → default-denied; quota exceed (CPU/mem/process/file/time/frontier/artifact) → enforced, terminates; prompt-injection payload in repo/page/email → treated as data, no policy/origin/action change.
- **Orchestrator** (#17): worker restart mid-stage → resume from checkpoint, lose ≤ the active stage; model structured-output failure → retry then **no promotion**; a stage yields zero candidates → completed with empty coverage, not an error.
- **Reconciler / coverage** (#18, #23): conflicting evidence → **contradicted** diagnostic; high accountability + low verified → reported honestly, not hidden; denominator frozen — a candidate discovered after freeze → new manifest, no history rewrite.

---

## 5. Arxic's pre-agreed seams (default)

Confirm per-slice before testing. Add seams only via this charter.

1. **Contract validators** — AJV strict validators over pinned JSON Schemas (independent expected values from ADR §10 examples; never self-derived).
2. **Adapter contracts** — each §10.5 interface tested with a **fake of the system boundary** (real schema, fake provider). Upstream engines (Playwright/Crawlee/Mailpit/otp/model) are faked at their boundary; Arxic internals are never mocked.
3. **Policy engine** — the action layer's authorization + action-class decisions (§16.3/§16.4) tested directly; this is where fail-closed lives.
4. **Verifier gate** — the deterministic verified/contradicted/blocked/flaky classification (§2/§15) tested with scripted run artifacts.
5. **Promotion atomicity** — last-known-good preservation tested with injected mid-promotion failures.
6. **End-to-end vertical** — one full candidate → bundle, against the reference fixture apps using the **real** engines (real Chromium / real `sg` CLI / real containers) — this is the dogfooded proof, §6.

---

## 6. Real-world proof (non-synthetic) — Arxic eats its own dog food

Arxic's product IS real-world, replayable, deterministic tests (ADR §15/§23). A slice proven only with synthetic mocks proves nothing Arxic can sell. **Every slice's "Done" requires a real user-level test: the actual engine/library/container/app executing against the real reference surface.** Synthetic unit tests may accompany a slice for speed/precision, but can never replace the real one.

**Synthetic — banned as the sole proof:** mocks/stubs of Arxic's *own* modules, or of the engine under test, that simulate behavior we wish were true. "It works on my mock" — a test that passes because the fake was told to pass — is a banned anti-pattern (the TDD *tautological* smell generalized to integration).

**Real — required:** the actual engine executing.
- Contracts → real AJV strict validation of the **real ADR §10 examples** (independent expected values), not hand-rolled echoes.
- Source indexer → real Tree-sitter parsing of the **real reference apps'** source.
- ast-grep → the **real `sg` CLI** scanning the real reference apps.
- Playwright adapter / compiler / verifier → **real Chromium** driving the real reference apps.
- Crawlee → **real PlaywrightCrawler** against the real reference apps, within real budgets.
- Fixtures → **real Mailpit container + real otplib + real persona seed path**; missing → `blocked`, never a mocked success.
- Promotion → real staged bytes, real SHA-256, real atomic replace with a real injected failure.

**Canonical real surface:** `test-fixtures/vulnerable-auth-app` + `test-fixtures/reference-auth-app` (#13). These must exist before any later slice can claim real-world proof — **hard dependency: spikes #8–#12 and every M1 slice prove themselves against these apps with the real engines.**

**Acceptance standard** (dogfooded, mirrors ADR §15/§23): deterministic, replayable from clean fixture state; two consecutive clean passes for anything claiming `verified`. Because that is exactly the standard Arxic imposes on the workflows it generates, Arxic must meet it for itself.

## 7. Slice → PR contract

Every issue/PR must contain:
- **Seams under test** (from §5) — agreed before tests.
- **Sad paths & edge cases (TDD red-first)** — enumerated first, each mapped to a §2 disposition.
- **Real-world proof** (§6) — at least one non-synthetic user-level test against the real reference apps + real engines. Synthetic-only is a **blocker**, not "Done."
- **Happy path** — last.
- **Layering note** — which logic is orchestration (actions) vs which capability block (service), and why no premature extraction.
- **Gates** — `pnpm typecheck`, `pnpm lint`, `pnpm -r test` green; license gate (#7) green; no skip/fixme/only/weakened assertions (ADR §13.1).

A PR that only proves the happy path, or only proves it on mocks, does not meet "Done."

## 8. Slice completion ritual (MANDATORY — enforced on every slice, every time)

A slice is **not** "Done" when the code works. It is "Done" only after this ritual is completed *and pushed*. This is what keeps the docs from going stale. Run every step, in order:

1. **Gates green.** `pnpm typecheck`, `pnpm lint`, `pnpm -r test` all pass; license gate (#7) green; no skip/fixme/only/weakened assertions (ADR §13.1).
2. **Real-world proof present.** At least one non-synthetic user-level test against the real reference apps + real engines (§6). If missing → not Done.
3. **Sync the docs — never leave a doc describing the old state.**
   - `docs/SYNC.md`: flip this slice's tracker checkbox; move 🔖 **RESUME HERE** to the next slice; add a one-line session-log entry (what shipped + disposition: verified / contradicted / blocked).
   - **`CHANGELOG.md` — ALWAYS updated, every slice, no exceptions.** Add an entry under `## [Unreleased]` using [Keep a Changelog](https://keepachangelog.com/) verbs (`added`/`changed`/`deprecated`/`removed`/`fixed`/`security`, plus `internal` for non-user-facing work). If the change is user-observable, that determines the next bump (see `RELEASES.md`).
   - **Version:** if the change is user-observable, bump per `RELEASES.md` — `VERSION` + root `package.json` `version` MUST stay identical (single source of truth = `VERSION`). During pre-1.0 (`0.x.y`), milestone exits are minor bumps (0.1.0 = M0-EXIT #14, 0.2.0 = M1-EXIT #27), fixes are patch.
    - `docs/adr/001-arxic-architecture.md` (or a new ADR under `docs/adr/`): if a *decision* changed, add a dated addendum. Never silently edit the frozen §10 contracts — they change only via a new ADR.
    - `docs/engineering-charter.md`: if the process/method changed, update it.
    - Affected `packages/*/README.md`, `schemas/*`, `rulepacks/*` versions.
4. **Staleness sweep.** `rg -n "<slice id, e.g. M0-03>" <issue number> TODO FIXME` across the repo; resolve or document every hit. No doc may still describe this work as pending/planned.
5. **Close the loop on GitHub.** Link the PR to the issue; post a completion comment with the dispositions + evidence/artifact pointers; close the issue.
6. **Commit the doc updates with the code** (or an immediate follow-up on the same branch) and merge to `main` via PR. If it isn't merged to `main`, it isn't saved.
7. **Final verify (disk + remote).** Checkbox flipped, RESUME HERE moved, issue closed, `main` green.

**Banned anti-patterns:** "I'll update SYNC later"; merging code without the doc sync; merging a slice without a `CHANGELOG.md` entry; **`VERSION` and `package.json` `version` disagreeing**; closing an issue whose docs still say "todo"; leaving a TODO a future agent must rediscover.

> **Agent rule (hard):** if you are completing a slice, steps 3–6 are non-negotiable *even if the code already works*. Stale docs are a defect.
