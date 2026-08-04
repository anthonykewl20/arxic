import type {
  EvidenceEvent,
  SourceIndexer,
  VerificationResult,
  WorkflowVerifier,
} from '../adapters';

type UpstreamNode = { handle: symbol };

declare const upstreamIndexer: {
  index(input: unknown): AsyncIterable<UpstreamNode>;
};

// @ts-expect-error — upstream nodes must not cross the SourceIndexer contract boundary.
export const violatesIndexer: SourceIndexer = upstreamIndexer;

type UpstreamVerification = { engineStatus: number };

declare const upstreamVerifier: {
  verify(bundle: unknown, policy: unknown): Promise<UpstreamVerification>;
};

// @ts-expect-error — upstream verifier results must not cross the WorkflowVerifier contract boundary.
export const violatesVerifier: WorkflowVerifier = upstreamVerifier;

export const conformingIndexer: SourceIndexer = {
  async *index() {
    yield { ref: {} as never } satisfies EvidenceEvent;
  },
};

export const conformingVerifier: WorkflowVerifier = {
  async verify() {
    return {
      outcome: 'blocked',
      diagnostics: [],
      artifacts: [],
      runs: [{ passed: false }],
    } satisfies VerificationResult;
  },
};

export type _ConformingAdapters = typeof conformingIndexer | typeof conformingVerifier;
