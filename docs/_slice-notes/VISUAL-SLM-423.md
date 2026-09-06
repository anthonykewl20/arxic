# VISUAL-SLM-423 — staged doc updates (charter §10.2)

Issue: #423 · PR: #424 (draft) · Disposition: hypothesized (specification only)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| #423 | [VISUAL-SLM-423] Compact visual reviewer specification prepared; implementation and measured feasibility pending | ☐ open |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-09-06 | **#423 (VISUAL-SLM-423) specification prepared.** Defined an Arxic-owned 8,486-parameter feature classifier, CPU training, 512 MiB deployment profiles, evidence/label contracts and quality/resource gates. Codex owns implementation; optional GLM teaching occurs only after a working, tested foundation. No trained model, teacher call, target-VM proof or product-completion claim. Next: implement S1 contracts/corpus audit after specification review. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### internal`

```text
- VISUAL-SLM-423 compact visual-model specification (refs #423): documents proposed native inference, CPU training, independent evidence and dataset gates, a 512 MiB resource target and deferred GLM teaching. Specification only; no runtime behavior or trained model added.
```

## 4. `VERSION` bump required?

No. Documentation-only proposal; no runtime behavior change. VERSION and package versions remain unchanged.

## 5. Evidence pointers

- Specification: `docs/visual-small-model-spec.md`.
- Deferred teacher brief: `docs/visual-small-model-glm-handoff.md`.
- Existing real-app evidence context: `docs/evidence/WEB-402-SUBSCRIPTIONS/summary.md`; not new model-quality proof.
- Validation: Markdown formatting, local relative-link existence, parameter arithmetic and ownership/sequence consistency inspection. Current-head CI is pending; no implementation tests or resource/model measurements are claimed.
- Full-repo format command runs after this note; exact outcome belongs in the PR/issue report.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

No new runtime behavior was implemented or exercised. The specification's §15 defines required future sad-path tests; it does not claim they passed. Missing consent, altered evidence, incompatible captures, malformed models and resource exhaustion must become blocked/diagnosed outcomes, while model findings remain hypotheses. Issue #423 stays open for implementation and actual proof.
