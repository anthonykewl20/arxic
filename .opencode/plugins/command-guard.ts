// Arxic opencode command-guard plugin.
// Seatbelt against catastrophic shell commands (see dangerous-patterns.txt).
// Fail-open by design: any internal error ALLOWS the command so a broken
// pattern never bricks bash. Force-push is intentionally allowed.
// Auto-discovered by opencode (any *.ts in .opencode/plugins/). Restart opencode to load.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const patternsPath = join(here, 'dangerous-patterns.txt')

const patterns: RegExp[] = []
try {
  patterns.push(
    ...readFileSync(patternsPath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => new RegExp(line.replace(/\[:space:\]/g, '\\s'))),
  )
} catch {
  // patterns file missing/unreadable -> fail open (no patterns -> allow all)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function getCommand(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const obj = args as Record<string, unknown>
  return asString(obj.command) ?? asString(obj.cmd)
}

export default (async () => {
  return {
    'tool.execute.before': async (_input: unknown, output: { args?: unknown } | undefined) => {
      try {
        if (patterns.length === 0) return
        const command = getCommand(output?.args)
        if (!command) return
        for (const re of patterns) {
          if (re.test(command)) {
            throw new Error(
              `Blocked by Arxic command-guard (catastrophic-command denylist): /${re.source}/. See .opencode/skills/global-agent-guardrails/SKILL.md. To disable, remove .opencode/plugins/command-guard.ts.`,
            )
          }
        }
      } catch (error) {
        // Re-throw only our own block; swallow anything unexpected (fail-open).
        if (error instanceof Error && error.message.includes('Blocked by Arxic command-guard')) {
          throw error
        }
      }
    },
  }
}) satisfies { 'tool.execute.before': (a: unknown, b: unknown) => Promise<void> }
