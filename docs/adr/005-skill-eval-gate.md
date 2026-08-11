# ADR-005: Skill evaluation gate

| Field      | Value                                                                        |
| ---------- | ---------------------------------------------------------------------------- |
| Status     | Proposed (2026-08-11)                                                        |
| Decides    | A three-tier skill-evaluation model, with a prototype Tier-1 structural gate |
| Relates to | ADR-001 §15/§18, engineering-charter §§3-6 and `scripts/license-gate.mjs`    |
| Owners     | Arxic maintainers                                                            |

## Context

Arxic discovers project skills under `.opencode/skills/`, advertises them through
`AGENTS.md`, and lets an agent dispatch them through OpenCode's `skill` tool. A malformed
skill can therefore disappear from discovery, route on misleading metadata, or refer to a
skill that does not exist. The repository has process rules for skills but no executable
catalog check.

This proposal adapts, rather than installs, the design in
[`addyosmani/agent-skills`](https://github.com/addyosmani/agent-skills). Its
[`scripts/lib/skill-lint.js`](https://github.com/addyosmani/agent-skills/blob/main/scripts/lib/skill-lint.js)
separates pure content rules from filesystem orchestration, while
[`evals/README.md`](https://github.com/addyosmani/agent-skills/blob/main/evals/README.md)
defines structural, routing, and behavioral tiers. The upstream project is MIT-licensed.
The prototype is an Arxic-native adaptation; it does not install or execute upstream code.

## Decision

### 1. Adopt a three-tier evaluation model

| Tier                   | Purpose                                                                       | Execution                               | Status                |
| ---------------------- | ----------------------------------------------------------------------------- | --------------------------------------- | --------------------- |
| 1. Structural          | Validate files, frontmatter, names, descriptions, exemptions, and references  | Deterministic local/CI gate, no tokens  | Prototype implemented |
| 2. Trigger and routing | Rank positive and negative prompts against descriptions and detect collisions | Deterministic CI-safe TF-IDF, no tokens | Proposed follow-up    |
| 3. Behavioral          | Run a headless agent and grade whether the skill changes behavior as promised | Opt-in because it spends tokens         | Deferred              |

Upstream Tier 2 tokenizes and lightly stems skill names and descriptions, builds a TF-IDF
corpus, ranks prompt cosine similarity, checks positive top-k and negative ownership, and
warns or errors on description collisions. Arxic would preserve those deterministic
properties but start with a four-skill catalog and route through OpenCode's `skill` tool,
not Claude Code's native skill behavior. Positive and negative prompt fixtures must be
written in user language rather than copied from descriptions.

Tier 3 would execute a skill through a headless agent in an isolated fixture and grade a
trace against explicit expectations. Its token cost and agent/provider variability make it
unsuitable for the initial mandatory gate.

### 2. Tier-1 contract

`scripts/skills-gate.mjs` follows the existing license-gate idiom: ESM exports, a
unit-testable rule core, a filesystem wrapper, a reporting action, `isMain` detection, and
`process.exitCode`. Any error fails closed with exit code 1. Warnings are reported but do
not block.

Errors are:

| Code | Blocking condition                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------- |
| E1   | A skill directory has no readable `SKILL.md`.                                                                        |
| E2   | The opening YAML frontmatter block is missing, unparseable, or not a mapping. The parser's error is retained.        |
| E3   | Frontmatter `name` is missing or differs from the directory name.                                                    |
| E4   | The directory name does not match `^[a-z0-9]+(-[a-z0-9]+)*$`.                                                        |
| E5   | `description` is missing, empty, or longer than 1024 characters.                                                     |
| E6   | `description` has no affirmative “Use when/whenever/before/after/during” trigger. Negated phrases do not satisfy it. |
| E7   | Frontmatter declares `exempt` or `type: meta` without a validator-owned allowlist entry.                             |

E6 does not apply when `disable-model-invocation: true` or when a documented
validator-owned exemption names the skill. `remind` is currently allowlisted because it is
a manual `/remind` command and already sets `disable-model-invocation: true`.

Exemptions live in validator source, not skill frontmatter. This makes a policy exception a
reviewable gate change with a reason; allowing a skill to declare its own exemption would
let the artifact being checked disable its checker. E7 therefore fails loud on an
unallowlisted self-exemption.

Warnings are:

| Code | Advisory condition                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1   | An explicit `use the \`foo\` skill`, `follow the \`foo\` skill`, or \`foo\` skill reference names no current skill directory.                                 |
| W2   | A bare command description lacks a trigger and is neither manual nor validator-exempt; add a trigger or `disable-model-invocation: true`. E6 still blocks it. |

The prototype also advises when `## Overview` is absent. It does not require section
anatomy. A Tier-1.1 follow-up may require `Overview` and `When to Use`, then consider
`Common Rationalizations`, `Red Flags`, and `Verification` as the catalog matures. Fenced
example headings must not satisfy any future prose section check.

### 3. Parse real YAML frontmatter

Frontmatter is split from the Markdown body and parsed with the root development dependency
`yaml`, not a line parser. `evidence-driven-testing` uses a folded `description: >`, plus
`compatibility` and nested `metadata`; a one-line parser reads its description as only `>`
and invalidates trigger and length checks. The pure seam accepts an already-parsed object so
crafted tests exercise policy without filesystem or parser coupling.

### 4. Current section coverage and Tier-1.1 gap

Exact level-two headings in the four current `SKILL.md` files give this inventory:

| Skill                     | Overview | When to Use | Common Rationalizations | Red Flags | Verification |
| ------------------------- | -------- | ----------- | ----------------------- | --------- | ------------ |
| `code-structure`          | Yes      | Yes         | No                      | No        | No           |
| `evidence-driven-testing` | No       | No          | No                      | No        | No           |
| `global-agent-guardrails` | No       | No          | No                      | No        | No           |
| `remind`                  | No       | No          | No                      | No        | No           |

`global-agent-guardrails` has an `## E2E verification recipe`, but not the proposed exact
`## Verification` section. `code-structure` has `## Migration Checklist`, but that is not
counted as `## Verification`. Requiring the fuller upstream anatomy now would reject all
four current skills, so this proposal records the gap instead of disguising it.

### 5. Relationship to existing gates

The script slots alongside `scripts/license-gate.mjs`: both resolve a repository default,
separate evaluation from reporting, print counts, return structured results, and fail
closed. `scripts/skills-gate.test.mjs` mirrors the license test's sad-path-first `it.each`
style and includes a read-only integration assertion over the real four-skill catalog.

CI wiring is explicitly not part of this prototype. Maintainers must review the contract,
warning noise, exemption semantics, and dependency impact before changing this ADR to
Accepted or adding a workflow step.

## Consequences

### Positive

- Folded and nested YAML metadata is interpreted by a maintained parser.
- Deterministic failures catch catalog breakage before model-dependent routing is attempted.
- Pure parsing and policy seams support malformed fixtures without spawning the CLI.
- Validator-owned exemptions remain visible and reviewable.
- The same output and exit-code conventions apply across Arxic gates.

### Negative / risk

- Tier 1 proves structural conformance, not that OpenCode selects or follows a skill.
- Trigger matching is lexical and may reject valid prose or accept a weak trigger sentence.
- W1 recognizes only explicit reference phrases to avoid warning on arbitrary code spans.
- The `yaml` root development dependency expands the workspace dependency graph.
- Current section anatomy remains inconsistent until a migration is approved.

## Open questions / non-goals

- Tier 2 prompt cases, thresholds, rank ratchets, and collision policy are not built.
- Tier 3 fixtures, headless-agent permissions, trace handling, grading, and budgets are not built.
- There is no upstream-style `validate-commands` equivalent for `.opencode/command/`.
- CI wiring and an ADR status change are follow-ups, not prototype deliverables.
- This does not assess the quality, safety, or completeness of skill body instructions.
- OpenCode resolves this catalog through `AGENTS.md` and model invocation of the `skill`
  tool. Upstream's
  [`docs/opencode-setup.md`](https://github.com/addyosmani/agent-skills/blob/main/docs/opencode-setup.md)
  notes that invocation depends on model compliance. Tier-2 lexical routing can measure
  description separability, but observed dispatch accuracy remains model-compliance-bound.

## References

- Addy Osmani, `agent-skills/scripts/lib/skill-lint.js`: pure/wrapper lint split, trigger
  checks, validator-owned exemptions, section parsing, and dead-reference warnings.
- Addy Osmani, `agent-skills/evals/README.md`: three-tier model and evaluation case shape.
- Addy Osmani, `agent-skills/scripts/run-evals.js`: deterministic TF-IDF ranking, positive
  and negative routing checks, collision thresholds, and opt-in behavioral execution.
- Addy Osmani, `agent-skills/docs/opencode-setup.md`: `AGENTS.md`, `skill` tool dispatch,
  and the model-compliance limitation.
- Addy Osmani, `agent-skills/LICENSE`: MIT license.
- `scripts/license-gate.mjs` and `scripts/license-gate.test.mjs`: Arxic gate and test idiom.
- `.opencode/skills/*/SKILL.md`: current catalog and section inventory.
