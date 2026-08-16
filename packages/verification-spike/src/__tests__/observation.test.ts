// DG-03 sad-path-first unit tests: post-action observation capture and
// stabilization, driven through a scripted ExplorationDriver (the same seam
// stage 8 uses). Real-Chromium proof lives in the real-world suite.
import { describe, expect, it } from 'vitest';
import type {
  ExplorationDriver,
  ExplorationDriverResult,
  PlannedExplorationStep,
  StepObservation,
} from '@arxic/playwright-agent-adapter';
import {
  ARXIC_DG03_OBSERVATION_DRIFTED,
  ARXIC_DG03_OBSERVATION_STEP_FAILED,
  ARXIC_DG03_OBSERVATION_UNSTABLE,
} from '../diagnostics';
import { capturePostActionObservation } from '../observation';

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

function snapshotObservation(
  url: string,
  heading: string,
  browserVersion = '1.62.1',
): StepObservation {
  const snapshot = {
    role: 'RootWebArea',
    children: [
      { role: 'heading', name: heading },
      { role: 'button', name: 'Log in' },
    ],
  };
  return {
    intent: 'stabilize',
    url,
    ok: true,
    originDrifted: false,
    accessibilitySnapshot: snapshot,
    accessibilitySnapshotSha256: sha256Of(snapshot),
    browserVersion,
  };
}

function sha256Of(value: unknown): string {
  const stable = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').repeat(8);
}

const steps: readonly PlannedExplorationStep[] = [
  { intent: 'open login', kind: 'navigate', url: 'http://127.0.0.1:9/login' },
];

