// PROVISIONAL — replace with import from apps/worker/src/run-spec.ts (ArxicConfig) when #26 seam merges
export type ParsedConfig = {
  version: 1;
  source: { repository: string; revision: string; languages: string[] };
  scope: {
    domains: string[];
    frameworks: string[];
    browsers: string[];
    personas: string[];
    featureFlags?: Record<string, boolean>;
  };
  target: {
    origin: string;
    environmentClass: string;
    attestationPath: string;
    allowedOrigins: string[];
  };
  policy: {
    maxUrls: number;
    maxDepth: number;
    maxRuntimeMinutes: number;
    mutation: string;
    externalNetwork: string;
    requiredVerificationRuns: number;
    screenshots: string;
    trace: string;
    humanApproval: string[];
  };
  fixtures: { inbox?: string; otp?: string; personaProvisioner?: string };
  models: { provider: string; sourceRetention: string };
};
