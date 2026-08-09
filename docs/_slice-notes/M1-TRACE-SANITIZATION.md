# M1-TRACE-SANITIZATION — staged doc updates (charter §10.2)

Issue: #111 · PR: not opened by this worktree · Disposition: blocked pending
independent review and current-head CI

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

No existing #111 tracker row is present. The integrator should add:

```text
| #111 | [M1-TRACE-SANITIZATION] Fail-closed Playwright action-timeline sanitization | ☐ pending current-head CI |
```

Only change the box to `☑ done` after the merged PR head's `ci` check prints
`pass`. Also update the top status/open-work prose so #111 is neither absent
while open nor described as complete before CI.

## 2. `docs/SYNC.md` — session-log row (append to the table)

Stage this wording, but replace the disposition and counts from actual PR-head
CI before appending:

```text
| 2026-08-09 | **#111 (M1-TRACE-SANITIZATION) Playwright trace retention boundary.** Raw Playwright ZIPs are deleted at capture; retained evidence is a deterministic privacy-preserving action timeline with adjacent checksum/projection provenance and independent bounded inspection. Verifier/M0 sanitization failure blocks eligibility; assembly/promotion classify bounded bytes rather than trusting kind/extension and preserve prior output on failure. Real Playwright 1.62.1 Chromium proof exercised both auth apps and the pinned Trace Viewer. **Disposition/counts: replace from current-head CI; do not mark DONE early.** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Security`

```text
- M1-TRACE-SANITIZATION Playwright evidence boundary (#111): replace raw trace retention with a deterministic, bounded action-timeline projection plus adjacent provenance and independent inspection; block verifier eligibility, bundle assembly, and promotion on malformed, residual, mislabeled, oversized, or forged artifacts, backed by real Chromium/Trace Viewer proof on both auth fixtures.
```

## 4. `VERSION` bump required?

No. This is pre-release security hardening on the path to the already-planned
0.2.0 M1 exit. Keep `VERSION` and root `package.json` equal; the integrator must
re-evaluate only if release policy changes before merge.

## 5. Evidence pointers

- Real-world proof: `packages/verifier/src/real-world.test.ts` — real Playwright
  1.62.1 Chromium ran twice against the Next.js reference app and Express
  vulnerable app; each resulting action timeline passed independent inspection
  and loaded in the pinned Trace Viewer. The migrated M1-15 timeline is also
  inspected and Viewer-loaded.
- Artifacts: `docs/evidence/M1-TRACE-SANITIZATION/` — two sanitized timelines +
  sidecars, two Trace Viewer screenshots, two locator-masked login screenshots
  with capture provenance, and a README recording their limited semantics/manual
  visual review. `docs/evidence/M1-15/exploration-trace.zip` and sidecar were
  regenerated through the same final projector.
- Current local proof on the candidate state: focused boundary suites passed
  140/140, including canonical JSONL/sidecar/ZIP fixed points, cleanup-failure
  precedence, bounded exact-byte artifact classification, injective screenshot
  checkpoint binding, bounded fail-closed discovery, transactional verifier/M0
  capture, and raw-trace carrier rejection before retention. The affected real
  Chromium suites passed 4/4 in 89.51s across both auth apps, M0, and the
  reconciler report. The full current-tree test run passed 82/82 files and
  644/644 tests in 411.45s; the verifier's 6/6 proof includes all retained-ZIP
  inspection and pinned Viewer loading, and exploration passed 4/4. Retained
  evidence was visually reviewed again without exposing credential/identity
  values. Current-head CI remains pending.
- Gates: typecheck ☑ · recursive package/fixture typecheck ☑ · lint ☑ · format ☐ ·
  test ☑ · license gate (757 packages, 0 rejected) ☑ · CycloneDX SBOM ☑ ·
  fixture apps ☑ · command guard ☑
