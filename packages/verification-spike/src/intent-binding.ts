// DG-03 IntentSpec binding (ADR-008 Decision 7 + ADR-004 provenance). Binds
// observation-derived assertions into an IntentSpecInput and delegates ALL
// provenance decisions to the real @arxic/intent service: observed-only stays
// characterization; acceptance requires an independently linked oracle plus
// source AND runtime evidence. This module never decides a truth state.
import { canonicalJson, sha256 } from '@arxic/contracts';
import type { EvidenceRefRuntime } from '@arxic/contracts';
import {
  INTENT_SCHEMA_VERSION,
  type IntentLineage,
  type IntentProposal,
  type IntentSpecInput,
  type OracleSpec,
} from '@arxic/intent';
import type { DerivedAssertion } from './derive-assertions';

export type ObservationBindingInput = Readonly<{
  specIdentity: Readonly<{ id: string; domain: string; persona: string; intent: string }>;
  lineage: IntentLineage;
  sourceEvidence: readonly string[];
  proposals: readonly IntentProposal[];
  derived: readonly DerivedAssertion[];
  /** Opaque id of the runtime EvidenceRef captured for the post-action observation. */
  runtimeEvidenceId: string;
  /**
   * Oracle linked to every derived assertion. The caller chooses provenance:
   * `{ kind: 'observed-only' }` (characterization) or an independent oracle
   * (domain-rule / repository-specification / human-approved) for acceptance.
   */
  oracle: OracleSpec;
}>;

export function observationDerivedIntentSpec(input: ObservationBindingInput): IntentSpecInput {
  return {
    schemaVersion: INTENT_SCHEMA_VERSION,
    id: input.specIdentity.id,
    domain: input.specIdentity.domain,
    persona: input.specIdentity.persona,
    intent: input.specIdentity.intent,
    lineage: input.lineage,
    proposals: [...input.proposals],
    assertions: input.derived.map((assertion, index) => ({
      id: `${input.specIdentity.id}:derived:${index}`,
      intent: assertion.intent,
      expectedValue: assertion.expectedValue,
      oracles: [input.oracle],
      evidenceRefs: {
        source: [...input.sourceEvidence],
        runtime: [input.runtimeEvidenceId],
      },
    })),
    evidenceRefs: {
      source: [...input.sourceEvidence],
      runtime: [input.runtimeEvidenceId],
    },
  };
}

/**
 * Deterministic opaque id for a captured runtime EvidenceRef (ADR-002: opaque
 * ids resolved by evidence/index.json). Stable for identical evidence content.
 */
export function runtimeEvidenceIdFor(evidence: EvidenceRefRuntime): string {
  const digest = sha256(
    canonicalJson([
      evidence.runId,
      evidence.appBuildDigest,
      evidence.browser,
      evidence.browserVersion,
      evidence.url,
      evidence.accessibilitySnapshotSha256 ?? '',
    ]),
  );
  return `dg03-run:${digest.slice(0, 16)}`;
}
