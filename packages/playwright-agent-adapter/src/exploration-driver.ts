import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '@arxic/contracts';
import { sanitizeCapturedPlaywrightTrace } from '@arxic/playwright-trace-sanitizer';
import { runAndSettleAction } from './post-action-settle';
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

/** A crawl-observed intrinsic control identity used only to narrow a semantic locator. */
export type StructuralControlConstraint = Readonly<{
  tag: 'input' | 'button';
  type: string;
}>;

/**
 * Crawl-bound form geometry for a planned control. `control` identifies the
 * control the current step drives; `submitControl` identifies the form that
 * contains the plan's submit target. Both remain optional for legacy plans.
 */
export type FormScope = Readonly<{
  fieldLabel: string;
  submitName: string;
  control?: StructuralControlConstraint;
  submitControl?: StructuralControlConstraint;
}>;

/** Crawl-label strategy that selected the semantic candidate for a driven control. */
export type LocatorResolutionStrategy =
  | 'label'
  | 'placeholder-symmetric'
  | 'label-or-placeholder-symmetric'
  | 'role'
  | 'button-text-symmetric'
  | 'role-or-button-text-symmetric'
  | 'text'
  | 'test-id';

export type LocatorResolutionDiagnostic = Readonly<{
  phase: 'form-scope' | 'semantic';
  candidateCount: number;
  strategyCounts?: readonly Readonly<{
    strategy: LocatorResolutionStrategy;
    count: number;
  }>[];
}>;

