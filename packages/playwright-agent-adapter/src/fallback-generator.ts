import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Diagnostic, TruthState, Workflow } from '@arxic/contracts';
import { validateWorkflow } from '@arxic/contracts';
import { screenshotPrivacyRuntimeSource } from '@arxic/playwright-screenshot-privacy';
import { chromium } from '@playwright/test';
import {
  ARXIC_AGENT_FALLBACK_FAILED,
  ARXIC_AGENT_WORKFLOW_INVALID,
  agentDiagnostic,
} from './diagnostics';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

function resolveCliPath(): string {
  try {
    return require.resolve('@playwright/test/cli.js');
  } catch {
    return require.resolve('@playwright/test/cli');
  }
}

export type GeneratedFallback = {
  ok: boolean;
  specPath?: string;
  configPath?: string;
  runtimePath?: string;
  spec?: string;
  config?: string;
  diagnostics: Diagnostic[];
};
export type FallbackRunResult = {
  listed: number;
  passed: number;
  failed: number;
  output: string;
  disposition: TruthState;
  diagnostics: Diagnostic[];
};

export async function generateSpecFromWorkflow(
  workflow: Workflow,
  target: { origin: string; testDir: string },
): Promise<GeneratedFallback> {
  const validated = validateWorkflow(workflow);
  if (!validated.ok) {
    return {
      ok: false,
      diagnostics: [
        agentDiagnostic(
          ARXIC_AGENT_WORKFLOW_INVALID,
          workflow.id ?? 'workflow',
          `Workflow IR is invalid: ${validated.diagnostics.map((item) => item.message).join('; ')}`,
        ),
      ],
    };
  }
  try {
    const spec = renderFallbackSpec(validated.value, target.origin);
    const config = renderFallbackConfig();
    const specPath = join(target.testDir, 'workflow.spec.ts');
    const configPath = join(target.testDir, 'playwright.config.ts');
    const runtimePath = join(target.testDir, 'screenshot-privacy.ts');
    await mkdir(target.testDir, { recursive: true });
    await ensurePlaywrightModule(target.testDir);
    await Promise.all([
      writeFile(specPath, spec),
      writeFile(configPath, config),
      writeFile(runtimePath, screenshotPrivacyRuntimeSource()),
    ]);
    return { ok: true, specPath, configPath, runtimePath, spec, config, diagnostics: [] };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        agentDiagnostic(
          ARXIC_AGENT_FALLBACK_FAILED,
          workflow.id,
          error instanceof Error ? error.message : String(error),
        ),
      ],
    };
  }
}

export async function runFallback({ testDir }: { testDir: string }): Promise<FallbackRunResult> {
  let listOutput = '';
  try {
    const cliPath = resolveCliPath();
    await ensurePlaywrightModule(testDir);
    const listed = await execute(process.execPath, [cliPath, 'test', '--list'], {
      cwd: testDir,
      env: process.env,
      timeout: 120_000,
    });
    listOutput = `${listed.stdout}${listed.stderr}`;
  } catch (error) {
    return failedFallback(error, listOutput);
  }
  try {
    const cliPath = resolveCliPath();
    const run = await execute(process.execPath, [cliPath, 'test'], {
      cwd: testDir,
      env: process.env,
      timeout: 120_000,
    });
    const output = `${listOutput}${run.stdout}${run.stderr}`;
    return {
      listed: count(output, /Listing tests:|Total:\s*(\d+) test/gu),
      passed: count(output, /(\d+) passed/gu),
      failed: 0,
      output,
      disposition: 'observed',
      diagnostics: [],
    };
  } catch (error) {
    return failedFallback(error, listOutput);
  }
}

export async function installedChromiumVersion(): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    return browser.version();
  } finally {
    await browser.close();
  }
}

async function ensurePlaywrightModule(testDir: string): Promise<void> {
  const packageRoot = dirname(require.resolve('@playwright/test/package.json'));
  const scope = join(testDir, 'node_modules', '@playwright');
  const destination = join(scope, 'test');
  await mkdir(scope, { recursive: true });
  try {
    await symlink(packageRoot, destination, 'dir');
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST')
      throw error;
  }
}

// #379 (mirrors #366 in the playwright-compiler spec generator): roles a
// role-qualified text assertion (`text@<role>:<text>`) may bind to. The
// observation lanes derive heading anchors only, so `heading` is the one
// role with derivation-side evidence. Anything else fails closed at
// generation instead of emitting a locator that can never resolve.
const TEXT_ASSERTION_ROLES: ReadonlySet<string> = new Set(['heading']);