- Fixture gate note: the first standalone reference-fixture invocation correctly
  failed because no Mailpit endpoint was provisioned. The actual gate then passed
  against a slice-owned Mailpit container on random host ports (reference 2/2;
  vulnerable 1/1) with command-scoped environment and cleanup. The failed
  prerequisite attempt is preserved here rather than omitted.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                                                                     | Expected disposition                                                           | Test                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Malformed/truncated/unsafe-path/normalized-duplicate ZIP                                                                                    | blocked                                                                        | `packages/playwright-trace-sanitizer/src/trace-sanitizer.test.ts` |
| Entry/count/expanded-byte/compression/archive-size bomb                                                                                     | blocked                                                                        | sanitizer archive-limit tests                                     |
| Oversized line, deep JSON, wide nodes, newline flood, too many values/actions                                                               | blocked                                                                        | sanitizer structural-limit tests                                  |
| Orphan `after`, unknown-only action member, invented class/method pair, no complete action                                                  | blocked                                                                        | sanitizer projection tests                                        |
| Cookie/auth/session headers, cookies, query/post bodies, DOM/forms, resources, base64/data URLs, snapshots, sources/stacks/logs/attachments | omitted before retention                                                       | sanitizer hostile-input projection tests                          |
| Arbitrary string IDs/apiName/class/method and numeric timing/viewport channels                                                              | remapped or omitted; observed timeline only                                    | sanitizer fixed-projection tests                                  |
| Forged sidecar/digest/extra fields/deep or oversized provenance                                                                             | blocked                                                                        | independent-inspection tests                                      |
| Non-canonical JSONL/sidecar lexical forms and ZIP comments/extras/header/order/attribute channels                                           | blocked by semantic fixed point plus exact canonical-byte reconstruction       | sanitizer and promoter no-public-write tests                      |
| Raw ZIP renamed `.png`, PNG prefix plus trailing ZIP, mismatched kind/path                                                                  | blocked with prior output/public bytes unchanged                               | bundle-promoter assembly/sad-path tests                           |
| Raw ZIP split directly across CRC-valid private ancillary chunks                                                                            | blocked by the bounded shared classifier                                       | assembly/verifier/M0 carrier tests                                |
| Valid PNG containing isolated `PK` bytes in a CRC-valid private ancillary chunk                                                             | accepted non-container control                                                 | assembly test                                                     |
| Arbitrary sensitive source filename                                                                                                         | blocked and removed; policy-owned checkpoint source uses numeric retained name | verifier/M0/assembly filename tests                               |
| Later invalid artifact after an earlier valid artifact                                                                                      | blocked; whole run destination removed                                         | verifier/M0 transactional capture tests                           |
| Static symlink, non-regular entry, unreadable child, or depth/entry/candidate traversal bomb                                                | blocked; whole run destination removed                                         | verifier/M0 bounded-discovery tests                               |
| Failed browser run with a safe screenshot that misses a required passed-run checkpoint                                                      | contradicted; not misclassified as a capture block                             | verifier + actual M0 fallback sad paths                           |
| Sanitizer failure at verifier or M0 capture                                                                                                 | blocked; no eligible timeline                                                  | verifier/M0 sad-path tests                                        |
| Exploration capture/sanitization failure                                                                                                    | blocked; raw temp source deleted and no eligible timeline retained             | exploration driver + orchestrator real-world proof                |
| Current sanitized timeline + matching sidecar                                                                                               | eligible after independent inspection                                          | assembly/promotion happy controls                                 |

## 7. Documentation and retained-evidence staleness sweep

Direct changes in this slice:

- `docs/adr/001-arxic-architecture.md` §§13, 15, 16.5 and repository layout now
  define sanitized action timelines, their deliberately reduced fidelity, and
  the new shared package. Old “generic trace redaction/full trace artifact” text
  is replaced, not left as an alternate policy.
- `AGENTS.md`, `.opencode/skills/evidence-driven-testing/SKILL.md`, and
  `.github/pull_request_template.md` now prohibit attaching raw traces and
  require the sanitized timeline + sidecar. The bug-report template no longer
  asks for raw traces.
