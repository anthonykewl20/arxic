import { PolicyEngine } from '@arxic/policy-engine';
import { describe, expect, it } from 'vitest';
import { explorationAllowedOrigins } from '../exploration';

/**
 * DG-289 C-4 (#289, DECISION issuecomment-5360240026): config-declared
 * `target.allowedOrigins` flows into the exploration PolicyEngine origin
 * list. Fail-closed default when unset/empty: the target origin only —
 * byte-identical to the pre-wiring baseline.
 */
describe('exploration PolicyEngine origin list wiring (DG-289 C-4)', () => {
  const targetOrigin = 'http://127.0.0.1:1000';
  const declaredOrigin = 'http://127.0.0.1:2000';

  it('unset declaration yields the target origin only (fail-closed default)', () => {
    expect(explorationAllowedOrigins({ origin: targetOrigin })).toEqual([targetOrigin]);
  });

  it('empty declaration yields the target origin only', () => {
    expect(explorationAllowedOrigins({ origin: targetOrigin, allowedOrigins: [] })).toEqual([
      targetOrigin,
    ]);
  });

  it('declared origins join the target origin in the engine list, deduplicated', () => {
    expect(
      explorationAllowedOrigins({
        origin: targetOrigin,
        allowedOrigins: [targetOrigin, declaredOrigin, declaredOrigin],
      }),
    ).toEqual([targetOrigin, declaredOrigin]);
  });

  it('a real PolicyEngine constructed with the declared list admits a declared-origin action', () => {
    const engine = new PolicyEngine({
      allowedOrigins: explorationAllowedOrigins({
        origin: targetOrigin,
        allowedOrigins: [declaredOrigin],
      }),
    });
    const decision = engine.decide({
      action: 'navigation',
      actionClass: 'read-only',
      origin: declaredOrigin,
      approvals: {},
      budget: { remaining: 1 },
    });
    expect(decision.decision).not.toBe('deny');
    expect(JSON.stringify(decision)).not.toContain('ARXIC-POLICY-ORIGIN-DENIED');
  });

  it('a real PolicyEngine constructed with the fail-closed default denies a declared-origin action', () => {
    const engine = new PolicyEngine({
      allowedOrigins: explorationAllowedOrigins({ origin: targetOrigin }),
    });
    const decision = engine.decide({
      action: 'navigation',
      actionClass: 'read-only',
      origin: declaredOrigin,
      approvals: {},
      budget: { remaining: 1 },
    });
    expect(decision.decision).toBe('deny');
    expect(JSON.stringify(decision)).toContain('ARXIC-POLICY-ORIGIN-DENIED');
  });
});
