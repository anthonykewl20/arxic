import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '@arxic/contracts';
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

const NAVIGATION_TIMEOUT_MS = 30_000;

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
      sameElementProof: true;
      semantic: SemanticLocator;
      execution: ExecutionLocator;
    }>
  | Readonly<{
      resolved: false;
      reason: LocatorResolutionFailure;
      semantic: SemanticLocator;
      execution: ExecutionLocator;
    }>;

export type PlannedExplorationStep = Readonly<
  | { intent: string; url: string; kind: 'navigate' }
  | { intent: string; kind: 'snapshot' }
  | {
      intent: string;
      kind: 'fill';
      locator: LocatorPair;
      value: string;
      url?: string;
      /**
       * DG-08: optional FORM SCOPE for pages hosting multiple forms. When
       * present, the control locators resolve INSIDE the unique form that has
       * a field labelled `fieldLabel` and a submit button named `submitName`
       * — the same form-filter grammar the DG-09 spec generator emits. Without
       * it (every pre-existing step), resolution stays page-global and behaves
       * byte-identically.
       */
      formScope?: Readonly<{ fieldLabel: string; submitName: string }>;
    }
  | {
      intent: string;
      kind: 'click';
      locator: LocatorPair;
      url?: string;
      formScope?: Readonly<{ fieldLabel: string; submitName: string }>;
    }
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
  readonly #filledValues = new Set<string>();

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
          await page.goto(step.url, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
        } else if ((step.kind === 'fill' || step.kind === 'click') && step.url) {
          await page.goto(step.url, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
        }
        if (step.kind === 'fill' || step.kind === 'click') {
          const resolution = await this.#resolveControl(
            page,
            step.locator,
            step.formScope === undefined ? undefined : step.formScope,
          );
          locatorResolution = resolution.resolved
            ? {
                resolved: true,
                sameElementProof: resolution.sameElementProof,
                semantic: resolution.semantic,
                execution: resolution.execution,
              }
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
            // Focus can synchronously run page-controlled handlers. Re-check the exact
            // handle after that boundary so a rerender cannot turn the following native
            // action into input on the newly focused replacement control.
            await resolution.executionHandle.focus();
            if (!(await attachedToDom(resolution.executionHandle))) {
              throw new Error('Identity-checked execution element is not attached to the DOM');
            }
            if (step.kind === 'fill') {
              await resolution.executionHandle.fill(step.value, {
                timeout: this.#options.timeoutMs,
              });
              this.#filledValues.add(step.value);
            } else {
              await resolution.executionHandle.click({ timeout: this.#options.timeoutMs });
            }
          } finally {
            try {
              await resolution.executionHandle.dispose();
            } catch {
              // Cleanup must not mask the action result.
            }
          }
        }
        const capturedSnapshot = await this.#accessibilitySnapshot(page);
        const snapshot =
          this.#filledValues.size > 0
            ? redactAccessibilityValues(capturedSnapshot, this.#filledValues)
            : capturedSnapshot;
        let screenshotRef: string | undefined;
        if (this.#options.evidenceDir && this.#filledValues.size === 0) {
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
          accessibilitySnapshotSha256: sha256(stableStringify(snapshot)),
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
    this.#filledValues.clear();
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

  async #resolveControl(
    page: Page,
    pair: LocatorPair,
    scope?: Readonly<{ fieldLabel: string; submitName: string }>,
  ): Promise<ControlResolution> {
    if (!validRoleSpecification(pair.semantic)) {
      return { resolved: false, reason: 'semantic-invalid', ...pair };
    }
    if (!validRoleSpecification(pair.execution)) {
      return { resolved: false, reason: 'execution-invalid', ...pair };
    }

    // DG-08 form scope: resolve the unique scoping form first (the DG-09
    // spec generator's filter grammar); locators then resolve within it. A
    // page whose forms cannot be uniquely scoped fails closed as ambiguous.
    let root: Page | Locator = page;
    if (scope) {
      const form = page
        .locator('form')
        .filter({ has: page.getByLabel(scope.fieldLabel) })
        .filter({ has: page.getByRole('button', { name: scope.submitName, exact: true }) });
      const formCount = await form.count();
      if (formCount !== 1) {
        return { resolved: false, reason: 'semantic-ambiguous', ...pair };
      }
      root = form;
    }

    let semanticLocator: Locator;
    try {
      semanticLocator = playwrightLocator(root, pair.semantic);
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
      executionLocator = playwrightLocator(root, pair.execution);
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
      return { resolved: true, sameElementProof: true, executionHandle, ...pair };
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
      sameElementProof: true;
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

function playwrightLocator(
  root: Page | Locator,
  specification: ValidatedLocatorSpecification,
): Locator {
  switch (specification.kind) {
    case 'role':
      return root.getByRole(specification.role, {
        ...(specification.name === undefined ? {} : { name: specification.name }),
        ...(specification.exact === undefined ? {} : { exact: specification.exact }),
      });
    case 'label':
      return root.getByLabel(specification.text, {
        ...(specification.exact === undefined ? {} : { exact: specification.exact }),
      });
    case 'text':
      return root.getByText(specification.text, {
        ...(specification.exact === undefined ? {} : { exact: specification.exact }),
      });
    case 'test-id':
      return root.getByTestId(specification.id);
  }
}

async function attachedToDom(handle: ElementHandle): Promise<boolean> {
  // This is a fixed trusted-Service containment check, not generated page evaluation.
  return handle.evaluate((element) => element.isConnected);
}

function safeErrorMessage(error: unknown, sensitiveValue?: string): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  // ANSI control bytes are the exact untrusted engine delimiters this sanitizer removes.
  // eslint-disable-next-line no-control-regex
  const ansiEscapeSequence = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
  const withoutAnsi = rawMessage.replace(ansiEscapeSequence, '');
  const beforeCallLog = withoutAnsi.split('Call log:', 1)[0] ?? '';
  let sanitized = beforeCallLog.split('\n', 1)[0] ?? '';
  if (sensitiveValue !== undefined) {
    const escapedValue = JSON.stringify(sensitiveValue).slice(1, -1);
    const sensitiveFragments = [
      sensitiveValue,
      escapedValue,
      ...sensitiveValue.split(/\r?\n/),
      ...escapedValue.split(/\\[rn]/),
    ]
      .filter((fragment) => fragment.length > 0)
      .sort((left, right) => right.length - left.length);
    for (const fragment of sensitiveFragments) {
      sanitized = sanitized.replaceAll(fragment, '[REDACTED]');
    }
  }
  return sanitized.slice(0, 200) || 'browser action failed';
}

type AriaRole = Parameters<Page['getByRole']>[0];
type ValidatedLocatorSpecification =
  | Exclude<SemanticLocator | ExecutionLocator, { kind: 'role' }>
  | Readonly<{ kind: 'role'; role: AriaRole; name?: string; exact?: boolean }>;

const ARIA_ROLES = {
  alert: true,
  alertdialog: true,
  application: true,
  article: true,
  banner: true,
  blockquote: true,
  button: true,
  caption: true,
  cell: true,
  checkbox: true,
  code: true,
  columnheader: true,
  combobox: true,
  complementary: true,
  contentinfo: true,
  definition: true,
  deletion: true,
  dialog: true,
  directory: true,
  document: true,
  emphasis: true,
  feed: true,
  figure: true,
  form: true,
  generic: true,
  grid: true,
  gridcell: true,
  group: true,
  heading: true,
  img: true,
  insertion: true,
  link: true,
  list: true,
  listbox: true,
  listitem: true,
  log: true,
  main: true,
  marquee: true,
  math: true,
  menu: true,
  menubar: true,
  menuitem: true,
  menuitemcheckbox: true,
  menuitemradio: true,
  meter: true,
  navigation: true,
  none: true,
  note: true,
  option: true,
  paragraph: true,
  presentation: true,
  progressbar: true,
  radio: true,
  radiogroup: true,
  region: true,
  row: true,
  rowgroup: true,
  rowheader: true,
  scrollbar: true,
  search: true,
  searchbox: true,
  separator: true,
  slider: true,
  spinbutton: true,
  status: true,
  strong: true,
  subscript: true,
  superscript: true,
  switch: true,
  tab: true,
  table: true,
  tablist: true,
  tabpanel: true,
  term: true,
  textbox: true,
  time: true,
  timer: true,
  toolbar: true,
  tooltip: true,
  tree: true,
  treegrid: true,
  treeitem: true,
} satisfies Record<AriaRole, true>;

function validRoleSpecification(
  specification: SemanticLocator | ExecutionLocator,
): specification is ValidatedLocatorSpecification {
  if (specification.kind !== 'role') return true;
  return hasOwn(ARIA_ROLES, specification.role);
}

function hasOwn<ObjectType extends object>(
  value: ObjectType,
  key: PropertyKey,
): key is keyof ObjectType {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function strictModeViolation(error: unknown): boolean {
  return /strict mode violation/i.test(error instanceof Error ? error.message : String(error));
}

function invalidSelector(error: unknown): boolean {
  return /InvalidSelectorError|error while parsing selector|unknown engine|unexpected token|unknown role/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

function redactAccessibilityValues(
  node: AccessibilityNode,
  filledValues: ReadonlySet<string>,
): AccessibilityNode {
  const sensitiveValues = [...filledValues]
    .flatMap((filledValue) => [filledValue, ...filledValue.split(/\r?\n/)])
    .filter((filledValue) => filledValue.length > 0)
    .sort((left, right) => right.length - left.length);
  const scrub = (value: string): string => {
    let scrubbed = value;
    for (const filledValue of sensitiveValues)
      scrubbed = scrubbed.replaceAll(filledValue, '[REDACTED]');
    return scrubbed;
  };
  const scrubNode = (current: AccessibilityNode): AccessibilityNode => {
    // Numeric AX values (Chrome reports <input type="number"> as a spinbutton with a
    // numeric value) carry credentials too — TOTP/PIN/OTP codes — so the containment
    // check is type-agnostic: any string|number value whose string form contains a
    // filled value is dropped. Benign numerics (a slider at 50) only drop when a
    // filled value actually matches, which can only happen after a fill this session.
    const valueAsString =
      typeof current.value === 'string' || typeof current.value === 'number'
        ? String(current.value)
        : undefined;
    const valueContainsFilledValue =
      valueAsString !== undefined &&
      sensitiveValues.some((filledValue) => valueAsString.includes(filledValue));
    return {
      role: current.role,
      ...(current.name ? { name: scrub(current.name) } : {}),
      ...(!valueContainsFilledValue && current.value !== undefined ? { value: current.value } : {}),
      ...(current.description ? { description: scrub(current.description) } : {}),
      ...(current.children ? { children: current.children.map(scrubNode) } : {}),
    };
  };
  return scrubNode(node);
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