- `SECURITY.md` and `docs/threat-model.md` now name the raw-trace boundary and
  separate screenshot pixel review from trace inspection.
- `packages/playwright-trace-sanitizer/README.md` documents ownership, exact
  projection, limits, STORED canonical-byte fixed points, output-derived action
  counts, capture-reported (not origin-authenticated) source digest, and
  fail-closed use. It also documents sequential bounded discovery, the bounded
  direct trace-carrier classifier, exact validated-byte handoff, and the explicit
  non-claims for encoded metadata, valid IDAT, and pixel privacy owned by #115.
- `packages/m0-pipeline/README.md` replaces stale “retained traces” wording with
  sanitized action timelines + provenance and does not overclaim screenshot
  safety. `packages/bundle-promoter/README.md` documents bounded content
  classification and validated-byte handoff.
- `packages/playwright-agent-adapter/README.md` replaces stale generic retained
  trace wording and records the exploration driver's ephemeral raw capture,
  shared projection, adjacent sidecar, cleanup, and blocked failure semantics.
- `docs/engineering-charter.md` replaces its stale headless-evidence shorthand
  with the sanitized timeline + provenance + visually reviewed screenshot
  contract and explicit raw-trace prohibition.
- `docs/evidence/README.md`, `docs/evidence/M1-TRACE-SANITIZATION/README.md`, and
  `docs/evidence/M1-15/README.md` define current/future retention semantics,
  visual-review scope, and the historical purge obligation.
- Root `README.md` had no numeric package-count claim; its stale “M0 in progress”
  status is changed to M1 exit hardening. ADR §18's explicit package list now
  includes `playwright-trace-sanitizer`. There are currently 20 package
  directories plus two app directories; the root and two test fixtures are
  separate workspace entries. Do not invent a single ambiguous count in root
  docs.

Integrator-only changes (not permitted in this parallel worktree):

- Apply §§1–4 to `docs/SYNC.md`, `CHANGELOG.md`, and `VERSION` only after
  current-head CI. Reconcile SYNC's stale open-work count/list and #111 status.
  In SYNC's active “Last session” text, replace the stale
  `screenshots+traces`/text-only-gate description with sanitized action
  timelines, adjacent provenance, and bounded ZIP inspection. Preserve the
  dated M0 completion row as history, but qualify its historical trace as
  predating the sanitized-retention policy and covered by the disclosed
  pre-public history-purge obligation; do not rewrite its completion claim.
- If #108 lands `docs/evidence/M2-SERVICE-WORKERS/service-worker-registration-blocked.trace.zip`
  before integration, regenerate it with the shared sanitizer/current sidecar
  or remove it. Never merge that raw trace unchanged.
- Preserve the dependency order with #115: this slice leaves the exploration
  driver's existing full-page screenshot block untouched. #115 owns the shared
  screenshot-attestation service and must wire that independent privacy
  boundary after #111; timeline inspection is not pixel privacy.
- Repo-wide current-tree inventory must contain no trace ZIP without a matching
  current sidecar/inspector pass. Historical raw commits are not clean: they
  remain a disclosed pre-public purge obligation, and this slice does not
  authorize a history rewrite.
- The sidecar's source digest is capture-reported linkage, not signed source
  authenticity; independent inspection attests only the retained canonical
  bytes and output-derived counts. Any future origin-signing requirement is a
  separate security control.
- Artifact discovery assumes freshly Action-owned roots, and the Action must
  establish that no writer remains before discovery (normally after its
  controlled runner completes). Static links/special entries and bounded reads
  fail closed, but concurrent same-UID intermediate-directory replacement
  remains UNVERIFIED and belongs to worker/process isolation; do not call the
  helper race-safe or use it to claim containment for arbitrary active caller
  paths.
- Re-run the full staleness search after merging parallel slices; dispose any
  newly landed wording that treats raw/full-fidelity traces as attachable proof.
