import type { Diagnostic } from '@arxic/contracts';
import {
  ARXIC_INTENT_INVALID,
  ARXIC_INTENT_ORACLE_MISSING,
  ARXIC_INTENT_SOURCE_AS_ACCEPTANCE,
  intentDiagnostic,
} from './diagnostics';
import type { AssertionKind, OracleSpec, ResolvedAssertion, UnresolvedAssertion } from './types';

const SHA256 = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validHex(value: unknown): value is string {
  return nonEmptyString(value) && SHA256.test(value);
}

function invalidOracle(message: string): { ok: false; diagnostics: readonly Diagnostic[] } {
  return {
    ok: false,
    diagnostics: [intentDiagnostic(ARXIC_INTENT_INVALID, 'blocked', 'oracle', message)],
  };
}

export function validateOracle(
  oracle: unknown,
): { ok: true; oracle: OracleSpec } | { ok: false; diagnostics: readonly Diagnostic[] } {
  if (!isRecord(oracle) || !nonEmptyString(oracle.kind)) {
    return invalidOracle('Oracle must be an object with a non-empty kind');
  }
  if (oracle.kind === 'observed-only') return { ok: true, oracle: { kind: 'observed-only' } };
  if (oracle.kind === 'domain-rule') {
    if (
      !nonEmptyString(oracle.domainPackId) ||
      !nonEmptyString(oracle.ruleId) ||
      !nonEmptyString(oracle.ruleVersion) ||
      !validHex(oracle.digest)
    ) {
      return invalidOracle('domain-rule oracle fields and hex digest are required');
    }
    return {
      ok: true,
      oracle: {
        kind: 'domain-rule',
        domainPackId: oracle.domainPackId,
        ruleId: oracle.ruleId,
        ruleVersion: oracle.ruleVersion,
        digest: oracle.digest,
      },
    };
  }
  if (oracle.kind === 'repository-specification') {
    if (
      !nonEmptyString(oracle.artifactRef) ||
      !validHex(oracle.sha256) ||
      (oracle.section !== undefined && !nonEmptyString(oracle.section))
    ) {
      return invalidOracle('repository-specification fields and hex sha256 are required');
    }
    return {
      ok: true,
      oracle: {
        kind: 'repository-specification',
        artifactRef: oracle.artifactRef,
        ...(oracle.section === undefined ? {} : { section: oracle.section }),
        sha256: oracle.sha256,
      },
    };
  }
  if (oracle.kind === 'human-approved') {
    if (
      !nonEmptyString(oracle.approver) ||
      !validHex(oracle.scopeDigest) ||
      !nonEmptyString(oracle.approvalArtifactRef) ||
      !validHex(oracle.approvalSha256)
    ) {
      return invalidOracle('human-approved fields and hex digests are required');
    }
    return {
      ok: true,
      oracle: {
        kind: 'human-approved',
        approver: oracle.approver,
        scopeDigest: oracle.scopeDigest,
        approvalArtifactRef: oracle.approvalArtifactRef,
        approvalSha256: oracle.approvalSha256,
      },
    };
  }
  return invalidOracle(`Unknown oracle kind: ${oracle.kind}`);
}

export function resolveAssertionKind(oracles: readonly OracleSpec[]): {
  kind: AssertionKind;
  diagnostics: readonly Diagnostic[];
} {
  if (oracles.length === 0) {
    return {
      kind: 'characterization',
      diagnostics: [
        intentDiagnostic(
          ARXIC_INTENT_ORACLE_MISSING,
          'blocked',
          'assertion',
          'Assertion has no oracle provenance',
        ),
      ],
    };
  }
  return {
    kind: oracles.some(({ kind }) => kind !== 'observed-only') ? 'acceptance' : 'characterization',
    diagnostics: [],
  };
}

export function resolveAssertion(
  assertion: UnresolvedAssertion,
): { ok: true; resolved: ResolvedAssertion } | { ok: false; diagnostics: readonly Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const oracles: OracleSpec[] = [];
  for (const oracle of assertion.oracles) {
    const result = validateOracle(oracle);
    if (result.ok) oracles.push(result.oracle);
    else diagnostics.push(...result.diagnostics);
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  const resolution = resolveAssertionKind(oracles);
  if (resolution.diagnostics.length > 0) {
    return { ok: false, diagnostics: resolution.diagnostics };
  }
  if (
    resolution.kind === 'acceptance' &&
    (assertion.evidenceRefs.source.length === 0 || assertion.evidenceRefs.runtime.length === 0)
  ) {
    return {
      ok: false,
      diagnostics: [
        intentDiagnostic(
          ARXIC_INTENT_SOURCE_AS_ACCEPTANCE,
          'blocked',
          `assertion:${assertion.id}`,
          'Acceptance assertions require both source and runtime evidence references',
        ),
      ],
    };
  }
  return {
    ok: true,
    resolved: {
      id: assertion.id,
      intent: assertion.intent,
      expectedValue: assertion.expectedValue,
      oracles,
      evidenceRefs: {
        source: [...assertion.evidenceRefs.source],
        runtime: [...assertion.evidenceRefs.runtime],
      },
      kind: resolution.kind,
    },
  };
}
