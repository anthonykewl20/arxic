# ADR-008: Domain-general business-intent extraction (ALL domains)

| Field      | Value                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | Accepted (2026-09-05) — all six DG-12 exit criteria passed by script on both ratified apps (directus, koel); see "Acceptance proof (2026-09-05)" below. |
| Decides    | The architecture by which Arxic extracts and verifies ALL business-intent domains of any project, not only authentication                               |
| Relates to | ADR-001 §2/§8/§9/§10/§12/§16, ADR-002, ADR-004, ADR-006, issues #244–#256 (ALL-Domain Business Intent Extraction milestone)                             |
| Owners     | Arxic maintainers                                                                                                                                       |

## Context

Arxic exists to accurately extract the business intent of a codebase and prove
that intent with verified tests. The product promise is not a narrow
authentication-workflow generator: it is evidence-grounded understanding of a
project's user-facing behavior.

Issues #244–#256 form the ALL-Domain Business Intent Extraction milestone,
which is version-neutral by owner directive: the project stays on the v0.1.x
lane and the release version is decided at release time.

The 2026-08-16 third-party campaign measured the gap between that purpose and
the present product. It ran the packed 0.1.1 CLI against a real private
third-party monorepo (Laravel 13 backend + Next.js 16 frontend, ~340 API
endpoints, ~311k LOC), live-booted with a seeded user. The campaign made 14 CLI
invocations across baseline, stub-model, sad-path, and adversarial series.

The campaign found a domain funnel. Stage-4 inference hardcodes
authentication. Candidates map to fixed domains, states, and a persona. The
CLI promotion path replaces model output with a canned `authentication.login`
candidate when `scope.domains` includes authentication. One of roughly 20
domains was reachable, and none of the approximately 340 endpoints' business
intent was extracted.

The campaign also found a language funnel. TypeScript/JavaScript-only scanning
emitted 3,248 `ARXIC-SOURCE-UNSUPPORTED-LANGUAGE` diagnostics for 1,128 PHP
files. All backend business logic was therefore invisible to extraction.

The framework funnel was equally material. Rulepack version ranges such as
`>=15 <16` are inert metadata because matching is by name only. Next 16.2.6
was silently accepted despite the declared range.

The single supported workflow failed on first real contact. Its canned
post-login `url:/` assertion contradicted the application's redirect to its
dashboard. Failed runs then purged failure evidence and masked the classification
behind `ARXIC-VERIFY-ARTIFACT-MISSING`. These are recorded as defects #257 and
#258.

