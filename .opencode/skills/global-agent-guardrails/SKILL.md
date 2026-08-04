---
name: global-agent-guardrails
description: 'One shared denylist of catastrophic shell commands (rm -rf on / or ~, dd/mkfs, sudo rm, fork bombs, curl|sh, gh repo delete) enforced as a PreToolUse/pre-exec guard across every AI coding agent on the machine. Use when adding or tuning blocked-command patterns, wiring the guard into a new agent or a new machine, debugging why a command was (or was not) blocked, or when the user mentions command guard, guardrails, dangerous command hook, or PreToolUse safety.'
---

# Global Agent Guardrails

> **Arxic application:** this repo ships a project-level opencode plugin at `.opencode/plugins/command-guard.ts` that enforces a conservative catastrophic-command denylist (see `.opencode/plugins/dangerous-patterns.txt`) for any opencode agent working here. It is **fail-open** (a broken pattern never bricks bash) and is a **seatbelt, not a sandbox**. Force-push is intentionally ALLOWED for this repo's history hygiene. For machine-wide coverage across Cursor/Claude Code/Codex/etc., follow the wiring below.

A "bouncer" that blocks catastrophic shell commands before any AI agent runs them. One patterns file is the single source of truth; every agent reads it via a shared hook script or a tiny native adapter. It is a seatbelt against accidents, NOT a sandbox against a malicious agent (obfuscation like `python -c "shutil.rmtree(...)"` can slip past regex).

## File map

```
~/.agents/hooks/dangerous-patterns.txt   # THE denylist: one POSIX-ERE regex per line, # comments
~/.agents/hooks/deny-dangerous.sh        # shared guard: hook JSON on stdin -> exit 2 blocks
~/.agents/hooks/test-guard.sh            # test suite: run after ANY pattern change
~/.config/opencode/plugins/command-guard.ts   # OpenCode adapter (throws to block)
```

## State check (is it installed?)

```bash
ls ~/.agents/hooks/deny-dangerous.sh ~/.agents/hooks/dangerous-patterns.txt
~/.agents/hooks/test-guard.sh   # must end "failed: 0"
```

## Add or tune a pattern

1. Edit the patterns file. Write POSIX ERE (`grep -E`). Use `[[:space:]]`, never `\s` — adapters auto-convert `[:space:]` to `\s` for JS/Python.
2. Add block + allow cases to the test suite, then run it. Must pass 100%.
3. Verify the new pattern compiles in the adapter engines.
4. Changes apply instantly everywhere (all consumers re-read the file per command).

Design rule: block only irreversible/catastrophic commands (data loss, disk wipe, repo deletion, token exfil). Local-destructive-but-recoverable commands (`git status`, `git clean -fdx`, `rm -rf node_modules`) stay ALLOWED — over-blocking kills agent usefulness.

## Per-agent wiring (user-global)

| Agent | Config | Event | Blocks via |
|---|---|---|---|
| Claude Code | `~/.claude/settings.json` | `PreToolUse` matcher `Bash` | shared script, exit 2 |
| Codex CLI/app/IDE | `~/.codex/hooks.json` | `PreToolUse` matcher `Bash` | shared script, exit 2 |
| Cursor IDE + CLI | `~/.cursor/hooks.json` | `beforeShellExecution` | shared script with `cursor` arg, deny JSON |
| OpenCode | `~/.config/opencode/plugins/command-guard.ts` (or repo `.opencode/plugins/`) | `tool.execute.before` | adapter throws Error |

Hook entry shape for Claude/Codex (merge into existing `hooks` object, never overwrite):

```json
{"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "/ABSOLUTE/HOME/.agents/hooks/deny-dangerous.sh"}]}]}}
```

Use absolute paths in configs (`~` expansion is inconsistent across agents).

## Gotchas
- False-positive class: a harmless command whose ARGUMENT text contains a dangerous-looking string (e.g. passing a prompt mentioning `git push --force`) gets blocked. Workaround: put the text in a file and reference it.
- Cursor `failClosed` must stay `false` (background hosts can't run hook scripts).
- Not coverable natively on every agent; the guard is best-effort.

## E2E verification recipe

Safe probe: ask the agent to run `git push --force` from a NON-git directory — blocked = guard works; "not a git repository" = guard failed but no harm done.

Direct script test: `echo '{"tool_input":{"command":"rm -rf /"}}' | ~/.agents/hooks/deny-dangerous.sh; echo "exit=$?"` (expect exit=2).

---
*Source: [davidondrej/skills · ops-and-setup/global-agent-guardrails](https://github.com/davidondrej/skills/tree/main/skills/ops-and-setup/global-agent-guardrails). Installed verbatim with attribution; see `.opencode/skills/README.md`. Upstream license: see source repo.*
