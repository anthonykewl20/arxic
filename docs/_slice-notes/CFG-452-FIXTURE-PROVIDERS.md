# CFG-452-FIXTURE-PROVIDERS — staged doc updates

Issue: #452 · Review linked on issue · Disposition: observed refusal

## 1. `docs/SYNC.md` — tracker row

| #452 | Reject unsupported fixture provider declarations | Implementation tested; CI required |

## 2. `docs/SYNC.md` — session-log row

| 2026-09-07 | #452: CLI and worker share managed fixture-name validation. Real CLI rejects unsupported names before target traffic; canonical real execution remains passing. |

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

- Reject unsupported fixture-provider declarations at CLI and worker boundaries with field-specific diagnostics that omit supplied values (refs #452).

## 4. `VERSION` bump required?

Yes: user-visible configuration rejection; integrator applies the next patch. No global version or changelog edit in this worktree.

## 5. Evidence pointers

- [Proof](../evidence/CFG-452-FIXTURE-PROVIDERS/summary.md): red public-boundary cases, 73 related tests and three real CLI compatibility tests.
- Shared validator returns bounded field/reason records; CLI and worker actions retain their existing failure classification.
- Typecheck and lint passed. Full format after the note ended `All matched files use Prettier code style!`. Current-head CI remains required.

## 6. Sad paths proved

| Trigger                     | Disposition                                   | Proof                                    |
| --------------------------- | --------------------------------------------- | ---------------------------------------- |
| Unsupported provider        | Configuration refused at both boundaries      | Three field cases                        |
| Malformed provider          | Configuration refused                         | Empty/null/number/array/object cases     |
| Supplied private name       | Absent from diagnostics                       | Canary assertions                        |
| Unsupported real CLI config | Exit 2, no run directory, zero target traffic | Running reference app and counting proxy |

Omitted providers and canonical declarations retain their behavior. This does not
complete GUI fixture management or #402. No assertion was loosened.
