import { validateDiagnostic } from '@arxic/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as policyExports from '..';
import {
  ACTION_REGISTRY,
  ARXIC_POLICY_ORIGIN_DENIED,
  ARXIC_POLICY_UNKNOWN_ACTION,
  POLICY_DIAGNOSTIC_CODES,
  PolicyEngine,
  approvalKey,
  authorize,
  detectCollision,
  isPolicyDiagnosticCode,
  type LeaseState,
  type PolicyAuthorization,
} from '..';

const origin = 'http://localhost:4312';
const firstTime = '2026-08-05T12:00:00.000Z';
const secondTime = '2026-08-05T13:00:00.000Z';
const approval = {
  approver: 'security-owner@example.test',
  approvedAt: '2026-08-05T11:30:00.000Z',
  reason: 'Approved contract-gate operation',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('policy-engine contract gate', () => {
  it('loop-closes every exported policy diagnostic code', () => {
    const codes = (Object.values(policyExports) as unknown[]).filter(
      (value): value is string => typeof value === 'string' && value.startsWith('ARXIC-POLICY-'),
    );
    expect(codes.sort()).toEqual([...POLICY_DIAGNOSTIC_CODES].sort());
    for (const code of codes) {
      expect(
        validateDiagnostic({
          code,
          severity: 'blocked',
          subject: 'contract-gate',
          message: 'test',
        }),
      ).toMatchObject({ ok: true });
      expect(isPolicyDiagnosticCode(code)).toBe(true);
    }
    expect(isPolicyDiagnosticCode('ARXIC-POLICY-BOGUS')).toBe(false);
  });

  it('is deterministic except for the snapshot timestamp', () => {
    vi.useFakeTimers();
    const input: PolicyAuthorization = {
      action: 'file-write',
      actionClass: 'external-side-effect',
      origin,
      lease: { id: 'unused', owner: 'run-1', expiresAt: secondTime, inUse: false },
      approvals: {
        [approvalKey('file-write', origin)]: approval,
        z: { ...approval, reason: 'Unused approval' },
      },
      allowedOrigins: ['https://second.test', origin, origin],
      budget: { remaining: 2 },
      sandboxAdapterPresent: true,
      policyVersion: 'contract-policy-v2',
    };
    vi.setSystemTime(firstTime);
    const first = authorize(input);
    const identical = authorize(input);
    expect(identical).toEqual(first);
    vi.setSystemTime(secondTime);
    const later = authorize(input);
    expect(later).toEqual({
      ...first,
      snapshot: { ...first.snapshot, timestamp: secondTime },
    });
    expect(later.snapshot.inputSha256).toBe(first.snapshot.inputSha256);
    expect(first.snapshot.inputSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('denies unknown actions and unknown origins', () => {
    const unknownAction = authorize({
      action: 'unknown',
      actionClass: 'read-only',
      origin,
      approvals: {},
      allowedOrigins: [origin],
      budget: { remaining: 1 },
    });
    const unknownOrigin = authorize({
      action: 'navigation',
      actionClass: 'read-only',
      origin: 'https://unknown.test',
      approvals: {},
      allowedOrigins: [origin],
      budget: { remaining: 1 },
    });
    expect(unknownAction.diagnostics[0]?.code).toBe(ARXIC_POLICY_UNKNOWN_ACTION);
    expect(unknownOrigin.diagnostics[0]?.code).toBe(ARXIC_POLICY_ORIGIN_DENIED);
  });

  it('returns the decision and complete snapshot contract on every result', () => {
    const results = [
      authorize({
        action: 'navigation',
        actionClass: 'read-only',
        origin,
        approvals: {},
        allowedOrigins: [origin],
        budget: { remaining: 1 },
      }),
      authorize({
        action: 'navigation',
        actionClass: 'read-only',
        origin,
        approvals: {},
        allowedOrigins: [],
        budget: { remaining: 1 },
      }),
    ];
    for (const result of results) {
      expect(['allow', 'deny']).toContain(result.decision);
      expect(result.snapshot).toEqual({
        policyVersion: expect.any(String),
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        decision: result.decision,
        timestamp: expect.any(String),
      });
    }
  });

  it('exposes an exact frozen six-action registry', () => {
    expect(Object.isFrozen(ACTION_REGISTRY)).toBe(true);
    expect(ACTION_REGISTRY).toEqual({
      navigation: 'read-only',
      'form-submit': 'reversible-mutation',
      'fixture-change': 'reversible-mutation',
      'file-write': 'external-side-effect',
      promotion: 'destructive',
      'delete-user': 'destructive',
    });
    expect(Object.keys(ACTION_REGISTRY)).toHaveLength(6);
  });

  it('detects the first collision without mutating leases', () => {
    const leases: LeaseState[] = [
      { id: 'first', owner: 'run-1', expiresAt: secondTime, inUse: false },
      { id: 'second', owner: 'run-2', expiresAt: secondTime, inUse: true },
      { id: 'third', owner: 'run-3', expiresAt: secondTime, inUse: true },
    ];
    const original = structuredClone(leases);
    expect(detectCollision(leases)).toBe(leases[1]);
    expect(leases).toEqual(original);
    expect(detectCollision([leases[0]!])).toBeNull();
  });

  it('merges PolicyEngine config and delegates to authorization', () => {
    const config = {
      allowedOrigins: [origin],
      sandboxAdapterPresent: true,
      policyVersion: 'engine-policy-v2',
    };
    const request = {
      action: 'file-write',
      actionClass: 'external-side-effect' as const,
      origin,
      approvals: { [approvalKey('file-write', origin)]: approval },
      budget: { remaining: 1 },
    };
    const originalRequest = structuredClone(request);
    const result = new PolicyEngine(config).decide(request);
    expect(result).toMatchObject({
      decision: 'allow',
      truthState: 'observed',
      diagnostics: [],
      snapshot: { policyVersion: 'engine-policy-v2', decision: 'allow' },
    });
    expect(request).toEqual(originalRequest);
  });
});
