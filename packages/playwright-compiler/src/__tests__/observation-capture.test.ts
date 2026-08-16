// DG-09 red-first unit tests: post-action observation capture over the real
// stage-8 exploration-driver seam, productionized from the DG-03 spike. The
// pre-flight origin gate must reject off-origin step URLs BEFORE any
// navigation; stabilization must be bounded and fail closed.
import { describe, expect, it } from 'vitest';
import type {
  ExplorationDriver,
  ExplorationDriverResult,
  PlannedExplorationStep,
  StepObservation,
} from '@arxic/playwright-agent-adapter';
import {
  ARXIC_COMPILE_OBSERVATION_DRIFT,
  ARXIC_COMPILE_OBSERVATION_STEP_FAILED,
  ARXIC_COMPILE_OBSERVATION_UNSTABLE,
} from '../diagnostics';
import { capturePostActionObservation } from '../observation-capture';

class ScriptedDriver implements ExplorationDriver {
  readonly #results: readonly ExplorationDriverResult[];
  #call = 0;
  executeCalls = 0;

  constructor(results: readonly ExplorationDriverResult[]) {
    this.#results = results;
  }

  execute(): Promise<ExplorationDriverResult> {
    this.executeCalls += 1;
    const result = this.#results[Math.min(this.#call, this.#results.length - 1)];
    this.#call += 1;
    return Promise.resolve(result!);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

function snapshotObservation(url: string, heading: string): StepObservation {
  const snapshot = {
    role: 'RootWebArea',
    children: [
      { role: 'heading', name: heading },
      { role: 'button', name: 'Log in' },
    ],
  };
  const stable = JSON.stringify(snapshot);
  let hash = 0x811c9dc5;
  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return {
    intent: 'stabilize',
    url,
    ok: true,
    originDrifted: false,
    accessibilitySnapshot: snapshot,
    accessibilitySnapshotSha256: hash.toString(16).padStart(8, '0').repeat(8),
    browserVersion: '1.62.1',
  };
}

const steps: readonly PlannedExplorationStep[] = [
  { intent: 'open page', kind: 'navigate', url: 'http://127.0.0.1:9/newsletter' },
];

describe('capturePostActionObservation', () => {
  it('blocks an off-origin step URL pre-flight with ZERO navigations', async () => {
    const driver = new ScriptedDriver([
      { observations: [snapshotObservation('http://127.0.0.1:9/x', 'X')] },
    ]);
    const result = await capturePostActionObservation({
      runId: 'dg09-preflight',
      origin: 'http://127.0.0.1:9',
      steps: [
        { intent: 'open attacker page', kind: 'navigate', url: 'http://evil.example.test/x' },
      ],
      driver,
      stabilizationBudget: 4,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe(ARXIC_COMPILE_OBSERVATION_DRIFT);
      expect(result.diagnostics[0]?.severity).toBe('blocked');
    }
    expect(driver.executeCalls).toBe(0);
  });

  it('blocks when the final action step fails', async () => {
    const driver = new ScriptedDriver([
      {
        observations: [
          {
            intent: 'submit',
            url: 'http://127.0.0.1:9/newsletter',
            ok: false,
            originDrifted: false,
            error: 'boom',
          },
        ],
      },
    ]);
    const result = await capturePostActionObservation({
      runId: 'dg09-step-failed',
      origin: 'http://127.0.0.1:9',
      steps,
      driver,
      stabilizationBudget: 4,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe(ARXIC_COMPILE_OBSERVATION_STEP_FAILED);
    }
  });

  it('blocks when the post-action state never stabilizes within budget', async () => {
    const driver = new ScriptedDriver([
      {
        observations: [
          {
            intent: 'submit',
            url: 'http://127.0.0.1:9/newsletter',
            ok: true,
            originDrifted: false,
          },
        ],
      },
      { observations: [snapshotObservation('http://127.0.0.1:9/thanks?t=1', 'Subscribed')] },
      { observations: [snapshotObservation('http://127.0.0.1:9/thanks?t=2', 'Subscribed')] },
    ]);
    const result = await capturePostActionObservation({
      runId: 'dg09-unstable',
      origin: 'http://127.0.0.1:9',
      steps,
      driver,
      stabilizationBudget: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe(ARXIC_COMPILE_OBSERVATION_UNSTABLE);
    }
  });

  it('captures the stabilized post-action URL, headings, and runtime EvidenceRef', async () => {
    const before = new Date('2026-08-17T00:00:00.000Z').getTime();
    const driver = new ScriptedDriver([
      {
        observations: [
          {
            intent: 'submit',
            url: 'http://127.0.0.1:9/newsletter',
            ok: true,
            originDrifted: false,
          },
        ],
      },
      { observations: [snapshotObservation('http://127.0.0.1:9/thanks?t=1', 'Loading…')] },
      { observations: [snapshotObservation('http://127.0.0.1:9/thanks', 'Subscribed')] },
      { observations: [snapshotObservation('http://127.0.0.1:9/thanks', 'Subscribed')] },
    ]);
    const result = await capturePostActionObservation({
      runId: 'dg09-ok',
      origin: 'http://127.0.0.1:9',
      appBuildDigest: 'b'.repeat(64),
      steps,
      driver,
      stabilizationBudget: 8,
      now: () => new Date(before).toISOString(),
    });
    expect(result.ok, JSON.stringify((result as { diagnostics?: unknown }).diagnostics)).toBe(true);
    if (!result.ok) return;
    expect(result.observation.url).toBe('http://127.0.0.1:9/thanks');
    expect(result.observation.headings).toEqual(['Subscribed']);
    expect(result.observation.evidence.kind).toBe('runtime');
    expect(result.observation.evidence.url).toBe('http://127.0.0.1:9/thanks');
    expect(result.observation.evidence.accessibilitySnapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.observation.evidence.timestamp).toBe('2026-08-17T00:00:00.000Z');
  });
});
