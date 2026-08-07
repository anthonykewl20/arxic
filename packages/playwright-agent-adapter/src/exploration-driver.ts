import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from '@playwright/test';

export type ExplorationStepKind = 'navigate' | 'snapshot';

export type PlannedExplorationStep = Readonly<{
  intent: string;
  url: string;
  kind: ExplorationStepKind;
}>;

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
      try {
        if (step.kind === 'navigate') {
          await page.goto(step.url, { waitUntil: 'load', timeout: this.#options.timeoutMs });
        }
        const snapshot = await this.#accessibilitySnapshot(page);
        let screenshotRef: string | undefined;
        if (this.#options.evidenceDir) {
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
          ...(screenshotRef ? { screenshotRef } : {}),
          ...(browserVersion ? { browserVersion } : {}),
        });
      } catch (error) {
        const finalUrl = page.url() || step.url;
        observations.push({
          intent: step.intent,
          url: finalUrl,
          ok: false,
          originDrifted: originOf(finalUrl) !== allowedOrigin,
          ...(browserVersion ? { browserVersion } : {}),
          error: error instanceof Error ? error.message : String(error),
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
    if (tracingStarted && context && this.#options.evidenceDir) {
      try {
        await context.tracing.stop({
          path: join(this.#options.evidenceDir, 'exploration-trace.zip'),
        });
      } catch {
        // Closing must remain best-effort even when trace persistence fails.
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
    if (!this.#page) this.#page = await this.#context.newPage();
    return this.#page;
  }

  async #accessibilitySnapshot(page: Page): Promise<AccessibilityNode> {
    if (!this.#cdp) this.#cdp = await page.context().newCDPSession(page);
    const response = (await this.#cdp.send('Accessibility.getFullAXTree')) as {
      nodes: readonly CdpAccessibilityNode[];
    };
    return accessibilityTree(response.nodes);
  }
}

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
  const normalize = (node: CdpAccessibilityNode): AccessibilityNode => {
    const children = (node.childIds ?? [])
      .map((id) => byId.get(id))
      .filter((child): child is CdpAccessibilityNode => child !== undefined && !child.ignored)
      .map(normalize);
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
