import type { Diagnostic } from '@arxic/contracts';
import {
  ARXIC_INTENT_INVALID,
  ARXIC_INTENT_ORACLE_CONFLICT,
  intentDiagnostic,
} from './diagnostics';
import { resolveAssertion } from './resolve';
import {
  INTENT_SCHEMA_VERSION,
  type EvidenceRefs,
  type IntentLineage,
  type IntentProposal,
  type IntentSpec,
  type IntentSpecInput,
  type ResolvedAssertion,
  type UnresolvedAssertion,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function evidenceRefs(value: unknown): value is EvidenceRefs {
  return (
    isRecord(value) &&
    Array.isArray(value.source) &&
    value.source.every(nonEmptyString) &&
    Array.isArray(value.runtime) &&
    value.runtime.every(nonEmptyString)
  );
}

function lineage(value: unknown): value is IntentLineage {
  return (
    isRecord(value) &&
    nonEmptyString(value.commit) &&
    nonEmptyString(value.appBuildDigest) &&
    nonEmptyString(value.fixtureSeedDigest) &&
    nonEmptyString(value.featureFlagsDigest) &&
    nonEmptyString(value.policyDigest)
  );
}

function proposal(value: unknown): value is IntentProposal {
  return (
    isRecord(value) &&
    nonEmptyString(value.id) &&
    nonEmptyString(value.intent) &&
    nonEmptyString(value.action) &&
    nonEmptyString(value.fromState) &&
    nonEmptyString(value.toState) &&
    evidenceRefs(value.evidenceRefs)
  );
}

function assertion(value: unknown): value is UnresolvedAssertion {
  return (
    isRecord(value) &&
    nonEmptyString(value.id) &&
    nonEmptyString(value.intent) &&
    nonEmptyString(value.expectedValue) &&
    Array.isArray(value.oracles) &&
    evidenceRefs(value.evidenceRefs)
  );
}

function invalid(subject: string, message: string): Diagnostic {
  return intentDiagnostic(ARXIC_INTENT_INVALID, 'blocked', subject, message);
}

export function normalizeIntentSpec(
  input: unknown,
): { ok: true; spec: IntentSpec } | { ok: false; diagnostics: readonly Diagnostic[] } {
  if (!isRecord(input)) {
    return { ok: false, diagnostics: [invalid('intent', 'Intent spec must be an object')] };
  }
  const diagnostics: Diagnostic[] = [];
  if (input.schemaVersion !== INTENT_SCHEMA_VERSION) {
    diagnostics.push(invalid('intent.schemaVersion', `Expected ${INTENT_SCHEMA_VERSION}`));
  }
  for (const field of ['id', 'domain', 'persona', 'intent'] as const) {
    if (!nonEmptyString(input[field])) {
      diagnostics.push(invalid(`intent.${field}`, `${field} must be a non-empty string`));
    }
  }
  if (!lineage(input.lineage)) {
    diagnostics.push(invalid('intent.lineage', 'All lineage fields must be non-empty strings'));
  }
  if (!evidenceRefs(input.evidenceRefs)) {
    diagnostics.push(invalid('intent.evidenceRefs', 'Evidence refs must contain string arrays'));
  }
  if (!Array.isArray(input.proposals)) {
    diagnostics.push(invalid('intent.proposals', 'Proposals must be an array'));
  } else {
    input.proposals.forEach((value, index) => {
      if (!proposal(value)) {
        diagnostics.push(
          invalid(`intent.proposals[${index}]`, 'Proposal fields and evidence refs are required'),
        );
      }
    });
  }
  if (!Array.isArray(input.assertions)) {
    diagnostics.push(invalid('intent.assertions', 'Assertions must be an array'));
  } else {
    input.assertions.forEach((value, index) => {
      if (!assertion(value)) {
        diagnostics.push(
          invalid(`intent.assertions[${index}]`, 'Assertion fields and evidence refs are required'),
        );
      }
    });
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const assertions: ResolvedAssertion[] = [];
  for (const value of input.assertions as unknown[]) {
    const unresolved = value as UnresolvedAssertion;
    const resolution = resolveAssertion(unresolved);
    if (resolution.ok) assertions.push(resolution.resolved);
    else diagnostics.push(...resolution.diagnostics);
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const acceptanceById = new Map<string, Set<string>>();
  const assertionsById = new Map<string, ResolvedAssertion[]>();
  for (const resolved of assertions) {
    const sameId = assertionsById.get(resolved.id) ?? [];
    sameId.push(resolved);
    assertionsById.set(resolved.id, sameId);
    if (resolved.kind !== 'acceptance') continue;
    const expectedValues = acceptanceById.get(resolved.id) ?? new Set<string>();
    expectedValues.add(resolved.expectedValue);
    acceptanceById.set(resolved.id, expectedValues);
  }
  for (const [id, expectedValues] of acceptanceById) {
    if (expectedValues.size > 1) {
      diagnostics.push(
        intentDiagnostic(
          ARXIC_INTENT_ORACLE_CONFLICT,
          'contradicted',
          `assertion:${id}`,
          `Acceptance assertion ${id} has conflicting expected values`,
        ),
      );
    }
  }
  for (const [id, sameId] of assertionsById) {
    if (sameId.length < 2) continue;
    const conflictingAcceptance =
      sameId.every(({ kind }) => kind === 'acceptance') &&
      new Set(sameId.map(({ expectedValue }) => expectedValue)).size > 1;
    if (!conflictingAcceptance) {
      diagnostics.push(invalid(`assertion:${id}`, 'duplicate assertion id'));
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const normalizedLineage = input.lineage as IntentLineage;
  const normalizedEvidenceRefs = input.evidenceRefs as EvidenceRefs;

  return {
    ok: true,
    spec: {
      schemaVersion: INTENT_SCHEMA_VERSION,
      id: input.id as string,
      domain: input.domain as string,
      persona: input.persona as string,
      intent: input.intent as string,
      lineage: {
        commit: normalizedLineage.commit,
        appBuildDigest: normalizedLineage.appBuildDigest,
        fixtureSeedDigest: normalizedLineage.fixtureSeedDigest,
        featureFlagsDigest: normalizedLineage.featureFlagsDigest,
        policyDigest: normalizedLineage.policyDigest,
      },
      proposals: (input.proposals as IntentProposal[]).map((value) => ({
        id: value.id,
        intent: value.intent,
        action: value.action,
        fromState: value.fromState,
        toState: value.toState,
        evidenceRefs: {
          source: [...value.evidenceRefs.source],
          runtime: [...value.evidenceRefs.runtime],
        },
      })),
      assertions,
      evidenceRefs: {
        source: [...normalizedEvidenceRefs.source],
        runtime: [...normalizedEvidenceRefs.runtime],
      },
    },
  };
}

export function buildIntentSpec(parts: Omit<IntentSpecInput, 'schemaVersion'>): IntentSpec {
  const result = normalizeIntentSpec({ ...parts, schemaVersion: INTENT_SCHEMA_VERSION });
  if (!result.ok)
    throw new Error('Cannot build an invalid IntentSpec', { cause: result.diagnostics });
  return result.spec;
}
