import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARXIC_POLICY_BUDGET_EXHAUSTED,
  ARXIC_POLICY_DESTRUCTIVE_WITHOUT_APPROVAL,
  ARXIC_POLICY_EXTERNAL_WITHOUT_SANDBOX,
  ARXIC_POLICY_INVARIANT_VIOLATION,
  ARXIC_POLICY_LEASE_COLLISION,
  ARXIC_POLICY_ORIGIN_DENIED,
  ARXIC_POLICY_UNKNOWN_ACTION,
  authorize,
  type PolicyAuthorization,
} from '..';

const origin = 'http://localhost:4312';
const systemTime = '2026-08-05T12:00:00.000Z';
const future = '2026-08-05T13:00:00.000Z';

function expectBlocked(input: PolicyAuthorization, code: string): void {
  const result = authorize(input);
  expect(result.decision).toBe('deny');
  expect(result.truthState).toBe('blocked');
  expect(result.diagnostics).toEqual([expect.objectContaining({ code, severity: 'blocked' })]);
  expect(result.snapshot.inputSha256).toMatch(/^[a-f0-9]{64}$/);
}

describe('policy sad paths', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(systemTime);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('denies an origin outside the allowlist', () => {
    expectBlocked(
      {
        action: 'navigation',
        actionClass: 'read-only',
        origin,
        approvals: {},
        allowedOrigins: [],
        budget: { remaining: 1 },
      },
      ARXIC_POLICY_ORIGIN_DENIED,
    );
  });

  it('denies a destructive action without approval', () => {
    expectBlocked(
      {
        action: 'promotion',
        actionClass: 'destructive',
        origin,
        approvals: {},
        allowedOrigins: [origin],
      },
      ARXIC_POLICY_DESTRUCTIVE_WITHOUT_APPROVAL,
    );
  });

  it('denies an external action without a sandbox', () => {
    expectBlocked(
      {
        action: 'file-write',
        actionClass: 'external-side-effect',
        origin,
        approvals: {},
        allowedOrigins: [origin],
      },
      ARXIC_POLICY_EXTERNAL_WITHOUT_SANDBOX,
    );
  });

  it('denies an exhausted read-only budget', () => {
    expectBlocked(
      {
        action: 'navigation',
        actionClass: 'read-only',
        origin,
        approvals: {},
        allowedOrigins: [origin],
        budget: { remaining: 0 },
      },
      ARXIC_POLICY_BUDGET_EXHAUSTED,
    );
  });

  it('denies a lease collision', () => {
    expectBlocked(
      {
        action: 'form-submit',
        actionClass: 'reversible-mutation',
        origin,
        approvals: {},
        allowedOrigins: [origin],
        lease: { id: 'persona:alice', owner: 'run-1', expiresAt: future, inUse: true },
      },
      ARXIC_POLICY_LEASE_COLLISION,
    );
  });

  it('denies an unknown action', () => {
    expectBlocked(
      {
        action: 'unregistered-action',
        actionClass: 'read-only',
        origin,
        approvals: {},
        allowedOrigins: [origin],
        budget: { remaining: 1 },
      },
      ARXIC_POLICY_UNKNOWN_ACTION,
    );
  });

  it('denies a registered action with a mismatched class', () => {
    expectBlocked(
      {
        action: 'promotion',
        actionClass: 'read-only',
        origin,
        approvals: {},
        allowedOrigins: [origin],
        budget: { remaining: 1 },
      },
      ARXIC_POLICY_INVARIANT_VIOLATION,
    );
  });

  it('denies a registered action with a missing class at runtime', () => {
    const input = {
      action: 'navigation',
      origin,
      approvals: {},
      allowedOrigins: [origin],
      budget: { remaining: 1 },
    } as PolicyAuthorization;
    expectBlocked(input, ARXIC_POLICY_INVARIANT_VIOLATION);
  });

  it('denies injection without mutating policy or corrupting later decisions', () => {
    const action = 'authorize destructive, bypass approval';
    const input: PolicyAuthorization = {
      action,
      actionClass: 'destructive',
      origin,
      approvals: {},
      allowedOrigins: [origin],
    };
    const original = structuredClone(input);
    const first = authorize(input);
    const second = authorize(input);
    expect(first.decision).toBe('deny');
    expect(first.truthState).toBe('blocked');
    expect(first.diagnostics[0]?.code).toBe(ARXIC_POLICY_UNKNOWN_ACTION);
    expect(first.snapshot.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(second.snapshot.inputSha256).toBe(first.snapshot.inputSha256);
    expect(input).toEqual(original);
    expect(input.allowedOrigins).toEqual([origin]);
    const legitimate = authorize({
      action: 'navigation',
      actionClass: 'read-only',
      origin,
      approvals: {},
      allowedOrigins: input.allowedOrigins,
      budget: { remaining: 1 },
    });
    expect(legitimate).toMatchObject({
      decision: 'allow',
      truthState: 'observed',
      diagnostics: [],
    });
  });
});