The campaign also found that attestation `buildDigest` is unverified metadata
(#259). That defect is distinct from extraction, but matters to the provenance
on which this decision relies.

The campaign also demonstrated that the trust spine works on a third-party
application. Attestation handshake, honest-zero behavior with no fabricated
intents, byte-stable repeat runs, the dirty-tree provenance guard, the
fail-closed model path (bounded retry then blocked), and developer-grade config
validation all behaved correctly.

Accordingly, this ADR does not replace the trust spine. The extraction
capability is the gap. The intended result is a complete, inspectable inventory
of business intent, including where Arxic could not safely extract or replay it.

Prior art already exists in the repository. ADR-004's Accepted IntentSpec and
oracle-provenance design is an unwired internal seam: it is absent from the CLI
and promoted bundle. Coverage-matrix machinery is auth-shaped and internal.
The rulepack adapter name-matches frameworks while treating versions as inert
metadata.

ADR-001 remains controlling for truth states, evidence, pipeline ownership,
frozen contracts, and hostile-content handling. In particular, source and model
output remain hypotheses, runtime collection remains observed, and only the
deterministic verifier may assign `verified`.

## Decision

### 1. The product artifact is the Intent Ledger

The product artifact is an Intent Ledger: a per-application, complete,
evidence-grounded inventory of business intents. It is the deliverable for
"ALL business intents," while workflow bundles remain the vehicle for the
verified, replayable subset.

Each ledger row records its domain; surface (route, page, or endpoint); action;
oracle provenance using ADR-004 kinds; source `EvidenceRef`s; runtime
observations; truth state; and replay status. The promoted bundle contains the
ledger, hash-covered and redaction-gated. A new read-only `arxic intents`
command exposes it (#251).

This separates inventory completeness from replayability. A project can be
honestly complete in its accounting even when safety, missing support, or
non-determinism prevents a particular intent from becoming a browser workflow.

### 2. Completeness is by construction through the Domain Inventory

A new deterministic Domain Inventory stage fuses source route, page, and
endpoint enumeration from every installed language pack with the runtime crawl
surface map. It produces one deduplicated denominator.

Every inventory row MUST have an explicit final disposition:

- `extracted`;
- `unsupported`;
- `unsafe`; or
- `unextracted-with-reason`.

No row may disappear silently. Coverage gates consume this inventory, and
empty-coverage semantics derive from it rather than from an auth-specific
candidate collection. DG-02 and DG-06 are tracked by #246 and #250.

The denominator is deliberately broader than the verified subset. This makes a
zero result accountable: it means every discovered surface was classified, not
that an unobservable filter happened to produce no candidates.

Domain clustering over inventory rows is an **advisory prioritization
heuristic, not a domain partition**. Measured on koel by DG-02
(`docs/spikes/dg-02-domain-inventory.md` §5.1): 43 deterministic clusters, of
which only ~9–13 carry real domain signal, while 18 are utility/action
singletons — first-static-segment labeling artifacts, not bounded contexts.
Clustering may order work (per-domain batching in DG-04/DG-08, extraction
prioritization) but MUST NOT define row membership, coverage, completeness, or
any product surface. The ledger always exposes raw inventory rows regardless of
clustering, so a weak grouping can neither hide the denominator nor manufacture
a result.

### 3. Domain generality forbids domain literals in pipeline code

Authentication becomes one domain pack among many. Pipeline code MUST NOT
contain domain literals that decide candidate creation, state names, personas,
or promotion behavior.

The authentication domain pack is demoted to an optional seeder or advisor.
Its pre-verified outcomes must pass the same source, runtime, oracle, policy,
and verification gates as every model proposal. Stage 4 becomes an
`IntentProposer` over Domain Inventory rows (#252).

This retains reusable domain knowledge without making authentication the
unacknowledged product boundary. It also makes a domain pack advisory rather
than a source of privileged truth.

### 4. Model-driven proposals are the default path; templates only seed

The CLI output-replacement gate is removed. Model output drives compilation
directly after normal evidence and policy gates; it is never replaced by a
canned authentication candidate.

Templates may seed or advise proposals, but cannot override them. With no model
configured, honest-zero behavior remains unchanged: Arxic reports no fabricated
intent and retains inventory dispositions rather than inventing candidates.

This decision is implemented in DG-08 (#252). It preserves the existing
bounded-retry then blocked failure behavior for malformed model output.

DG-04 measured the batching cost profile on directus (272 inventory rows,
gpt-4o-mini — `docs/spikes/dg-04-model-proposal.md` §5.3): **per-domain
grounded proposals with bounded concurrency are the production path**; a
one-shot single call is **forbidden as the proposal path**. Measured: one-shot
covered 10/272 rows at $0.0034 in one ~10 s call, while per-domain covered
226/272 rows (83.1%) at $0.0202 and 333 s sequential (80 independent calls —
embarrassingly parallel; measured max call ~12 s bounds concurrent latency).
One-shot output was schema-valid but summarized the inventory into 10 umbrella
proposals: grounding collapses ~22×. One-shot remains permissible only as a
cheap domain-summarization pre-pass, never as the proposal path.

Budget: the owner MUST set the per-app model budget (owner-gated under DG-11,
#255). Until then the provisional default is the measured **~$0.025 per ~340-row
application** per full run (provisional, owner-overridable; linear in rows, and
a frontier-priced model at ~30× gpt-4o-mini stays under $1 per run); since
DG-08 (#252) landed it is enforced pre-call via `ARXIC_MODEL_BUDGET_USD`
(default `0.0253`, `docs/configuration.md`).

### 5. Language breadth uses a Language Pack SPI behind SourceIndexer

Reuse upstream before writing parsers. Understand-Anything already provides the
broad language surface: its main tree was source-level verified on 2026-08-16 to
contain 13 dedicated language extractors (`cpp`, `csharp`, `dart`, `go`, `java`,
`kotlin`, `php`, `python`, `ruby`, `rust`, `scala`, `swift`, and `typescript`)
and 15 grammar-bearing code-language configurations in its registry (the DG-01
source-level census at upstream main `32944829` corrected the earlier figure of
16: `lua` registers without a `treeSitter` grammar —
`docs/spikes/dg-01-language-pack-spi.md` §1.2). Arxic's TypeScript/JavaScript-
only limit is its own policy pin in
`packages/source-ua-adapter/src/policy.ts`, inherited from the M0-07
subset-extraction scope; it is not an upstream limitation.

The Language Pack SPI therefore re-exposes that upstream language surface through
the frozen `SourceIndexer` seam. The reuse mechanism is now decided:
**adaptation** (DG-01, `docs/spikes/dg-01-language-pack-spi.md` §1.4). Upstream
is MIT-licensed but unpublished on npm, so an npm dependency is unavailable;
vendoring its code was rejected as maintenance and review-surface cost.
Instead, Arxic consumes the same grammar npm packages upstream declares —
`tree-sitter-php@0.23.12`, exactly pinned because the 0.23.x line is
ABI-compatible with Arxic's native `tree-sitter@0.22.4` runtime while `0.24.2`
is not — and owns the Laravel route-inventory rules outright (upstream ships no
route inventory and no laravel framework config). The pinned upstream tree
remains a LOCAL-ONLY reference. An Arxic language pack is the upstream language
surface plus Arxic-owned framework route and handler inventory rules with
line-anchored `EvidenceRef`s, and provenance/manifest integration. Writing new
per-language parsers is explicitly out of scope unless citable evidence shows
the upstream extractors are unusable; DG-01 found no such evidence for PHP.

PHP/Laravel is first because the campaign measured roughly two-thirds of the
intent in PHP. Packs are adapter-level additions; frozen contracts do not
change. Any frozen-schema change requires its own ADR.

Unsupported-language diagnostics become per-pack advisories that name the
actual language correctly. A missing PHP pack must not be reported as a generic
or misleading source condition. DG-01 and DG-05 are tracked by #245 and #249.

Understand-Anything's business-domain mapping is LLM-agent-driven and
non-deterministic, so it cannot serve as the deterministic completeness
denominator. The Domain Inventory in Decision 2 remains Arxic-owned.

### 6. Grounding is preserved for every ledger intent

Every ledger intent MUST carry at least one source `EvidenceRef` with line
anchors emitted by a pack extractor. Runtime observations attach where
available. An LLM never assigns a truth state; ADR-001 §2 remains unchanged.

Zero fabrication is an auditable invariant. Every ledger intent must resolve
through `evidence/index.json`; a ledger row with a dangling, synthesized, or
unresolvable evidence reference fails the relevant gate.

This preserves the source-to-artifact audit path while allowing the ledger to
show honest gaps. Evidence proves that an intent was grounded, not that its
proposed outcome is automatically an acceptance oracle.

### 7. Assertions derive from observation, not literals

Post-action assertions are captured from stage-8 runtime observation of the
live application, including URL and DOM state, and bound into IntentSpec. The
compiler consumes observation-bound specifications.

This removes the canned-`url:/` defect class by construction (#257). It does
not turn observed behavior into an acceptance oracle: ADR-004 provenance rules
continue to distinguish acceptance-backed assertions from observed-only
characterizations.

DG-03 and DG-09, tracked by #247 and #253, define and implement the generalized
observation-to-assertion path.

### 8. Verification is honest for non-UI intents

Each intent is classified as one of:

- `replayable-browser`;
- `replayable-api`;
- `corroborated-only`; or
- `human-approved-only`.

An API-level replay executor performs HTTP replay against the attested target,
using leased fixtures and the same evidence gates. This expands deterministic
verification beyond browser workflows without weakening target, action, or
provenance policy.

Only deterministic replay assigns `verified`. Non-replayable intents cap at
`observed`, including ADR-004 observed-only characterization. Approval may
authorize a scope; it never substitutes for replay evidence. DG-03 (#247)
defines the verification architecture.

### 9. Framework detection enforces version ranges

Framework and version are detected from source evidence, including lockfiles
and imports. Rulepack version ranges become normative rather than descriptive.

Detection produces explicit accept, reject, or waiver diagnostics. Unknown
frameworks fail fast during config validation instead of silently falling
through name-only matching. A waiver is a recorded operator decision, not an
implicit compatibility claim.

DG-10 (#254) implements this decision. Its test matrix must include declared
range acceptance, declared range rejection, unknown-framework rejection, and
recorded waiver behavior.

### 10. A research-first phase gate controls implementation

Research spikes DG-01 through DG-04 (#245–#248) MUST land before implementation
slices DG-05 through DG-10. The real-model program DG-11 (#255) is owner-gated.

This ADR remains Proposed until the DG-12 exit gate (#256) passes. Proposal is
not authorization to claim full-domain extraction, change frozen contracts, or
represent an unmeasured model program as production capability.

### 11. Research method — code is the source of truth, adversarially validated

Every piece of prior information—including campaign measurements, issue
premises, documentation, and agent memory—is treated as possibly stale or
incorrect until validated. Research uses this source-of-truth hierarchy:
Arxic repository code for Arxic behavior; upstream source and tags for
dependencies; then version-matched official documentation as secondary
evidence.

Design assumptions, including Laravel route-shape diversity, Tree-sitter PHP
binding APIs, and framework-version distributions, MUST be validated against
real repositories through GitHub code search rather than synthetic examples,
with URL-and-commit citations. Every spike conclusion remains provisional until
it passes consensus (`consensus-terra`) and/or specialized-agent cross-review
(`reviewer-deepseek` with `reviewer-hy3` or `codex-reviewer`); the evidence and
any dissent MUST be recorded. This protocol binds DG-01 through DG-04
(#245–#248) and this ADR.

## Exit criteria

DG-12 is the acceptance gate for this ADR. It runs on two real third-party
applications: one TypeScript/JavaScript application and one PHP/Laravel
application.

**Pre-exit requirement (added after the wave-1 spikes):** both target
applications MUST be nominated and owner-ratified **before exit runs begin**.
Nomination is by objective criteria, each verifiable: a real third-party
application (not Arxic-authored), bootable, attestable under the existing
attestation policy, and with at least one recorded real-model, non-stub run.
The original campaign monorepo is unlocatable locally (recorded independently
by three spikes — `docs/spikes/dg-01-language-pack-spi.md` §5.1,
`docs/spikes/dg-02-domain-inventory.md` §6.2,
`docs/spikes/dg-04-model-proposal.md` §5.2 — none could find a clone path).
The current candidates are therefore **koel** (PHP/Laravel 13.24, campaign
framework major) and **directus** (TypeScript/JavaScript), pending owner
ratification. Any substitution of a ratified target must be recorded before
measurement, consistent with the threshold-tuning rule below.

The following hard criteria MUST all pass:

1. The ledger covers 100% of Domain Inventory rows, and every row has a
   disposition.
2. Grounded intents exist for at least 80% of inventory rows. The owner may
   tune this threshold before the exit, and that change must be recorded before
   measurement.
3. At least 90% of attempted replays verify across two clean runs.
4. The fabrication audit finds zero fabricated intents.
5. Each application has at least one recorded real-model, non-stub inference
   run.
6. Repeat-run ledgers are byte-stable modulo timestamps.

The exit report must retain safe, redacted evidence sufficient to reproduce the
denominator, grounding audit, replay numerator and denominator, and
determinism comparison. Raw secrets, credentials, and unsafe browser artifacts
remain excluded under ADR-001's existing redaction policy.

## Consequences

### Positive

The ALL-Domain Business Intent Extraction milestone's single goal—ALL-domain
extraction—becomes measurable
through ledger-completeness percentages rather than aspirational language.

The trust spine is reused unchanged: attestation, evidence resolution,
redaction, policy, deterministic verification, and promotion retain their
existing authority boundaries.

- Reuse-first language breadth: upstream Understand-Anything's 13 extractors /
  15 grammar-bearing code-language configs are the language surface, consumed by
  adaptation (Decision 5); Arxic builds only the evidence/inventory layer they
  lack, so the cost of language breadth drops accordingly.

ADR-004 IntentSpec reaches users through the ledger and compilation path instead
of remaining an internal-only seam. PHP ecosystems become first-class, and the
architecture can add languages without making pipeline code language-specific.

### Negative and costs

The pipeline gains an inventory stage. For compatibility, existing stage IDs
remain stable; the inventory stage uses the next available ID after structural
extraction. Exact numbering is an implementation decision recorded at DG-06.

Model cost scales with inventory size. DG-04 measured the profile (Decision 4):
per-domain with bounded concurrency is the production path, one-shot is
forbidden as the proposal path, and the provisional per-app budget default is
recorded pending owner override. Non-TypeScript fixtures need license review,
and real-model evidence requires owner-gated credentials.

The ledger increases bundle contents and review surface. Its inclusion is
therefore hash-covered and redaction-gated, and its CLI access is read-only.

### Truth states

Truth states do not change. `verified` remains deterministic-verifier-only.
The ledger makes mixed truth states visible as an honest product feature rather
than hiding unsupported, unsafe, or unextracted behavior behind an incomplete
workflow set.

## Risks

### Tree-sitter grammar gaps on legacy PHP

Legacy PHP syntax or framework idioms may exceed available grammar and extractor
coverage. DG-01 measures parse-failure rate. Per-file skips emit advisories and
remain inventory-visible; they are never silently omitted.

### Proposal quality and cost at approximately 340 endpoints

Model proposal quality, token use, and latency may be unacceptable at campaign
scale. DG-04 measures these before a product commitment.

If grounded-proposal cost exceeds an owner-set budget, Arxic falls back to
per-domain prioritized extraction with explicit `unextracted-with-reason`
dispositions. Completeness of the ledger is never sacrificed.

### Domain clustering quality

Grouping surfaces into domains may be imperfect, especially where an endpoint
serves multiple user journeys. Measured by DG-02 on koel
(`docs/spikes/dg-02-domain-inventory.md` §5.1): 43 clusters, of which only ~9–13
carry domain signal and 18 are utility/action singletons. Clustering is
therefore demoted to an advisory prioritization heuristic, never a domain
partition (Decision 2). Deterministic heuristics come first; singleton utility
clusters must be folded into their resource contexts before any product surface
consumes cluster labels directly. The ledger always exposes raw inventory rows
regardless of clustering, so a weak grouping does not hide the denominator or
manufacture a result.

### Scope explosion

Language packs, API replay, framework detection, and model scaling can broaden
the milestone beyond a bounded implementation. The research phase is time-boxed
and has explicit kill criteria. DG-01 through DG-04 determine whether later
slices remain justified.

### Non-goals

This ADR does not authorize production-environment testing, service mode (M3),
healing (the ADR-007 deferral stands), understanding internal implementation
detail beyond user-facing behavior, or support for browsers beyond Chromium.

Production-like targets remain governed by attestation and approval policy;
this ADR broadens extraction, not the target-safety envelope.

## Alternatives considered

### Model-only reading without grammars — rejected

Model-only reading would break `EvidenceRef` line anchoring, determinism, and
the content-is-data prompt-injection defense. It cannot provide the auditable
source denominator required for completeness.

### Crawl-only intent extraction — rejected

Crawling alone has no source grounding and no evidence binding. It can observe
a surface but cannot establish the inventory or provide anchored provenance for
a proposed business intent.

### Ship authentication only and iterate — rejected

The 2026-08-16 third-party campaign measured the auth-only design at zero of
approximately 340 endpoints of core value on a real application. Continuing
that path would preserve a successful trust spine around the wrong product
scope, so it is rejected as the ALL-Domain Business Intent Extraction goal.

### Defer the gap to service mode (M3) — rejected

The gap is in the product's core promise, not in hosting or multi-user
operation. Deferral to service mode has no compensating value and would leave
the CLI unable to deliver ALL-domain extraction.

## Acceptance proof (2026-09-05)

The DG-12 exit gate (#256) passed all six exit criteria by script on both
owner-ratified third-party apps — directus (TS/JS, pin `cb846b6a…`) and koel
(PHP/Laravel 13.24, pin `dfec91f…`). Evidence and per-gate assertion logs are
retained under `docs/evidence/DG-12/` (exit report: `EXIT-REPORT.md`):

- Criterion 1 (coverage 100% with a disposition per row) — `scripts/dg12-coverage.mjs`, PASS both apps (G-2).
- Criterion 2 (grounded intents ≥ 80%) — `scripts/dg12-grounded-ratio.mjs`, PASS both apps over the extractable denominator per the 2026-09-04 CCR/DECISION on #256 (grounded/`extracted`; all-rows ratio disclosed; every non-extracted row carries its reason) (G-3).
- Criterion 3 (≥ 90% of attempted replays verify, two clean runs per app) — `scripts/dg12-replay-ratio.mjs`, PASS both apps (G-4).
- Criterion 4 (zero fabricated intents) — DG-07 fail-closed resolvability gate + `scripts/dg12-fabrication-audit.mjs`, PASS both apps (G-5).
- Criterion 5 (≥ 1 real-model non-stub run per app) — recorded telemetry citations under `docs/evidence/DG-12/<app>/assertion-logs/real-model-citation.md` (G-6).
- Criterion 6 (determinism) — `scripts/dg12-determinism.mjs --rebuild` byte-identical modulo `generatedAt` + two-run comparison with model-sampling variance OBSERVED-attributed, PASS both apps (G-7).

This ADR flip is the final artifact of the gate; it landed after every
criterion passed, per the frozen contract. Threshold history: 80% owner-recorded
UNTUNED (decision 4, #256); the criterion-2 denominator operationalization was
recorded BEFORE measurement (CCR + DECISION, 2026-09-04, #256).
