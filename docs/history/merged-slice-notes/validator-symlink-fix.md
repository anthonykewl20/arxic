# validator-symlink-fix — staged doc updates (charter §10.2)

Issue: #329 · PR: #<N> · Disposition: <verified | contradicted | blocked | mixed>

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
N/A — integrator-owned
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
N/A — integrator-owned
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### <added|changed|fixed|security|internal>`

```text
N/A — integrator-owned
```

## 4. `VERSION` bump required?

no

## 5. Evidence pointers

- Real-world proof: `packages/intent-proposal-spike/src/__tests__/real-model.test.ts` — filesystem traversal regression tests.
- Artifacts: DG-12 evidence tree used for baseline reproduction.
- Gates: typecheck ☐ · lint ☐ · format ☐ · test (☐) ☐ · license gate ☐

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                | Expected disposition | Test                                                  |
| ---------------------- | -------------------- | ----------------------------------------------------- |
| Directory symlink loop | blocked              | `validator symlink loop terminates with a diagnostic` |
