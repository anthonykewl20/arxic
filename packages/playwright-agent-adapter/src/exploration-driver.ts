import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeCapturedPlaywrightTrace } from '@arxic/playwright-trace-sanitizer';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type ElementHandle,
  type Locator,
  type Page,
} from '@playwright/test';

export type SemanticLocator =
  | Readonly<{ kind: 'role'; role: string; name?: string; exact?: boolean }>
  | Readonly<{ kind: 'label'; text: string; exact?: boolean }>
  | Readonly<{ kind: 'text'; text: string; exact?: boolean }>;

export type ExecutionLocator =
  | Readonly<{ kind: 'test-id'; id: string }>
  | Readonly<{ kind: 'role'; role: string; name?: string; exact?: boolean }>
  | Readonly<{ kind: 'label'; text: string; exact?: boolean }>
  | Readonly<{ kind: 'text'; text: string; exact?: boolean }>;

export type LocatorPair = Readonly<{
  semantic: SemanticLocator;
  execution: ExecutionLocator;
}>;

export type LocatorResolutionFailure =
  | 'semantic-ambiguous'
  | 'semantic-inaccessible'
  | 'semantic-invalid'
  | 'execution-ambiguous'
  | 'execution-inaccessible'
  | 'execution-invalid'
  | 'mismatch';

export type LocatorResolution =
  | Readonly<{
      resolved: true;
      semantic: SemanticLocator;
      execution: ExecutionLocator;
    }>
  | Readonly<{
      resolved: false;
      reason: LocatorResolutionFailure;
      semantic: SemanticLocator;
      execution: ExecutionLocator;
    }>;

export type ExplorationStepKind = 'navigate' | 'snapshot' | 'fill' | 'click';

export type PlannedExplorationStep = Readonly<
  | { intent: string; url: string; kind: 'navigate' }
  | { intent: string; kind: 'snapshot' }
  | { intent: string; kind: 'fill'; locator: LocatorPair; value: string; url?: string }
  | { intent: string; kind: 'click'; locator: LocatorPair; url?: string }
>;

export type AccessibilityNode = Readonly<{
  role: string;
  name?: string;
  value?: string | number;
  description?: string;
  children?: readonly AccessibilityNode[];
}>;

export type StepObservation = Readonly<{
  intent: string;
  url: string;
  ok: boolean;
  originDrifted: boolean;
  accessibilitySnapshot?: AccessibilityNode;
  accessibilitySnapshotSha256?: string;
  screenshotRef?: string;
  browserVersion?: string;
  locatorResolution?: LocatorResolution;
  error?: string;
}>;

export type ExplorationDriverResult = Readonly<{
  observations: readonly StepObservation[];
  browserVersion?: string;
}>;

export interface ExplorationDriver {
  execute(
    steps: readonly PlannedExplorationStep[],
    options: Readonly<{ allowedOrigin: string }>,
  ): Promise<ExplorationDriverResult>;
  close(): Promise<void>;
}

export type PlaywrightExplorationDriverOptions = {
  headless?: boolean;
  timeoutMs?: number;
  evidenceDir?: string;
};

export class PlaywrightExplorationDriver implements ExplorationDriver {
  readonly #options: Readonly<{ headless: boolean; timeoutMs: number; evidenceDir?: string }>;
  #browser?: Browser;
  #context?: BrowserContext;
  #page?: Page;
  #cdp?: CDPSession;
  #tracingStarted = false;
  #pageContainsFilledValue = false;

