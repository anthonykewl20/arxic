# WEB-402-INTENTS — frontend declaration inventory proof

Tracker: [#402](https://github.com/anthonykewl20/arxic/issues/402). This proves a
bounded declaration-inventory slice; the full web-product tracker remains open.
Version: v0.0.200 (owner-defined minor increment of 100).

## Source and environment

Final production/evidence source: `795cf1702df13c860022eaed46b3d9f63886932c`.
Earlier retained source: `b6b5551058fe56f92afb73ff1b020048b321dd51`.
Local Linux, repository-pinned pnpm/Chromium and native Tree-sitter; isolated
reference-app Git copies, ephemeral HTTP ports and temporary SQLite. No raw
trace was recorded. All 20 retained PNGs were viewed by the agent; each PNG hash
and both sanitized action timeline hashes were independently checked. This is
agent inspection, not the required human release sign-off.

## Reproduced failures and corrections

| Test/trigger                               | Red evidence                                                   | Final result                                                                                |
| ------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Frontend inventory through source adapter  | Capability absent                                              | PASS: four adapter tests cover real Next.js/Express sources and filesystem/budget cases     |
| Discovery job returns frontend provenance  | Result lacked frontend inventory                               | PASS: real job persists declarations; status summaries omit the large payload               |
| Dashboard exposes searchable declarations  | Real Chromium could not find frontend heading                  | PASS: actual browser filters real README declarations and opens unsupported-template gaps   |
| Search text survives status polling        | Expected `README`, received empty string after a poll          | PASS: active search form preserved; original assertion unchanged                            |
| Environment settings are not feature flags | Real source probe labeled all env references as flags          | PASS: separate configuration-reference kind, pinned against real Next.js source             |
| Mobile declaration readability             | Initial screenshot splits ordinary words across narrow columns | PASS by agent visual review: stacked final rows retain readable words and source references |
| Version-bound canonical oracle digests     | Three exact comparisons changed with package version           | PASS: exact v0.0.200 hashes repinned; no assertion widened                                  |

Other actual browser assertions pass: invalid login and outside-root folder
refusal, late anonymous/session-response races, project save, source discovery,
real visual capture/explicit baseline approval/unchanged comparison, UTC schedule
configuration, admin audit events, mobile viewport fit and logout. The final
browser test took 13.63 seconds (14.44 seconds including test startup).

The 20-file source/web run passed 75 tests during implementation. After review,
the four frontend tests and final browser journey passed again. The two
version-bound test files and two structural-contract files passed 16 tests.
Root/package typechecks, lint and version provenance passed locally. Current-head
CI and license results belong on the PR and tracker; local proof alone is not
merge completion.

The final 75-test rerun initially had 74 passes and one stale dashboard API
expectation pinned to v0.0.100. The API correctly returned v0.0.200. Both exact
canonical/display literals were updated to the new release version; no matcher
was loosened. The targeted HTTP suite then passed all three tests.

## Live source probes

[Final measurements](source-probes.json) record two identical passes per real
reference source snapshot, exact source/fixture commits and inventory hashes.
Every enumerated file is accounted for; summed file row counts equal the row
array. Every declaration remains `hypothesized`.

| Source            | Files | Declarations | Selected measured kinds                                                                     | Gaps                                                                                         |
| ----------------- | ----: | -----------: | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Next.js reference |    35 |          219 | 12 components, 32 controls, 8 actions, 143 conditions, 20 configuration references, 4 tests | 4 unsupported file kinds                                                                     |
| Express reference |    15 |           67 | 49 conditions, 14 configuration references, 2 requirements, 2 tests                         | 3 binary files, 3 unsupported file kinds, EJS unsupported, documentation acceptance unproved |

Counts describe these exact local snapshots. The existing fixture-copy helper
also copies locally present ignored SQLite files, which become explicit binary
gaps in the temporary Git copy. A clean CI input can therefore have a different
file/gap count. No fixed cross-environment census is claimed. Backend/test
conditions are declarations too; frontend reachability and runtime semantics
remain unproved. The [earlier probe](initial/source-probes.json) is preserved
unchanged and contains the environment-variable misclassification corrected in
the final result.

## Retained UI evidence

Final [action timeline](final/timeline.json) and adjacent
[sanitization provenance](final/timeline.sanitization.json) contain only named
actions and pass/fail results, without DOM/network payloads. PNG privacy records
are adjacent to every image. Password inputs are masked; dashboard surfaces use
only test fixture metadata. No human sign-off or interactive human execution is
claimed.

| Named screenshot         | Final proof                                                                |
| ------------------------ | -------------------------------------------------------------------------- |
| 01-empty-workspace       | [Authenticated empty workspace](final/01-empty-workspace.png)              |
| 02-project-overview      | [Saved project](final/02-project-overview.png)                             |
| 03-intent-inventory      | [Route and declaration inventory](final/03-intent-inventory.png)           |
| 04-visual-comparison     | [Real baseline/current/difference](final/04-visual-comparison.png)         |
| 05-schedule              | [Persisted UTC schedule](final/05-schedule.png)                            |
| 06-administration        | [Admin scope and audit](final/06-administration.png)                       |
| 07-mobile-overview       | [Mobile dashboard](final/07-mobile-overview.png)                           |
| 08-signed-out            | [Session race refusal](final/08-signed-out.png)                            |
| 09-frontend-declarations | [Declaration provenance and file gaps](final/09-frontend-declarations.png) |
| 10-mobile-declarations   | [Readable mobile declarations](final/10-mobile-declarations.png)           |

The matching ten [earlier images](initial/) and their provenance remain intact;
[initial mobile rows](initial/10-mobile-declarations.png) show the cramped layout
that prompted the correction.

## Not established by this slice

Semantic business-intent synthesis; arbitrary frontend framework coverage;
component-to-runtime mapping; multi-workflow campaigns; semantic AI image review;
authenticated visual checkpoints; guided fixture/model/secret/budget/retention
configuration; clean server distribution/recovery; independent human release
inspection. None of these requirements is satisfied merely by declaration
counts or an unchanged screenshot. No tag or release was published.

## Integration correction

CI run [33963191369](https://github.com/anthonykewl20/arxic/actions/runs/33963191369)
passed static, package, fixture-app and worker-image jobs, but shards 1 and 4
found four further test files pinned to the previous package version: CLI
version output, CLI run-directory provenance, M0 pipeline provenance and bundle
assembly provenance (the latter is tested against both apps). All five failures
reproduced locally. The four exact literals now require 0.0.200; all ten tests
in those files pass locally (38.87 s). No assertion is widened or removed.
The full repository search leaves 0.0.100 only in historical records and
intentional version-policy examples. Current integration status is the
[PR #404 check suite](https://github.com/anthonykewl20/arxic/pull/404/checks).
