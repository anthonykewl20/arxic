import type { OrchestratorInput } from '@arxic/orchestrator-langgraph';
import type { VerificationPersona } from '@arxic/verifier';
import type { ArxicConfig } from './run-spec';

/** Shared config projection for the local and sandbox actions. */
export function orchestrationConfig(config: ArxicConfig, persona?: VerificationPersona) {
  return {
    ...(config.target.allowedOrigins?.length
      ? { allowedOrigins: [...config.target.allowedOrigins] }
      : {}),
    ...(config.fixtures.replayPersona && persona
      ? {
          replayPersona: {
            declaration: config.fixtures.replayPersona,
            persona: { email: persona.email, password: persona.password },
          },
        }
      : {}),
    origin: config.target.origin,
    attestationPath: config.target.attestationPath,
    ...(config.target.expectedBuildDigest
      ? { expectedBuildDigest: config.target.expectedBuildDigest }
      : {}),
    framework: config.scope.frameworks[0],
    features: config.scope.domains,
    languages: config.source.languages,
    personas: config.scope.personas,
    maxUrls: config.policy.maxUrls,
    maxDepth: config.policy.maxDepth,
    requiredVerificationRuns: config.policy.requiredVerificationRuns,
    policy: config.policy,
    config,
  } satisfies Partial<OrchestratorInput>;
}
