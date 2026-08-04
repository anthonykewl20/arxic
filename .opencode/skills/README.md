# Arxic opencode skills

Project-local opencode skills (auto-discovered from `.opencode/skills/`). They are applied **automatically** where mandated in [`AGENTS.md`](../../AGENTS.md) and the [engineering charter](../../docs/engineering-charter.md), and are invokable **on-demand** via the skill tool.

| Skill | Mode | When | Source |
|---|---|---|---|
| code-structure | automatic | every implementation/refactor — Actions vs Service layering (charter §1) | michaelshimeles/skills · code-structure |
| evidence-driven-testing | automatic | any UI/behavior verification — attach annotated recording (or Playwright trace + named screenshots in headless) + a pass/fail-per-test summary to the PR + tracker issue. Never claim a UI works without attached evidence. | michaelshimeles/skills · evidence-driven-testing |
| global-agent-guardrails | automatic (plugin) + on-demand | catastrophic-command denylist enforced by `.opencode/plugins/command-guard.ts`; this skill documents how to wire/tune it machine-wide | davidondrej/skills · ops-and-setup/global-agent-guardrails |
| remind | on-demand (`/remind`) | rewrite the last response simpler/shorter with a TLDR | davidondrej/skills · thinking-and-docs/remind |

## Catastrophic-command guard (automatic)

`.opencode/plugins/command-guard.ts` blocks catastrophic shell commands for any opencode agent working in this repo. It is **fail-open** (a broken pattern never bricks bash) and a **seatbelt, not a sandbox**. Patterns live in `.opencode/plugins/dangerous-patterns.txt`; validate with `bash .opencode/plugins/test-guard.sh` (also run in CI). **Force-push is intentionally allowed** (this repo uses it for history hygiene).

## Attribution

These skills are installed verbatim from their upstream repositories with attribution (see each `SKILL.md` footer). Confirm upstream licensing before redistributing beyond this project.

## Loading changes

After editing any skill/plugin/`opencode.json`, **restart opencode** — config is loaded once at startup and is not hot-reloaded.
