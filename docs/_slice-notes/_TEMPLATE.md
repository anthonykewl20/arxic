# <SLICE-ID> — staged doc updates (charter §10.2)

Issue: #<N> · PR: #<N> · Disposition: <verified | contradicted | blocked | mixed>

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #<N> | [<SLICE-ID>] <title> | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| <YYYY-MM-DD> | **#<N> (<SLICE-ID>) <title> DONE.** <what shipped, which engines proved it, dispositions, gate counts>. **M<x> <n>/<total>.** Next: #<next>. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### <added|changed|fixed|security|internal>`

```
- <SLICE-ID> <title> (#<N>): <Keep a Changelog entry — capability, layering, diagnostics, and the real-world proof that backs it>.
```

## 4. `VERSION` bump required?

<no | yes → 0.x.y, because the change is user-observable per RELEASES.md>

## 5. Evidence pointers

- Real-world proof: `<path/to/real-world.test.ts>` — <what real engine ran against which reference app>
- Artifacts: <screenshots / traces / run dir>
- Gates: typecheck ☐ · lint ☐ · format ☐ · test (<n> passing) ☐ · license gate ☐

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger | Expected disposition | Test |
| ------- | -------------------- | ---- |
|         |                      |      |
