export const INTENT_SCHEMA_VERSION = 'arxic-intent-v1' as const;

export type OracleKind =
  'domain-rule' | 'repository-specification' | 'human-approved' | 'observed-only';

export type DomainRuleOracle = {
  readonly kind: 'domain-rule';
  readonly domainPackId: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly digest: string;
};

export type RepositorySpecificationOracle = {
  readonly kind: 'repository-specification';
  readonly artifactRef: string;
  readonly section?: string;
  readonly sha256: string;
};

export type HumanApprovedOracle = {
  readonly kind: 'human-approved';
  readonly approver: string;
  readonly scopeDigest: string;
  readonly approvalArtifactRef: string;
  readonly approvalSha256: string;
};

export type ObservedOnlyOracle = { readonly kind: 'observed-only' };

export type OracleSpec =
  DomainRuleOracle | RepositorySpecificationOracle | HumanApprovedOracle | ObservedOnlyOracle;

export type AssertionKind = 'acceptance' | 'characterization';

export type IntentLineage = {
  readonly commit: string;
  readonly appBuildDigest: string;
  readonly fixtureSeedDigest: string;
  readonly featureFlagsDigest: string;
  readonly policyDigest: string;
};

export type EvidenceRefs = {
  readonly source: readonly string[];
  readonly runtime: readonly string[];
};

export type IntentProposal = {
  readonly id: string;
  readonly intent: string;
  readonly action: string;
  readonly fromState: string;
  readonly toState: string;
  readonly evidenceRefs: EvidenceRefs;
};

export type UnresolvedAssertion = {
  readonly id: string;
  readonly intent: string;
  readonly expectedValue: string;
  readonly oracles: readonly OracleSpec[];
  readonly evidenceRefs: EvidenceRefs;
};

export type ResolvedAssertion = UnresolvedAssertion & { readonly kind: AssertionKind };

export type IntentSpecInput = {
  readonly schemaVersion: typeof INTENT_SCHEMA_VERSION;
  readonly id: string;
  readonly domain: string;
  readonly persona: string;
  readonly intent: string;
  readonly lineage: IntentLineage;
  readonly proposals: readonly IntentProposal[];
  readonly assertions: readonly UnresolvedAssertion[];
  readonly evidenceRefs: EvidenceRefs;
};

export type IntentSpec = Omit<IntentSpecInput, 'assertions'> & {
  readonly assertions: readonly ResolvedAssertion[];
};