describe('capturePostActionObservation', () => {
  it('blocks an off-origin step URL pre-flight with ZERO navigations (review P2 remediation)', async () => {
    // The browser must never navigate to an off-origin URL before the drift
    // block: page.goto happens inside driver.execute, so the gate has to fire
    // BEFORE any execute call. A counting driver proves zero navigations.
    const driver = new ScriptedDriver([
      { observations: [snapshotObservation('http://127.0.0.1:9/login', 'Log in')] },
    ]);
    const result = await capturePostActionObservation({
      runId: 'dg03-preflight-origin-escape',
      origin: 'http://127.0.0.1:9',
      steps: [
        { intent: 'open attacker page', kind: 'navigate', url: 'http://evil.example.test/login' },
      ],
      driver,
      stabilizationBudget: 4,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.code).toBe(ARXIC_DG03_OBSERVATION_DRIFTED);
      expect(result.diagnostics[0]?.severity).toBe('blocked');
      expect(result.diagnostics[0]?.message.toLowerCase()).toContain('pre-flight');
    }
    // Zero navigations: the driver was never invoked.
    expect(driver.executeCalls).toBe(0);
  });

  it('blocks an off-origin fill-step URL pre-flight with ZERO navigations', async () => {
    const driver = new ScriptedDriver([
      { observations: [snapshotObservation('http://127.0.0.1:9/login', 'Log in')] },
    ]);
    const result = await capturePostActionObservation({
      runId: 'dg03-preflight-fill-escape',
      origin: 'http://127.0.0.1:9',
      steps: [
        {
          intent: 'fill email elsewhere',
          kind: 'fill',
          url: 'https://attacker.example.test/login',
          locator: {
            semantic: { kind: 'label', text: 'Email' },
            execution: { kind: 'label', text: 'Email' },
          },
          value: 'persona@example.test',
        },
      ],
      driver,
      stabilizationBudget: 4,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe(ARXIC_DG03_OBSERVATION_DRIFTED);
    }
    expect(driver.executeCalls).toBe(0);
  });

  it('blocks an unparseable step URL pre-flight with ZERO navigations', async () => {
    const driver = new ScriptedDriver([
      { observations: [snapshotObservation('http://127.0.0.1:9/login', 'Log in')] },
    ]);
    const result = await capturePostActionObservation({
      runId: 'dg03-preflight-bad-url',
      origin: 'http://127.0.0.1:9',
      // 'http://' is unparseable even against the base (new URL throws);
      // note that a merely-garbage RELATIVE path like 'not a url' legally
      // resolves same-origin and is not a pre-flight concern.
      steps: [{ intent: 'open broken page', kind: 'navigate', url: 'http://' }],
      driver,
      stabilizationBudget: 4,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe(ARXIC_DG03_OBSERVATION_DRIFTED);
      expect(result.diagnostics[0]?.severity).toBe('blocked');
    }
    expect(driver.executeCalls).toBe(0);
  });

  it('accepts origin-relative step URLs pre-flight and proceeds to execute', async () => {
    const driver = new ScriptedDriver([
      {
        observations: [
          snapshotObservation('http://127.0.0.1:9/login', 'Log in'),
          snapshotObservation('http://127.0.0.1:9/login', 'Log in'),
        ],
      },
    ]);
    const result = await capturePostActionObservation({
      runId: 'dg03-preflight-ok',
      origin: 'http://127.0.0.1:9',
      steps: [{ intent: 'open login page', kind: 'navigate', url: '/login' }],
      driver,
      stabilizationBudget: 4,
    });
    expect(result.ok, JSON.stringify((result as { diagnostics?: unknown }).diagnostics)).toBe(true);
    expect(driver.executeCalls).toBeGreaterThan(0);
  });

  it('blocks when the final action step fails (never invents a post-action state)', async () => {
    const driver = new ScriptedDriver([
      {
        observations: [
          {
            intent: 'submit login',
            url: 'http://127.0.0.1:9/login',
            ok: false,
            originDrifted: false,
            error: 'locator resolution failed',
          },
        ],
      },
    ]);
    const result = await capturePostActionObservation({
      runId: 'dg03-step-failed',
      origin: 'http://127.0.0.1:9',
      steps,
      driver,
      stabilizationBudget: 4,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe(ARXIC_DG03_OBSERVATION_STEP_FAILED);
      expect(result.diagnostics[0]?.severity).toBe('blocked');
    }
  });

  it('blocks when the observation drifted off the allowed origin', async () => {
    const driver = new ScriptedDriver([
      {
        observations: [
          {
            intent: 'submit login',
            url: 'http://evil.example.test/dashboard',
            ok: true,
            originDrifted: true,
          },
        ],
      },
    ]);
    const result = await capturePostActionObservation({
      runId: 'dg03-drift',
      origin: 'http://127.0.0.1:9',
      steps,
      driver,
      stabilizationBudget: 4,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe(ARXIC_DG03_OBSERVATION_DRIFTED);
    }
  });

  it('blocks when the post-action state never stabilizes within the budget', async () => {
    const driver = new ScriptedDriver([
      {
        observations: [
          {
            intent: 'submit login',
            url: 'http://127.0.0.1:9/login',
            ok: true,
            originDrifted: false,
          },
        ],
      },
      {
        observations: [snapshotObservation(`http://127.0.0.1:9/dashboard?tick=1`, 'Dashboard')],
      },
      {
        observations: [snapshotObservation(`http://127.0.0.1:9/dashboard?tick=2`, 'Dashboard')],
      },
      {
        observations: [snapshotObservation(`http://127.0.0.1:9/dashboard?tick=3`, 'Dashboard')],
      },
    ]);
    const result = await capturePostActionObservation({
      runId: 'dg03-unstable',
      origin: 'http://127.0.0.1:9',
      steps,
      driver,
      stabilizationBudget: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe(ARXIC_DG03_OBSERVATION_UNSTABLE);
      expect(result.diagnostics[0]?.severity).toBe('blocked');
    }
  });

  it('captures the stabilized post-action URL and DOM anchors with a runtime EvidenceRef', async () => {
    const before = new Date('2026-01-01T00:00:00.000Z').getTime();
    const driver = new ScriptedDriver([
      {
        observations: [
          {
            intent: 'submit login',
            url: 'http://127.0.0.1:9/login',
            ok: true,
            originDrifted: false,
          },
        ],
      },
      {
        observations: [
          snapshotObservation('http://127.0.0.1:9/dashboard?tick=1', 'Loading…', '1.62.1'),
        ],
      },
      { observations: [snapshotObservation('http://127.0.0.1:9/dashboard', 'Dashboard')] },
      { observations: [snapshotObservation('http://127.0.0.1:9/dashboard', 'Dashboard')] },
    ]);
    const result = await capturePostActionObservation({
      runId: 'dg03-ok',
      origin: 'http://127.0.0.1:9',
      steps,
      driver,
      stabilizationBudget: 8,
      appBuildDigest: 'e'.repeat(64),
      now: () => new Date(before).toISOString(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toHaveLength(1);
    expect(result.observation.url).toBe('http://127.0.0.1:9/dashboard');
    expect(result.observation.headings).toEqual(['Dashboard']);
    expect(result.observation.domSnapshotSha256).toMatch(/^[0-9a-f]+$/);
    expect(result.observation.evidence.kind).toBe('runtime');
    expect(result.observation.evidence.url).toBe('http://127.0.0.1:9/dashboard');
    expect(result.observation.evidence.browserVersion).toBe('1.62.1');
    expect(result.observation.evidence.timestamp).toBe('2026-01-01T00:00:00.000Z');
  });
});
