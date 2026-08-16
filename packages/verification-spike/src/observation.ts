// DG-03 post-action observation capture over the stage-8 exploration seam
// (`PlaywrightExplorationDriver`). The driver executes the planned action
// steps; this service then stabilizes the post-action state with a bounded
// read-only snapshot loop (the same retry semantics generated specs obtain
// from Playwright's auto-retrying `expect(...).toHaveURL`) and returns the
// stabilized URL + DOM anchors + the runtime EvidenceRef the driver recorded.
import type { Diagnostic, EvidenceRefRuntime } from '@arxic/contracts';
import { PlaywrightExplorationDriver } from '@arxic/playwright-agent-adapter';
import type {
  AccessibilityNode,
  ExplorationDriver,
  PlannedExplorationStep,
  StepObservation,
} from '@arxic/playwright-agent-adapter';
import {
  ARXIC_DG03_OBSERVATION_DRIFTED,
  ARXIC_DG03_OBSERVATION_STEP_FAILED,
  ARXIC_DG03_OBSERVATION_UNSTABLE,
  dg03Diagnostic,
} from './diagnostics';

const DEFAULT_STABILIZATION_BUDGET = 50;
const STABLE_SNAPSHOTS_REQUIRED = 2;
const MAX_HEADING_ANCHORS = 3;

export type PostActionObservation = Readonly<{
  intent: string;
  url: string;
  originDrifted: boolean;
  domSnapshotSha256: string;
  headings: readonly string[];
  evidence: EvidenceRefRuntime;
}>;

export async function capturePostActionObservation(input: {
  runId: string;
  origin: string;
  appBuildDigest?: string;
  steps: readonly PlannedExplorationStep[];
  driver?: ExplorationDriver;
  browser?: string;
  stabilizationBudget?: number;
  now?: () => string;
}): Promise<
  | { ok: true; steps: readonly PlannedExplorationStep[]; observation: PostActionObservation }
  | { ok: false; diagnostics: readonly Diagnostic[] }
