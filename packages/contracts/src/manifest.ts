import { readFileSync } from 'node:fs';
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import {
  ARXIC_MANIFEST_DENOMINATOR_INVALID,
  ARXIC_MANIFEST_GATE_MISSING,
  ARXIC_MANIFEST_INVALID,
  type Diagnostic,
  type DiagnosticSeverity,
} from './diagnostics';
import type { TruthState } from './workflow';

export type ManifestWorkflow = {
  id: string;
  status: TruthState;
};

export type ManifestEnvironment = {
  class: string;
  featureFlags?: string[];
  persona?: string;
  browser?: string;
};

export type ManifestGenerator = {
  id: string;
  version: string;
};

export type ManifestVerificationRun = {
  startedAt: string;
  finishedAt: string;
  passed: boolean;
};

export type ManifestFileHash = {
  path: string;
  sha256: string;
};

export type ManifestGateResult = {
  gate: string;
  passed: boolean;
};

export type ManifestBlocker = {
  code: string;
  severity: DiagnosticSeverity;
  subject: string;
  message: string;
  evidenceRefs?: string[];
  supportedFixes?: string[];
};

export type ManifestCoverage = {
  denominator: number;
  verified?: number;
  contradicted?: number;
  blocked?: number;
  uncovered?: number;
};

export type BundleManifest = {
  schemaVersion: number;
  bundleVersion: number;
  workflow: ManifestWorkflow;
  repository: string;
  commit: string;
  appBuildDigest: string;
  environment: ManifestEnvironment;
  generator: ManifestGenerator;
  model?: {
    id?: string;
    version?: string;
  };
  dependencies?: Array<{
    name: string;
    version: string;
    kind?: string;
  }>;
  verification: {
    requiredRuns: number;
    runs: ManifestVerificationRun[];
  };
  fileHashes: ManifestFileHash[];
  gateResults: ManifestGateResult[];
  blockers?: ManifestBlocker[];
  coverage: ManifestCoverage;
  parentDomainPack?: string;
  runId: string;
};

const schemaUrl = new URL('../../../schemas/manifest/manifest.schema.json', import.meta.url);
let manifestSchema: object;

try {
  manifestSchema = JSON.parse(readFileSync(schemaUrl, 'utf8')) as object;
} catch (error) {
  throw new Error(`Failed to load BundleManifest schema at ${schemaUrl.pathname}`, {
    cause: error,
  });
}

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile<BundleManifest>(manifestSchema);

const diagnosticCode = (error: ErrorObject) => {
  const missingProperty =
    error.keyword === 'required' ? String(error.params.missingProperty) : undefined;
  if (
    (error.instancePath.startsWith('/gateResults') &&
      (error.keyword === 'required' || error.keyword === 'minItems')) ||
    (error.instancePath === '' && missingProperty === 'gateResults')
  ) {
    return ARXIC_MANIFEST_GATE_MISSING;
  }
  if (
    error.instancePath === '/coverage/denominator' ||
    (error.instancePath === '/coverage' && missingProperty === 'denominator')
  ) {
    return ARXIC_MANIFEST_DENOMINATOR_INVALID;
  }
  return ARXIC_MANIFEST_INVALID;
};

const toDiagnostic = (error: ErrorObject): Diagnostic => ({
  code: diagnosticCode(error),
  severity: 'blocked',
  subject: 'manifest',
  message: `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
});

export const validateManifest = (
  input: unknown,
): { ok: true; value: BundleManifest } | { ok: false; diagnostics: Diagnostic[] } => {
  if (validate(input)) {
    return { ok: true, value: input };
  }
  return {
    ok: false,
    diagnostics: (validate.errors ?? []).map(toDiagnostic),
  };
};