export function renderFallbackSpec(workflow: Workflow, origin: string): string {
  const lines = [
    "import { test, expect } from '@playwright/test';",
    "import { capturePolicyScreenshot } from './screenshot-privacy';",
    '',
    `test(${JSON.stringify(workflow.id)}, async ({ page }) => {`,
  ];
  for (const transition of workflow.transitions.filter((item) => item.required !== false)) {
    const path = statePath(transition.from);
    lines.push(
      `  await test.step(${JSON.stringify(`${transition.from} -> ${transition.to}`)}, async () => {`,
    );
    lines.push(`    await page.goto(${JSON.stringify(new URL(path, origin).href)});`);
    for (const [name, reference] of Object.entries(transition.action.inputRefs ?? {})) {
      lines.push(
        `    await page.getByLabel(${JSON.stringify(label(name))}).fill(process.env[${JSON.stringify(environmentName(reference))}] ?? '');`,
      );
    }
    if (Object.keys(transition.action.inputRefs ?? {}).length > 0)
      lines.push("    await page.getByRole('button', { name: /submit|login|continue/i }).click();");
    for (const assertion of transition.assertions) {
      if (assertion.intent.startsWith('url:')) {
        const expected = assertion.intent.slice(4).trim();
        lines.push(
          `    await expect(page).toHaveURL(${JSON.stringify(new URL(expected, origin).href)});`,
        );
      } else if (isRoleQualifiedText(assertion.intent)) {
        // #379: role-qualified text assertions scope the locator by the
        // observed role so pages where a heading and a control share the
        // EXACT full text (the real reference-auth-app /login renders
        // <h1>Login</h1> + <button>Login</button>) resolve one element
        // instead of strict-mode-violating on two.
        const roleQualified = /^text@([a-z]+):(.*)$/su.exec(assertion.intent);
        const [, role, rawText] = roleQualified ?? [];
        const expected = rawText?.trim() ?? '';
        if (!expected || !TEXT_ASSERTION_ROLES.has(role ?? ''))
          throw new Error(
            `Unsupported text assertion intent: ${assertion.intent} (role outside the allowed set or empty text)`,
          );
        // The role is allowlist-validated lowercase ([a-z]+), so it inlines
        // safely as a single-quoted literal — matching the spec generator's
        // role-locator emissions.
        lines.push(
          `    await expect(page.getByRole('${role}', { name: ${JSON.stringify(expected)}, exact: true })).toBeVisible();`,
        );
      } else if (assertion.intent.startsWith('text:')) {
        const expected = assertion.intent.slice(5).trim();
        if (!expected)
          throw new Error(`Unsupported text assertion intent: ${assertion.intent} (empty text)`);
        // Exact matching (#379): unscoped substring getByText resolves every
        // element CONTAINING the text — a render race then fails strict mode
        // (or passes spuriously against still-mounted pre-navigation DOM).
        lines.push(
          `    await expect(page.getByText(${JSON.stringify(expected)}, { exact: true })).toBeVisible();`,
        );
      } else {
        lines.push(
          `    await expect(page.locator('body')).toContainText(${JSON.stringify(assertion.intent)});`,
        );
      }
    }
    lines.push(
      `    await capturePolicyScreenshot(page, ${JSON.stringify(`artifacts/${transition.to}.png`)});`,
    );
    lines.push('  });');
  }
  lines.push('});', '');
  return lines.join('\n');
}

export function renderFallbackConfig(): string {
  return [
    "import { defineConfig } from '@playwright/test';",
    '',
    "export default defineConfig({ testDir: '.', workers: 1, use: { browserName: 'chromium', headless: true, trace: 'retain-on-failure' } });",
    '',
  ].join('\n');
}

function isRoleQualifiedText(intent: string): boolean {
  return /^text@[a-z]+:/u.test(intent);
}

function statePath(state: string): string {
  const normalized = state.replace(/-(?:page|form|state)$/u, '').replace(/^home$/u, '');
  return normalized ? `/${normalized}` : '/';
}

function label(name: string): string {
  return `${name.slice(0, 1).toUpperCase()}${name.slice(1)}`;
}

function environmentName(reference: string): string {
  return `ARXIC_INPUT_${reference.replace(/[^A-Za-z0-9]+/gu, '_').toUpperCase()}`;
}

function count(output: string, pattern: RegExp): number {
  const matches = [...output.matchAll(pattern)];
  const last = matches.at(-1)?.[1];
  return last ? Number(last) : matches.length;
}

function failedFallback(error: unknown, prefix: string): FallbackRunResult {
  const detail = error instanceof Error ? error.message : String(error);
  const output = `${prefix}${extractOutput(error)}`;
  const passed = count(output, /(\d+) passed/gu);
  const parsedFailed = count(output, /(\d+) failed/gu);
  return {
    listed: count(prefix, /Listing tests:|Total:\s*(\d+) test/gu),
    passed,
    failed: parsedFailed || 1,
    output,
    disposition: 'blocked',
    diagnostics: [agentDiagnostic(ARXIC_AGENT_FALLBACK_FAILED, 'fallback', detail)],
  };
}

function extractOutput(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const value = error as { stdout?: string; stderr?: string };
  return `${value.stdout ?? ''}${value.stderr ?? ''}`;
}