export type LocatorResolutionFailure =
  | 'semantic-ambiguous'
  | 'semantic-unresolved'
  | 'semantic-inaccessible'
  | 'semantic-invalid'
  | 'form-scope-ambiguous'
  | 'form-scope-unresolved'
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
      structuralConstraint?: StructuralControlConstraint;
      resolutionStrategy?: LocatorResolutionStrategy;
    }>
  | Readonly<{
      resolved: false;
      reason: LocatorResolutionFailure;
      semantic: SemanticLocator;
      execution: ExecutionLocator;
      structuralConstraint?: StructuralControlConstraint;
      diagnostic?: LocatorResolutionDiagnostic;
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
      formScope?: FormScope;
    }
  | {
      intent: string;
      kind: 'click';
      locator: LocatorPair;
      url?: string;
      formScope?: FormScope;
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
                ...(resolution.structuralConstraint
                  ? { structuralConstraint: resolution.structuralConstraint }
                  : {}),
                ...(resolution.resolutionStrategy
                  ? { resolutionStrategy: resolution.resolutionStrategy }
                  : {}),
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
              await runAndSettleAction(
                page,
                () => resolution.executionHandle.click({ timeout: this.#options.timeoutMs }),
                this.#options.timeoutMs,
              );
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
    scope?: FormScope,
  ): Promise<ControlResolution> {
    const constrainedPair = withStructuralConstraint(pair, scope?.control);
    if (!validRoleSpecification(pair.semantic)) {
      return { resolved: false, reason: 'semantic-invalid', ...constrainedPair };
    }
    if (!validRoleSpecification(pair.execution)) {
      return { resolved: false, reason: 'execution-invalid', ...constrainedPair };
    }
    if (
      (scope?.control && !validStructuralConstraint(scope.control)) ||
      (scope?.submitControl && !validStructuralConstraint(scope.submitControl))
    ) {
      return { resolved: false, reason: 'semantic-invalid', ...constrainedPair };
    }

    // DG-08 form scope: resolve the unique scoping form first (the DG-09
    // spec generator's filter grammar); locators then resolve within it. A
    // page whose forms cannot be uniquely scoped fails closed as ambiguous.
    let root: Page | Locator = page;
    if (scope) {
      // #301 (F-E3A): label-first with placeholder fallback — the #295
      // semantics in the exploration lane. The real directus login page has
      // zero <label> elements (its controls are placeholder-addressed), so a
      // label-only scope filter matched ZERO forms and every step failed
      // closed as ambiguous. The fallback addresses controls the same way
      // the crawl (E1) labels them; the unique-form (count === 1) gate is
      // unchanged.
      const fieldAddressed = locatorFromStrategies(
        locatorStrategies(page, { kind: 'label', text: scope.fieldLabel, exact: true }, undefined),
      );
      const form = page
        .locator('form')
        .filter({ has: fieldAddressed })
        .filter({
          has: locatorFromStrategies(
            locatorStrategies(
              page,
              { kind: 'role', role: 'button', name: scope.submitName, exact: true },
              scope.submitControl,
            ),
          ),
        });
      // #301 follow-up (campaign round 4): an SPA re-renders its form after
      // hydration — the navigate step's observation can land mid-swap, so a
      // single immediate count read 0 and every fill/submit failed closed
      // (measured on directus /admin: t0 scoped form = 0, t+300ms = 1;
      // reproduced deterministically 4/4). Wait BOUNDED for the scoped form
      // to reach exactly one — the same settle the control locators get
      // from their attach-wait — then apply the fail-closed ambiguity gate.
      let formCount = await form.count();
      if (formCount !== 1) {
        const deadline = Date.now() + this.#options.timeoutMs;
        while (formCount !== 1 && Date.now() < deadline) {
          await page.waitForTimeout(100);
          formCount = await form.count();
        }
        if (formCount !== 1) {
          return {
            resolved: false,
            reason: formCount === 0 ? 'form-scope-unresolved' : 'form-scope-ambiguous',
            diagnostic: { phase: 'form-scope', candidateCount: formCount },
            ...constrainedPair,
          };
        }
      }
      root = form;
    }

    let semanticLocator: Locator | undefined;
    let semanticStrategies: readonly LocatorStrategyEntry[] = [];
    try {
      semanticStrategies = locatorStrategies(root, pair.semantic, scope?.control);
      semanticLocator = locatorFromStrategies(semanticStrategies);
      await semanticLocator.first().waitFor({
        state: 'attached',
        timeout: this.#options.timeoutMs,
      });
    } catch (error) {
      if (invalidSelector(error)) {
        return { resolved: false, reason: 'semantic-invalid', ...constrainedPair };
      }
      if (!semanticLocator)
        return { resolved: false, reason: 'semantic-invalid', ...constrainedPair };
      const strategyCounts = await strategyCountsOf(semanticStrategies);
      if (strategyCounts?.every(({ count }) => count === 0)) {
        return {
          resolved: false,
          reason: 'semantic-unresolved',
          diagnostic: { phase: 'semantic', candidateCount: 0, strategyCounts },
          ...constrainedPair,
        };
      }
      const candidateCount = await semanticLocator.count();
      return {
        resolved: false,
        reason: candidateCount === 0 ? 'semantic-unresolved' : 'semantic-inaccessible',
        diagnostic: { phase: 'semantic', candidateCount, strategyCounts },
        ...constrainedPair,
      };
    }
    if (!semanticLocator)
      return { resolved: false, reason: 'semantic-invalid', ...constrainedPair };
    const semanticStrategyCounts = await strategyCountsOf(semanticStrategies);
    if (semanticStrategyCounts?.every(({ count }) => count === 0)) {
      return {
        resolved: false,
        reason: 'semantic-unresolved',
        diagnostic: {
          phase: 'semantic',
          candidateCount: 0,
          strategyCounts: semanticStrategyCounts,
        },
        ...constrainedPair,
      };
    }
    let semanticCount: number;
    try {
      semanticCount = await semanticLocator.count();
    } catch {
      return { resolved: false, reason: 'semantic-invalid', ...constrainedPair };
    }
    if (semanticCount !== 1) {
      return {
        resolved: false,
        reason: semanticCount === 0 ? 'semantic-unresolved' : 'semantic-ambiguous',
        diagnostic: {
          phase: 'semantic',
          candidateCount: semanticCount,
          strategyCounts: semanticStrategyCounts,
        },
        ...constrainedPair,
      };
    }
    const resolutionStrategy = selectedStrategies(
      semanticStrategies,
      semanticStrategyCounts,
      preferredStrategyFor(pair.semantic),
    )[0]?.strategy;

    let executionLocator: Locator;
    let executionStrategies: readonly LocatorStrategyEntry[];
    try {
      executionStrategies = locatorStrategies(root, pair.execution, scope?.control);
      executionLocator = locatorFromStrategies(executionStrategies);
      await executionLocator.first().waitFor({
        state: 'attached',
        timeout: this.#options.timeoutMs,
      });
    } catch (error) {
      return {
        resolved: false,
        reason: invalidSelector(error) ? 'execution-invalid' : 'execution-inaccessible',
        ...constrainedPair,
      };
    }
    let executionCount: number;
    try {
      executionCount = await executionLocator.count();
    } catch {
      return { resolved: false, reason: 'execution-invalid', ...constrainedPair };
    }
    if (executionCount !== 1) {
      return {
        resolved: false,
        reason: executionCount === 0 ? 'execution-inaccessible' : 'execution-ambiguous',
        ...constrainedPair,
      };
    }

    let semanticHandle;
    try {
      semanticHandle = await semanticLocator.elementHandle({ timeout: this.#options.timeoutMs });
    } catch (error) {
      return {
        resolved: false,
        reason: strictModeViolation(error) ? 'semantic-ambiguous' : 'semantic-inaccessible',
        ...constrainedPair,
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
        ...constrainedPair,
      };
    }
    try {
      // This trusted-Service evaluation is bounded to referential identity; it is neither
      // arbitrary generated evaluation nor locator healing (ADR-001 §13.1/§16).
      // DG-289 (#289, SURFACE-005): serialized into the page — must stay
      // serialization-safe under esbuild-family `__name` injection (see
      // pageInventoryProbe in @arxic/crawlee-adapter); the module-level
      // binding keeps any keepNames wrap outside the serialized body.
      const same = await page.evaluate(elementIdentityProbe, [semanticHandle, executionHandle]);
      if (!same) {
        await executionHandle.dispose();
        return { resolved: false, reason: 'mismatch', ...constrainedPair };
      }
      return {
        resolved: true,
        sameElementProof: true,
        executionHandle,
        ...constrainedPair,
        ...(resolutionStrategy ? { resolutionStrategy } : {}),
      };
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
      structuralConstraint?: StructuralControlConstraint;
      resolutionStrategy?: LocatorResolutionStrategy;
      executionHandle: ElementHandle;
    }>
  | Extract<LocatorResolution, { resolved: false }>;

/**
 * DG-289 (#289, SURFACE-005): the trusted referential-identity probe
 * serialized into the page by `page.evaluate`. Kept as a module-level
 * anonymous arrow with no named inner functions and no closure captures so
 * esbuild-family keepNames transforms (tsx) cannot embed an `__name` helper
 * reference inside the serialized source. Exported for the SP-1 regression
 * test, which asserts under the tsx lane that this source stays clean.
 */
export const elementIdentityProbe = (pair: readonly unknown[]): boolean => pair[0] === pair[1];

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

type LocatorStrategyEntry = Readonly<{
  strategy: LocatorResolutionStrategy;
  locator: Locator;
}>;

function locatorStrategies(
  root: Page | Locator,
  specification: ValidatedLocatorSpecification,
  constraint: StructuralControlConstraint | undefined,
): readonly LocatorStrategyEntry[] {
  const constrain = (locator: Locator): Locator => {
    if (!constraint) return locator;
    // The constraint is validated before this capability block is called. This
    // intersection narrows a semantic candidate; it never selects by ordinal.
    return locator.and(root.locator(`${constraint.tag}[type="${constraint.type}"]`));
  };
  switch (specification.kind) {
    case 'label':
      return [
        {
          strategy: 'label',
          locator: constrain(
            root
              .getByLabel(specification.text, {
                ...(specification.exact === undefined ? {} : { exact: specification.exact }),
              })
              .and(root.locator(':not([aria-label="undefined"]):not([aria-label="null"])')),
          ),
        },
        {
          strategy: 'placeholder-symmetric',
          locator: constrain(
            root.getByPlaceholder(specification.text, {
              ...(specification.exact === undefined ? {} : { exact: specification.exact }),
            }),
          ),
        },
      ];
    case 'role': {
      const role = constrain(
        root.getByRole(specification.role as AriaRole, {
          ...(specification.name === undefined ? {} : { name: specification.name }),
          ...(specification.exact === undefined ? {} : { exact: specification.exact }),
        }),
      );
      if (specification.role !== 'button' || specification.name === undefined) {
        return [{ strategy: 'role', locator: role }];
      }
      return [
        { strategy: 'role', locator: role },
        {
          // The crawl's final label fallback is button text. Some SPAs wrap a
          // button in an empty label that removes its accessible role name;
          // retain crawl↔drive symmetry over descendant text, then reapply the
          // typed button guard.
          strategy: 'button-text-symmetric',
          locator: constrain(
            root.locator('button').filter({
              hasText: textContentMatcher(specification.name, specification.exact),
            }),
          ),
        },
      ];
    }
    case 'text':
      return [
        {
          strategy: 'text',
          locator: constrain(
            root.getByText(specification.text, {
              ...(specification.exact === undefined ? {} : { exact: specification.exact }),
            }),
          ),
        },
      ];
    case 'test-id':
      return [{ strategy: 'test-id', locator: constrain(root.getByTestId(specification.id)) }];
  }
}

function locatorFromStrategies(strategies: readonly LocatorStrategyEntry[]): Locator {
  const first = strategies[0];
  if (!first) throw new Error('No semantic locator strategy was constructed');
  return strategies
    .slice(1)
    .reduce((locator, candidate) => locator.or(candidate.locator), first.locator);
}

function textContentMatcher(text: string, exact: boolean | undefined): string | RegExp {
  if (!exact) return text;
  return new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*$`, 'u');
}

async function strategyCountsOf(
  strategies: readonly LocatorStrategyEntry[],
): Promise<LocatorResolutionDiagnostic['strategyCounts']> {
  return Promise.all(
    strategies.map(async ({ strategy, locator }) => ({ strategy, count: await locator.count() })),
  );
}

function selectedStrategies(
  strategies: readonly LocatorStrategyEntry[],
  counts: LocatorResolutionDiagnostic['strategyCounts'],
  preferred: LocatorResolutionStrategy | undefined,
): readonly LocatorStrategyEntry[] {
  const preferredIndex = preferred
    ? counts?.findIndex(({ strategy, count }) => strategy === preferred && count > 0)
    : -1;
  const selectedIndex =
    preferredIndex !== undefined && preferredIndex >= 0
      ? preferredIndex
      : (counts?.findIndex(({ count }) => count > 0) ?? -1);
  return selectedIndex < 0 ? strategies : [strategies[selectedIndex]!];
}

function preferredStrategyFor(
  specification: ValidatedLocatorSpecification,
): LocatorResolutionStrategy | undefined {
  return specification.kind === 'role' && specification.role === 'button'
    ? 'button-text-symmetric'
    : undefined;
}

function withStructuralConstraint(
  pair: LocatorPair,
  constraint: StructuralControlConstraint | undefined,
): LocatorPair & Readonly<{ structuralConstraint?: StructuralControlConstraint }> {
  return constraint ? { ...pair, structuralConstraint: constraint } : pair;
}

function validStructuralConstraint(
  constraint: StructuralControlConstraint,
): constraint is StructuralControlConstraint {
  return /^(?:input|button)$/u.test(constraint.tag) && /^[A-Za-z0-9_-]+$/u.test(constraint.type);
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
