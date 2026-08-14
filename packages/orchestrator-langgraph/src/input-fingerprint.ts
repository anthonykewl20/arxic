import { artifactHash } from './checkpointer';

/**
 * Pure service mechanic for binding persisted runs to their semantic inputs.
 * The caller decides how a mismatch changes run state.
 */
export type RunInputFingerprintInput = Readonly<{
  sourceRevision: unknown;
  origin: string;
  policy: unknown;
  config: unknown;
}>;

export type RunInputFingerprint = Readonly<{ sha256: string }>;

export function createRunInputFingerprint(input: RunInputFingerprintInput): RunInputFingerprint {
  return {
    sha256: artifactHash({
      sourceRevision: input.sourceRevision,
      origin: input.origin,
      policy: input.policy,
      config: input.config,
    }),
  };
}
