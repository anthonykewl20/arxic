# ADR-010 — compact visual model experiment

Date: 2026-09-06. Status: **Experimental; production adoption not accepted**.
Refs [#423](https://github.com/anthonykewl20/arxic/issues/423), [PR #424](https://github.com/anthonykewl20/arxic/pull/424).

## Context

The owner wants Arxic-owned visual analysis that can train on a normal CPU and target a 512 MiB, one-vCPU analysis VPS. Codex must build and test a working foundation before any optional GLM teaching. The full visual-oracle taxonomy remains the product target; a compact classifier cannot imply general UI/UX competence.

## Experimental decision

Implement a development CLI with strict evidence validation, shared deterministic pixel comparison, 96 fixed image/geometry features, CPU logistic/MLP training and a crate-free Rust inference kernel. The MLP has 8,486 parameters and float32 export. The reference optimizer uses Python standard-library float64 arithmetic; independent gradient checks and exported native parity guard this disclosed departure from the original NumPy/float32 training proposal.

The experiment uses internal schemas under the web source directory and does not change frozen public adapter contracts. Actions retain consent, label admission and failure classification. Numeric inference returns scores; shadow fusion preserves hard findings and cannot produce an overall pass. No deployed model activation or promotion is added.

## Evidence and consequences

The [retained real-app evidence](../evidence/VISUAL-SLM/summary.md) covers Next, Express and Arxic in separate train/calibration/test groups. The initial learned detector missed all four held-out clipped-button cases at the calibrated threshold. This is evidence against adopting these weights; thresholds were not loosened. Deterministic checks retained the failures.

Resource probes support further investigation but do not qualify a VPS deployment. The numeric kernel is very small; the full PNG analysis path has additional runtime overhead. Neither test includes a full browser/server/OS deployment. The analysis-only versus full-stack target remains unresolved.

Production adoption requires the remaining [specification](../visual-small-model-spec.md) gates: richer independent data, proven incremental value, resource qualification and release evidence. GLM remains excluded until its pre-teacher gate passes. This experiment may validly conclude that deterministic checks are preferable for a class.
