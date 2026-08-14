# LANE-T-TEST-STABILIZATION — staged doc updates (charter §10.2)

Issue: refs #219 · PR: none · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
No tracker row exists; this lane stabilizes the CI gate and remediates refs #219.
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-15 | Lane T stabilized the screenshot privacy physical-dependency traversal CI test: an isolated mkdtemp fixture traversing 4,097 physical entries took 13.6–38.7 seconds locally, so its explicit timeout now has 2× headroom without changing assertions. An esbuild 0.28.1 workspace override removes the vulnerable 0.27.7 transitive version behind tsup; `pnpm why esbuild --recursive` reports one version. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### security`

```
- Dependency security: constrain transitive esbuild to 0.28.1, the patched version for refs #219.
```

## 4. `VERSION` bump required?

no

## 5. Evidence pointers

- Real-world proof: `packages/playwright-screenshot-privacy/src/capture-runtime.real-world.test.ts`
  — real Chromium capture tests passed in the package suite (77 tests total).
- Artifacts: no retained test artifacts; attestation fixtures use isolated
  `mkdtemp(tmpdir())` directories and `afterEach` cleanup.
- Gates: typecheck passed · lint passed · format:check passed · targeted
  screenshot-privacy suite (77 passing) passed · license gate (0 rejected) passed.

Full workspace suite could not be completed in this slice: the runner hit its time limit, and unrelated exploration-driver failures were observed under parallel load — not attributed to this lane (stabilized separately).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                   | Expected disposition                                                  | Test                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| A physical local dependency cache contains 4,097 entries. | blocked — bounded inventory rejects and source artifacts are removed. | `attestation.test.ts` physical dependency-shaped traversal test |