> {
  if (input.steps.length === 0) {
    return {
      ok: false,
      diagnostics: [
        dg03Diagnostic(
          ARXIC_DG03_OBSERVATION_STEP_FAILED,
          'blocked',
          'observation',
          'An observation capture requires at least one planned action step',
        ),
      ],
    };
  }
  const driver = input.driver ?? new PlaywrightExplorationDriver({ headless: true });
  const ownsDriver = input.driver === undefined;
  try {
    const executed = await driver.execute(input.steps, { allowedOrigin: input.origin });
    const last = executed.observations[executed.observations.length - 1];
    if (!last) {
      return {
        ok: false,
        diagnostics: [
          dg03Diagnostic(
            ARXIC_DG03_OBSERVATION_STEP_FAILED,
            'blocked',
            input.steps[input.steps.length - 1]!.intent,
            'The exploration driver returned no observation for the final action step',
          ),
        ],
      };
    }
    if (!last.ok) {
      return {
        ok: false,
        diagnostics: [
          dg03Diagnostic(
            ARXIC_DG03_OBSERVATION_STEP_FAILED,
            'blocked',
            last.intent,
            last.error ?? 'The final exploration action step failed',
          ),
        ],
      };
    }
    if (last.originDrifted || originOf(last.url) !== originOf(input.origin)) {
      return {
        ok: false,
        diagnostics: [
          dg03Diagnostic(
            ARXIC_DG03_OBSERVATION_DRIFTED,
            'blocked',
            last.intent,
            `Post-action observation left the allowed origin: ${last.url}`,
          ),
        ],
      };
    }

    // Bounded post-action stabilization: read-only snapshots until two
    // consecutive reads agree on URL and DOM digest, or the budget is spent.
    const budget = input.stabilizationBudget ?? DEFAULT_STABILIZATION_BUDGET;
    const stabilizationKey = (snapshot: StabilizedSnapshot | undefined): string | undefined =>
      snapshot === undefined
        ? undefined
        : `${snapshot.url}\u0000${snapshot.accessibilitySnapshotSha256}`;
    let previousKey = stabilizationKey(snapshotOf(last));
    let stableCount = previousKey === undefined ? 0 : 1;
    let stabilized = previousKey === undefined ? undefined : snapshotOf(last);
    for (let sample = 0; sample < budget; sample += 1) {
      const result = await driver.execute(
        [{ intent: 'stabilize post-action state', kind: 'snapshot' }],
        { allowedOrigin: input.origin },
      );
      const observation = result.observations[0];
      if (!observation || !observation.ok) {
        return {
          ok: false,
          diagnostics: [
            dg03Diagnostic(
              ARXIC_DG03_OBSERVATION_STEP_FAILED,
              'blocked',
              'stabilize',
              observation?.error ?? 'The stabilization snapshot failed',
            ),
          ],
        };
      }
      if (observation.originDrifted || originOf(observation.url) !== originOf(input.origin)) {
        return {
          ok: false,
          diagnostics: [
            dg03Diagnostic(
              ARXIC_DG03_OBSERVATION_DRIFTED,
              'blocked',
              'stabilize',
              `Post-action observation left the allowed origin: ${observation.url}`,
            ),
          ],
        };
      }
      const current = snapshotOf(observation);
      const currentKey = stabilizationKey(current);
      if (currentKey !== undefined && currentKey === previousKey) {
        stableCount += 1;
      } else {
        stableCount = currentKey === undefined ? 0 : 1;
        previousKey = currentKey;
      }
      if (current !== undefined) stabilized = current;
      if (stableCount >= STABLE_SNAPSHOTS_REQUIRED && currentKey !== undefined) break;
    }
    if (!stabilized || stableCount < STABLE_SNAPSHOTS_REQUIRED) {
      return {
        ok: false,
        diagnostics: [
          dg03Diagnostic(
            ARXIC_DG03_OBSERVATION_UNSTABLE,
            'blocked',
            'observation',
            'The post-action state did not stabilize within the observation budget',
          ),
        ],
      };
    }

    const headings = headingAnchors(stabilized.accessibilitySnapshot);
    const browserVersion = stabilized.browserVersion ?? executed.browserVersion ?? '';
    const evidence: EvidenceRefRuntime = {
      kind: 'runtime',
      runId: input.runId,
      appBuildDigest: input.appBuildDigest ?? '',
      browser: input.browser ?? 'chromium',
      browserVersion,
      url: stabilized.url,
      timestamp: (input.now ?? (() => new Date().toISOString()))(),
      ...(stabilized.accessibilitySnapshotSha256
        ? { accessibilitySnapshotSha256: stabilized.accessibilitySnapshotSha256 }
        : {}),
    };
    return {
      ok: true,
      steps: input.steps,
      observation: {
        intent: last.intent,
        url: stabilized.url,
        originDrifted: false,
        domSnapshotSha256: stabilized.accessibilitySnapshotSha256 ?? '',
        headings,
        evidence,
      },
    };
  } finally {
    if (ownsDriver) {
      try {
        await driver.close();
      } catch {
        // Cleanup must not mask the capture result; a failed close leaves no
        // evidence the caller depends on.
      }
    }
  }
}

type StabilizedSnapshot = Readonly<{
  url: string;
  browserVersion?: string;
  accessibilitySnapshot?: AccessibilityNode;
  accessibilitySnapshotSha256?: string;
}>;

function snapshotOf(observation: StepObservation): StabilizedSnapshot | undefined {
  if (!observation.accessibilitySnapshotSha256 || !observation.accessibilitySnapshot) {
    return undefined;
  }
  return {
    url: observation.url,
    ...(observation.browserVersion ? { browserVersion: observation.browserVersion } : {}),
    accessibilitySnapshot: observation.accessibilitySnapshot,
    accessibilitySnapshotSha256: observation.accessibilitySnapshotSha256,
  };
}

function headingAnchors(node: AccessibilityNode | undefined): string[] {
  if (!node) return [];
  const headings: string[] = [];
  const visit = (current: AccessibilityNode): void => {
    if (current.role === 'heading' && typeof current.name === 'string' && current.name.trim()) {
      headings.push(current.name.trim());
    }
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return headings.slice(0, MAX_HEADING_ANCHORS);
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