  constructor(options: PlaywrightExplorationDriverOptions = {}) {
    this.#options = {
      headless: options.headless ?? true,
      timeoutMs: options.timeoutMs ?? 30_000,
      ...(options.evidenceDir ? { evidenceDir: options.evidenceDir } : {}),
    };
  }

  async execute(
    steps: readonly PlannedExplorationStep[],
    options: Readonly<{ allowedOrigin: string }>,
  ): Promise<ExplorationDriverResult> {
    const page = await this.#getPage();
    const browserVersion = this.#browser?.version();
    const allowedOrigin = new URL(options.allowedOrigin).origin;
    const observations: StepObservation[] = [];

    for (const [index, step] of steps.entries()) {
      let locatorResolution: LocatorResolution | undefined;
      try {
        if (step.kind === 'navigate') {
          await page.goto(step.url, { waitUntil: 'load', timeout: this.#options.timeoutMs });
          this.#pageContainsFilledValue = false;
        } else if ((step.kind === 'fill' || step.kind === 'click') && step.url) {
          await page.goto(step.url, { waitUntil: 'load', timeout: this.#options.timeoutMs });
          this.#pageContainsFilledValue = false;
        }
        if (step.kind === 'fill' || step.kind === 'click') {
          const resolution = await this.#resolveControl(page, step.locator);
          locatorResolution = resolution.resolved
            ? { resolved: true, semantic: resolution.semantic, execution: resolution.execution }
            : resolution;
          if (!resolution.resolved) {
            const finalUrl = page.url();
            observations.push({
              intent: step.intent,
              url: finalUrl,
              ok: false,
              originDrifted: originOf(finalUrl) !== allowedOrigin,
              locatorResolution,
              ...(browserVersion ? { browserVersion } : {}),
            });
            continue;
          }
          try {
            if (step.kind === 'fill') {
              this.#pageContainsFilledValue = true;
              await resolution.executionHandle.fill(step.value);
            } else await resolution.executionHandle.click();
          } finally {
            await resolution.executionHandle.dispose();
          }
        }
        const capturedSnapshot = await this.#accessibilitySnapshot(page);
        const snapshot = this.#pageContainsFilledValue
          ? redactAccessibilityValues(capturedSnapshot)
          : capturedSnapshot;
        let screenshotRef: string | undefined;
        if (this.#options.evidenceDir && !this.#pageContainsFilledValue) {
          const slug =
            step.intent
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '')
              .slice(0, 40) || 'step';
          const fileName = `step-${String(index).padStart(2, '0')}-${slug}.png`;
          try {
            await page.screenshot({
              path: join(this.#options.evidenceDir, fileName),
              fullPage: true,
            });
            screenshotRef = fileName;
          } catch {
            // Evidence capture is best-effort and must not change the step outcome.
          }
        }
        const finalUrl = page.url();
        observations.push({
          intent: step.intent,
          url: finalUrl,
          ok: true,
          originDrifted: originOf(finalUrl) !== allowedOrigin,
          accessibilitySnapshot: snapshot,
          accessibilitySnapshotSha256: createHash('sha256')
            .update(stableStringify(snapshot))
            .digest('hex'),
          ...(locatorResolution ? { locatorResolution } : {}),
          ...(screenshotRef ? { screenshotRef } : {}),
          ...(browserVersion ? { browserVersion } : {}),
        });
      } catch (error) {
        const finalUrl = page.url() || ('url' in step ? (step.url ?? '') : '');
        observations.push({
          intent: step.intent,
          url: finalUrl,
          ok: false,
          originDrifted: originOf(finalUrl) !== allowedOrigin,
          ...(browserVersion ? { browserVersion } : {}),
          ...(locatorResolution ? { locatorResolution } : {}),
          error: safeErrorMessage(error, step.kind === 'fill' ? step.value : undefined),
        });
      }
    }

    return { observations, ...(browserVersion ? { browserVersion } : {}) };
  }

  async close(): Promise<void> {
    const page = this.#page;
    const context = this.#context;
    const browser = this.#browser;
    const cdp = this.#cdp;
    const tracingStarted = this.#tracingStarted;
    this.#page = undefined;
    this.#context = undefined;
    this.#browser = undefined;
    this.#cdp = undefined;
    this.#tracingStarted = false;
    this.#pageContainsFilledValue = false;
    let traceFailure: Error | undefined;
    if (tracingStarted && context && this.#options.evidenceDir) {
      let temporaryTraceDirectory: string | undefined;
      const tracePath = join(this.#options.evidenceDir, 'exploration-trace.zip');
      const provenancePath = `${tracePath}.sanitization.json`;
      try {
        await Promise.all([rm(tracePath, { force: true }), rm(provenancePath, { force: true })]);
        temporaryTraceDirectory = await mkdtemp(join(tmpdir(), 'arxic-exploration-trace-'));
        const rawTracePath = join(temporaryTraceDirectory, 'trace.zip');
        await context.tracing.stop({ path: rawTracePath });
        const result = await sanitizeCapturedPlaywrightTrace({
          sourcePath: rawTracePath,
          outputPath: tracePath,
          provenancePath,
        });
        if (!result.ok) {
          traceFailure = new Error(`Exploration trace sanitization failed (${result.code})`);
        }
      } catch (error) {
        traceFailure = new Error('Exploration trace capture or sanitization failed', {
          cause: error,
        });
      } finally {
        if (temporaryTraceDirectory) {
          try {
            await rm(temporaryTraceDirectory, { recursive: true, force: true });
          } catch (error) {
            traceFailure = new Error('Exploration raw trace cleanup failed', { cause: error });
          }
        }
        if (traceFailure) {
          await Promise.all([
            rm(tracePath, { force: true }),
            rm(provenancePath, { force: true }),
          ]).catch(() => undefined);
        }
      }
    }
    try {
      if (cdp) await cdp.detach();
    } catch {
      // Closing must never mask the exploration result.
    }
    try {
      if (page && !page.isClosed()) await page.close();
    } catch {
      // Closing must never mask the exploration result.
    }
    try {
      if (context) await context.close();
    } catch {
      // Closing must never mask the exploration result.
    }
    try {
      if (browser?.isConnected()) await browser.close();
    } catch {
      // Closing must never mask the exploration result.
    }
    if (traceFailure) throw traceFailure;
  }

  async #getPage(): Promise<Page> {
    if (!this.#browser) this.#browser = await chromium.launch({ headless: this.#options.headless });
    if (!this.#context) {
      if (this.#options.evidenceDir) await mkdir(this.#options.evidenceDir, { recursive: true });
      this.#context = await this.#browser.newContext();
      if (this.#options.evidenceDir) {
        await this.#context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: false,
          title: 'arxic-exploration',
        });
        this.#tracingStarted = true;
      }
    }
    if (!this.#page) {
      this.#page = await this.#context.newPage();
      this.#page.on('framenavigated', (frame) => {
        if (frame === this.#page?.mainFrame()) this.#pageContainsFilledValue = false;
      });
    }
    return this.#page;
  }

  async #accessibilitySnapshot(page: Page): Promise<AccessibilityNode> {
    if (!this.#cdp) this.#cdp = await page.context().newCDPSession(page);
    const response = (await this.#cdp.send('Accessibility.getFullAXTree')) as {
      nodes: readonly CdpAccessibilityNode[];
    };
    return accessibilityTree(response.nodes);
  }

  async #resolveControl(page: Page, pair: LocatorPair): Promise<ControlResolution> {
    if (!validRoleSpecification(pair.semantic)) {
      return { resolved: false, reason: 'semantic-invalid', ...pair };
    }
    if (!validRoleSpecification(pair.execution)) {
      return { resolved: false, reason: 'execution-invalid', ...pair };
    }

    let semanticLocator: Locator;
    try {
      semanticLocator = playwrightLocator(page, pair.semantic);
      await semanticLocator.first().waitFor({
        state: 'attached',
        timeout: this.#options.timeoutMs,
      });
    } catch (error) {
      return {
        resolved: false,
        reason: invalidSelector(error) ? 'semantic-invalid' : 'semantic-inaccessible',
        ...pair,
      };
    }
    let semanticCount: number;
    try {
      semanticCount = await semanticLocator.count();
    } catch {
      return { resolved: false, reason: 'semantic-invalid', ...pair };
    }
    if (semanticCount !== 1) {
      return {
        resolved: false,
        reason: semanticCount === 0 ? 'semantic-inaccessible' : 'semantic-ambiguous',
        ...pair,
      };
    }

    let executionLocator: Locator;
    try {
      executionLocator = playwrightLocator(page, pair.execution);
      await executionLocator.first().waitFor({
        state: 'attached',
        timeout: this.#options.timeoutMs,
      });
    } catch (error) {
      return {
        resolved: false,
        reason: invalidSelector(error) ? 'execution-invalid' : 'execution-inaccessible',
        ...pair,
      };
    }
    let executionCount: number;
    try {
      executionCount = await executionLocator.count();
    } catch {
      return { resolved: false, reason: 'execution-invalid', ...pair };
    }
    if (executionCount !== 1) {
      return {
        resolved: false,
        reason: executionCount === 0 ? 'execution-inaccessible' : 'execution-ambiguous',
        ...pair,
      };
    }

    let semanticHandle;
    try {
      semanticHandle = await semanticLocator.elementHandle({ timeout: this.#options.timeoutMs });
    } catch (error) {
      return {
        resolved: false,
        reason: strictModeViolation(error) ? 'semantic-ambiguous' : 'semantic-inaccessible',
        ...pair,
      };
    }
    let executionHandle;
    try {
      executionHandle = await executionLocator.elementHandle({ timeout: this.#options.timeoutMs });
    } catch (error) {
      await semanticHandle.dispose();
      return {
        resolved: false,
        reason: strictModeViolation(error) ? 'execution-ambiguous' : 'execution-inaccessible',
        ...pair,
      };
    }
    try {
      // This trusted-Service evaluation is bounded to referential identity; it is neither
      // arbitrary generated evaluation nor locator healing (ADR-001 §13.1/§16).
      const same = await page.evaluate(([a, b]) => a === b, [semanticHandle, executionHandle]);
      if (!same) {
        await executionHandle.dispose();
        return { resolved: false, reason: 'mismatch', ...pair };
      }
      return { resolved: true, executionHandle, ...pair };
    } catch (error) {
      await executionHandle.dispose();
      throw error;
    } finally {
      await semanticHandle.dispose();
    }
  }
}

type ControlResolution =
  | Readonly<{
      resolved: true;
      semantic: SemanticLocator;
      execution: ExecutionLocator;
      executionHandle: ElementHandle;
    }>
  | Extract<LocatorResolution, { resolved: false }>;

type CdpValue = Readonly<{ value?: unknown }>;
type CdpAccessibilityNode = Readonly<{
  nodeId: string;
  ignored?: boolean;
  role?: CdpValue;
  name?: CdpValue;
  value?: CdpValue;
  description?: CdpValue;
  childIds?: readonly string[];
}>;

function accessibilityTree(nodes: readonly CdpAccessibilityNode[]): AccessibilityNode {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const root =
    nodes.find((node) => !node.ignored && node.role?.value === 'RootWebArea') ?? nodes[0];
  if (!root) return { role: 'RootWebArea' };
  const normalizeChildren = (node: CdpAccessibilityNode): AccessibilityNode[] =>
    (node.childIds ?? []).flatMap((id) => {
      const child = byId.get(id);
      if (!child) return [];
      return child.ignored ? normalizeChildren(child) : [normalize(child)];
    });
  const normalize = (node: CdpAccessibilityNode): AccessibilityNode => {
    const children = normalizeChildren(node);
    const role = typeof node.role?.value === 'string' ? node.role.value : 'generic';
    const name = typeof node.name?.value === 'string' ? node.name.value : undefined;
    const value = node.value?.value;
    const description =
      typeof node.description?.value === 'string' ? node.description.value : undefined;
    return {
      role,
      ...(name ? { name } : {}),
      ...(typeof value === 'string' || typeof value === 'number' ? { value } : {}),
      ...(description ? { description } : {}),
      ...(children.length > 0 ? { children } : {}),
    };
  };
  return normalize(root);
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function playwrightLocator(page: Page, specification: ValidatedLocatorSpecification): Locator {
  switch (specification.kind) {
    case 'role':
      return page.getByRole(specification.role, {
        ...(specification.name === undefined ? {} : { name: specification.name }),
        ...(specification.exact === undefined ? {} : { exact: specification.exact }),
      });
    case 'label':
      return page.getByLabel(specification.text, {
        ...(specification.exact === undefined ? {} : { exact: specification.exact }),
      });
    case 'text':
      return page.getByText(specification.text, {
        ...(specification.exact === undefined ? {} : { exact: specification.exact }),
      });
    case 'test-id':
      return page.getByTestId(specification.id);
  }
}

function safeErrorMessage(error: unknown, sensitiveValue?: string): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  if (!sensitiveValue) return rawMessage;
  // ANSI control bytes are the exact untrusted engine delimiters this sanitizer removes.
  // eslint-disable-next-line no-control-regex
  const ansiEscapeSequence = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
  const withoutAnsi = rawMessage.replace(ansiEscapeSequence, '');
  const beforeCallLog = withoutAnsi.split('Call log:', 1)[0] ?? '';
  const firstLine = (beforeCallLog.split('\n', 1)[0] ?? '').slice(0, 200);
  const escapedValue = JSON.stringify(sensitiveValue).slice(1, -1);
  const sanitized = firstLine
    .replaceAll(sensitiveValue, '[REDACTED]')
    .replaceAll(escapedValue, '[REDACTED]');
  const sensitiveFragments = [
    ...sensitiveValue.split(/\r?\n/),
    ...escapedValue.split(/\\[rn]/),
  ].filter((fragment) => fragment.length > 0);
  return sensitiveFragments.some((fragment) => sanitized.includes(fragment))
    ? 'browser action failed'
    : sanitized || 'browser action failed';
}

type AriaRole = Parameters<Page['getByRole']>[0];
type ValidatedLocatorSpecification =
  | Exclude<SemanticLocator | ExecutionLocator, { kind: 'role' }>
  | Readonly<{ kind: 'role'; role: AriaRole; name?: string; exact?: boolean }>;

const ARIA_ROLES: ReadonlySet<AriaRole> = new Set<AriaRole>([
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'generic',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'insertion',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'meter',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'navigation',
  'none',
  'note',
  'option',
  'paragraph',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'subscript',
  'superscript',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'time',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
]);

function validRoleSpecification(
  specification: SemanticLocator | ExecutionLocator,
): specification is ValidatedLocatorSpecification {
  if (specification.kind !== 'role') return true;
  // The cast is confined to this validation boundary; membership establishes the literal role.
  return ARIA_ROLES.has(specification.role as AriaRole);
}

function strictModeViolation(error: unknown): boolean {
  return /strict mode violation/i.test(error instanceof Error ? error.message : String(error));
}

function invalidSelector(error: unknown): boolean {
  return /InvalidSelectorError|error while parsing selector|unknown engine|unexpected token|unknown role/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

function redactAccessibilityValues(node: AccessibilityNode): AccessibilityNode {
  // Chrome's AX tree duplicates a control's value both as `node.value` and as descendant
  // StaticText/InlineTextBox nodes, so the whole subtree of a value-bearing node is dropped.
  const containsControlValue = node.value !== undefined;
  return {
    role: node.role,
    ...(node.name ? { name: node.name } : {}),
    ...(node.description ? { description: node.description } : {}),
    ...(!containsControlValue && node.children
      ? { children: node.children.map((child) => redactAccessibilityValues(child)) }
      : {}),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
