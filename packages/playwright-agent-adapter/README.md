# @arxic/playwright-agent-adapter

M0-09 proves Playwright Test's process-backed agent seam and a deterministic direct-test fallback. `@playwright/test` is pinned exactly to `1.62.1`: the MCP command and tool schemas are a compatibility seam, so semver drift must not enter without deliberate contract re-baselining.

Install Chromium once before integration tests:

```sh
pnpm --filter @arxic/playwright-agent-adapter exec playwright install chromium
```

## Seams and layering

`protocol.ts` is the service capability block for newline-delimited JSON-RPC over an argument-array-only, no-shell stdio child process. `handshake.ts` owns the pinned engine contract. `fallback-generator.ts` owns deterministic Workflow IR translation and direct CLI execution. `adapter.ts` is Actions-style orchestration: it negotiates capabilities, fails closed, translates list/run calls, and classifies diagnostics. `heal-policy.ts` is Actions policy because origin and action-class boundaries are product decisions.

The service boundary always returns structured results. Process, timeout, protocol, schema, workflow, and runner failures do not throw across that boundary.

## Pinned handshake contract

The tool contract was transcribed from Playwright 1.62.1 upstream source (Apache-2.0).

| Tool                   | Required `inputSchema.properties` keys   |
| ---------------------- | ---------------------------------------- |
| `planner_setup_page`   | `project`, `seedFile`                    |
| `planner_submit_plan`  | `overview`, `suites`                     |
| `planner_save_plan`    | `overview`, `suites`, `name`, `fileName` |
| `generator_setup_page` | `plan`, `project`, `seedFile`            |
| `generator_read_log`   | none                                     |
| `generator_write_test` | `fileName`, `code`                       |
| `test_list`            | none                                     |
| `test_run`             | `locations`, `projects`                  |
| `test_debug`           | `test`                                   |

The server name must be `Playwright Test Runner`. Any missing tool, added/removed schema key, or server-name drift fails closed. `REQUIRED_TOOLS` plus `contract-gate.test.ts` is the ADR §23.14 upgrade contract: an engine upgrade cannot pass until this baseline is intentionally reviewed and changed.

## Healer override

Arxic never accepts `skip`, `fixme`, `only`, deleted assertions, the explicit pass-through matchers `toBeTruthy`/`toBeDefined` or `expect(true).toBe(true)`, quarantine language, an origin outside the allowlist, or destructive/external-side-effect action classes. This deliberately overrides the upstream healer behavior that permits `fixme`. Locator-only swaps with the same assertion count and unchanged boundaries are accepted (ADR §13.1).

## Fallback mapping

`generateSpecFromWorkflow` first validates the frozen Workflow IR. For each required transition, it maps the `from` state to a kebab-case path (`login-page` → `/login`), maps each `action.inputRefs` entry to its accessible label and an `ARXIC_INPUT_<REF>` environment variable, submits through a semantic button locator, and maps assertion intents prefixed by `url:` or `text:` to literal Playwright assertions. Other assertion intents become body-text checks. Each transition emits a named screenshot; config enables Chromium, headless execution, one worker, and retained failure traces. Invalid IR emits no spec.

`runFallback` invokes the pinned CLI with argument arrays, first with `test --list` and then `test`. A successful runtime result is `observed`, never `verified` (ADR §2).

## ADR §7.3 requirements

1. Exact engine pin: `package.json`.
2. No shell interpolation: `protocol.ts` and `fallback-generator.ts`.
3. Startup capability handshake: `adapter.ts` and `handshake.ts`.
4. Arxic-to-agent translation: `adapter.ts`.
5. Fail closed on seam drift: `handshake.ts`.
6. Direct Playwright fallback: `fallback-generator.ts`.
7. Upgrade gate: `contract-gate.test.ts`.
