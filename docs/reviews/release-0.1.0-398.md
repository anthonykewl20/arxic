# v0.1.0 release audit — refs #398

Audit date: 2026-09-05. Starting main: `16a3b2f`.
The implementation was merged through [PR #399](https://github.com/anthonykewl20/arxic/pull/399)
as `b15b59b`, whose tree matches the tested code head `e2f99d3`.
[Required CI passed](https://github.com/anthonykewl20/arxic/actions/runs/33952621810/job/101272428821).
The initial local proof was captured at `e046590`; the retained
[final CI proof](../evidence/RELEASE-398/final-ci/summary.md) covers `e2f99d3`.
Final integration and release-cell results are recorded on
[tracker #398](https://github.com/anthonykewl20/arxic/issues/398).

**The audit found real release defects, including a false-positive login gate.**
The fixes have passing targeted regressions and a clean-installed v0.1.0 journey.
This is a bounded engineering review, not a guarantee that every application,
configuration, concurrency schedule, or future provider response is defect-free.
Tagging/publication remains subject to the standing human screenshot gate.

## What the project actually does

Arxic discovers behavioral intent from a pinned source checkout and a permitted
test deployment. The primary ADR-008 product is the Intent Ledger: an explicit
disposition for every inventoried surface, with source evidence and honest gaps.
Generated Playwright bundles accompany replayable UI intents. A model proposes
intent; only the deterministic verifier can assign the `verified` state.

| Layer                        | Code/output                                                          | Specification comparison                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source and language packs    | `source-ua-adapter`, ast-grep, PHP/JS/TS grammar packs               | Structural source extraction feeds anchored evidence; the missing packaged PHP grammar was a distribution defect.                                                                     |
| Inventory and grounding      | `domain-inventory-spike`, `evidence-graph`, `intent`                 | Inventory fusion supplies the ledger denominator. Unsupported/non-UI rows remain explicit; coverage is not a claim that every business requirement is proved.                         |
| Orchestration                | `orchestrator-langgraph`, CLI/worker actions                         | Checkpointed stage ordering, policy and failure classification live in actions. Shared mechanics remain in services. Run reuse now binds the previously omitted policy/config inputs. |
| Discovery and execution      | Crawlee, Playwright exploration, fixture services, policy engine     | The attestation gate precedes protected execution. A pre-gate redirect escape and premature post-click observation were fixed.                                                        |
| Compilation and verification | Playwright compiler, verifier, screenshot/privacy and trace services | Observed outcomes are replayed with receipts and source binding. The inventory entry URL is now distinct from post-action evidence. Configured replay counts reach the verifier.      |
| Promotion and transport      | Bundle promoter, worker sandbox/import                               | Hash/redaction/trace/privacy gates precede promotion. Directory assembly now stages privately and preserves existing nonempty destinations; CLI bundles include the build SBOM.       |
| Release automation           | CI, tarball smoke, packed human-flow, OS/Node matrix                 | Required CI now consumes a required worker-image result; npm publication waits for the six supported OS/Node cells.                                                                   |

ADR-008 explicitly distinguishes observed characterization from an independent
acceptance oracle. Stabilizing an observation fixes the stale-login defect; it
does not establish that the application's observed behavior is correct business
behavior. The reference-app release gate therefore independently requires its
known successful login transition to `home` and rejects wrong credentials.
Stage-11 automatic healing remains deliberately deferred by ADR-007.

## Findings and remediation

| Priority | Reproduced defect                                                                                                                             | Change and proof                                                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1       | Build-digest discovery followed redirects before attestation and accepted origin-escaping endpoint paths.                                     | Shared bounded, manual-redirect service; same-origin path validation; real two-server egress regression observes zero outside requests. Custom attestation paths now reach the actual handshake. |
| P1       | Terminal-run reuse ignored expected digest, allowed origins, replay persona and verification policy changes.                                  | Fingerprint binds the full CLI config/policy and explicit orchestration fields; persisted-run refusal regression preserves the original run.                                                     |
| P1       | A configured persona secret appeared in malformed attestation errors without a replay-persona declaration.                                    | Diagnostic emission and persistence redact configured values; malformed JSON errors no longer echo arbitrary upstream bytes. Real HTTP failure regression and disk checks.                       |
| P1       | Worker execution dropped origin/replay declarations and the expected digest.                                                                  | Shared local/worker config projection, verifier propagation and credential-aware checkpoint redaction; worker toolchain/image proof and parity regression.                                       |
| P1       | Release gate used obsolete provider/schema contracts and could promote login-page → login-page.                                               | Current inventory-grounded stub contract; independent signed-in-state assertion; retained red failure and fresh packed proof.                                                                    |
| P1       | Exploration sampled before asynchronous form submission completed.                                                                            | Bounded request/URL/accessibility settling; real Chromium delayed-response and hanging-response regressions.                                                                                     |
| P1       | Once the real outcome was observed, generated replay started at the destination instead of the form.                                          | Inventory-derived entry URL flows separately through compiler and verifier reconstruction; independent relocated-bundle replay passes. Frozen contracts/schemas are unchanged.                   |
| P1       | Configured replay counts above two were ignored.                                                                                              | Count propagated through both compilation paths, fingerprints and execution; the packed proof retains three clean verifier passes. Counts below two are rejected.                                |
| P1       | Required `ci` could be green despite a required worker-image failure; publish did not wait for the release matrix.                            | Required-job aggregation and reusable release matrix dependency; real Bash/YAML regression cases.                                                                                                |
| P1       | Direct generated/fallback replay retained raw traces after failure.                                                                           | Direct configs default off; managed verification still enables and sanitizes capture. Wrong-password direct replay fails without a raw ZIP.                                                      |
| P1       | Assembly deleted a prior bundle before validating replacement source bytes.                                                                   | Assemble/scan in a private sibling directory, then rename into a new/empty destination. Nonempty bundles are immutable; corruption regression retains prior bytes.                               |
| P2       | Fresh npm installation lacked the advertised PHP grammar.                                                                                     | Runtime dependency/external added; packed native tree-sitter parses PHP successfully.                                                                                                            |
| P2       | A provider closing stdin crashed the parent with EPIPE; descendants could delay timeout, stdout was unbounded, and split UTF-8 was corrupted. | Opaque provider failure, bounded completion/process cleanup and 8 MiB output cap and byte-preserving UTF-8 decoding; 27 real-subprocess/helper regressions.                                      |
| P2       | CLI-promoted directory bundles omitted the SBOM supported by the assembler.                                                                   | Pack the actual workspace dependency graph and include its sanitized CycloneDX form in directory bundles; native grammar presence checked in packed proof.                                       |
| P2       | Browser/capture settings accepted values the managed pipeline ignored.                                                                        | Reject unsupported browser arrays and screenshot/trace policies; document Chromium selection and quota boundaries.                                                                               |
| P2       | Human-flow cleanup left Next servers running; docs contradicted worker support/release ordering and active versions.                          | Direct child lifecycle; corrected user guides, before-publish human gate and v0.1.0 metadata; 64 merged notes moved out of active staging with their historical bytes retained.                  |

A later CI shard exposed a reference-app build race: concurrent Next build
workers opened the runtime SQLite file and hit `SQLITE_BUSY` at WAL setup.
The exact failure reproduced locally while a real exclusive database lock was
held during `next build`. Build-phase route evaluation now uses an in-memory
database; normal server execution retains persistent SQLite. The regression
also checks that build evaluation leaves the locked runtime data and schema
untouched. The real server journey also checks that its configured on-disk
database exists after seeding. [Red/green build proof](../evidence/RELEASE-398/build-db-isolation.json). This fixes the cause rather than retrying a failed build.

No existing behavioral matcher was loosened. The new custom-attestation test's
whole-test timeout was raised from Vitest's five-second default to 30 seconds
after concurrent real-engine load exceeded it; the endpoint/egress assertions
remain strict. The settling probe also clamps its per-snapshot timeout to at
least one millisecond so a deadline-edge zero cannot disable Playwright's
timeout; both real Chromium settling regressions pass after that guard. An early version of that new test incorrectly expected _all_
subsequent crawl requests to use the attestation path; it now checks the two
attestation calls and forbids the default endpoint while allowing legitimate
later page discovery. Intermediate full-suite runs overlapped red-first edits
and are not presented as clean final-head results.

The first PR CI run caught an incorrectly shaped table in the new browser test:
Vitest unpacked the array rows into strings. Correct object-shaped cases exposed
three genuinely accepted unsupported arrays; all three failed before explicit
Chromium-only validation and the configuration suite now passes all 40 tests.
CI also caught the copied reference app's fresh npm installation crashing in
npm 10's optional-peer resolver. The same failure reproduced with CI's exact
Node 22.22.0/npm 10.9.4 binaries. Its fixture toolchain now explicitly selects the
workspace-tested Vite 7.3.6 (including an npm override for Vitest's nested copy)
and the Next ESLint plugins' compatible 9.x peer range;
this does not disable peer checks or change the app's runtime dependencies.

A final pipe-boundary probe reproduced silent text corruption: a real provider
subprocess split the bytes of `é日本🙂` and the transport returned `��日本🙂`.
Bounded raw chunks are now joined before UTF-8 decoding. The exact-value regression
failed before the fix and all 27 host-transport tests pass afterward; the 8 MiB
byte cap and opaque diagnostic rules remain enforced.

## Evidence and validation

The [retained proof](../evidence/RELEASE-398/summary.md) contains a pass/fail table,
twelve named screenshots with privacy provenance, twelve independently inspected
sanitized action timelines, the promoted manifest, and annotated test results.
The screenshots mask the main landmark; the transition proof comes from the
executed assertions/receipts, not inference from obscured pixels. Automated
visual review was performed on all twelve images; this is not human sign-off.

| Check                                                                            | Result                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh npm-installed v0.1.0 → real Next.js app → Chromium → three verifier passes | PASS, 141.872 s for the complete packed gate                                                                                                                                                                    |
| Same complete gate with exact CI Node 22.22.0/npm 10.9.4                         | PASS, 123.646 s; [retained regression proof](../evidence/RELEASE-398/node22/summary.md)                                                                                                                         |
| Final code head packed journey in GitHub-hosted CI                               | PASS, 93.754 s; [permanent proof](../evidence/RELEASE-398/final-ci/summary.md)                                                                                                                                  |
| Independent copied bundle with correct/wrong credentials                         | PASS / expected failure; no raw failure trace                                                                                                                                                                   |
| Native PHP grammar and bundle SBOM                                               | PASS                                                                                                                                                                                                            |
| Unreachable target preserves prior promoted envelope                             | PASS                                                                                                                                                                                                            |
| Next.js reference fixture suite + real Mailpit                                   | PASS, 3 tests                                                                                                                                                                                                   |
| Express vulnerable fixture suite + real Mailpit                                  | PASS, 1 test (intentional app vulnerabilities remain fixtures)                                                                                                                                                  |
| Worker image toolchain: root/nonroot, native modules, Chromium, no-egress tools  | PASS                                                                                                                                                                                                            |
| Worker-image real Docker hardening tests                                         | PASS, 2 tests                                                                                                                                                                                                   |
| Dependency license gate                                                          | PASS, 787 packages; zero rejected, two documented license metadata exceptions                                                                                                                                   |
| Root lint/typecheck and package typechecks                                       | PASS in required CI at e2f99d3                                                                                                                                                                                  |
| Complete stable-head suite                                                       | 212 files; 1,879 shard passes. The two image tests skipped in shards both pass in the dedicated required image job: all 1,881 tests executed across required jobs.                                              |
| Current PR required `ci`                                                         | PASS on e2f99d3 before PR #399 merged; [CI run](https://github.com/anthonykewl20/arxic/actions/runs/33952621810)                                                                                                |
| Fresh live-provider pipeline                                                     | PASS with Mailpit: three clean verifier passes and promotion; independent message count 4. Missing-Mailpit run correctly blocked. [Proof](../evidence/RELEASE-398/live-provider/summary.md)                     |
| Supported OS/Node release cells                                                  | Final results: [six-cell matrix at e2f99d3](https://github.com/anthonykewl20/arxic/actions/runs/33952621811). Windows/macOS install/lint/typecheck/native packed smoke; Ubuntu also runs the full engine suite. |
| Human release screenshot census/sign-off                                         | NOT PERFORMED; owner/reviewer release gate                                                                                                                                                                      |

The local full-suite run also exposed three old 0.1.1 provenance expectations
and three oracle canonical hashes whose identities include the package version
after the requested version alignment. They were changed to the exact new 0.1.0
value, and version-bound hashes were re-pinned (`0514a897…` → `76b5675e…`, `bd21463f…` → `9c49f94e…`, `ab685d16…` → `7bdca772…`), without relaxing either comparison; the affected real-engine suites are
rerun successfully. Required CI executes the full test inventory at the final code head; its two shard-local image skips are explicitly accounted for in the dedicated image job.

The commands and immutable run references are recorded in
[validation.json](../evidence/RELEASE-398/validation.json). Full-repo format after
the closeout documentation and evidence census prints:
`All matched files use Prettier code style!`

## Limits and release decisions

- The model-stub packed gate is deterministic integration proof. A fresh provider
  probe found an authenticated OpenCode connection using `zai-coding-plan /
glm-5.3-flash`; the [separate live pipeline](../evidence/RELEASE-398/live-provider/summary.md) passed after its Mailpit dependency was provisioned.
- Existing Directus/Koel DG-12 evidence remains historical evidence at its recorded
  commits. This audit has not rerun the full ratified two-campaign-per-app matrix.
- `maxRuntimeMinutes` is a sandbox-worker quota. Local execution has bounded
  operations, not a whole-run deadline. Feature flags in config are declarations,
  not commands that toggle features in the target application.
- `pnpm audit` reports one moderate advisory on transitive `stream-json@1.9.1`.
  The installed Crawlee path imports `stream-json/streamers/StreamArray`; the
  advisory explicitly identifies StreamArray as unaffected. The vulnerable
  filter/assembler APIs were not found in that installed consumer. No blind
  major-version override was applied. Reassess if the dependency usage changes:
  [GHSA-528h-pc64-c93x](https://github.com/advisories/GHSA-528h-pc64-c93x).
- The new release matrix dependency is required before publication. Packed npm
  smoke installation now runs dependency lifecycle scripts, so native install
  failures cannot be concealed by `--ignore-scripts`. Local Linux
  tests do not substitute for Windows/macOS release cells.
- No tag, npm publication, or human screenshot sign-off was performed. Use
  [RELEASES.md](../../RELEASES.md) in its corrected order.
