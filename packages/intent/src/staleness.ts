import type { Diagnostic } from '@arxic/contracts';
import { ARXIC_INTENT_ORACLE_STALE, intentDiagnostic } from './diagnostics';
import type { IntentLineage } from './types';

const LINEAGE_FIELDS = [
  'commit',
  'appBuildDigest',
  'fixtureSeedDigest',
  'featureFlagsDigest',
  'policyDigest',
] as const satisfies readonly (keyof IntentLineage)[];

export function detectStaleness(
  lineage: IntentLineage,
  current: IntentLineage,
): { stale: boolean; diagnostics: readonly Diagnostic[] } {
  const drifted = LINEAGE_FIELDS.filter((field) => lineage[field] !== current[field]);
  if (drifted.length === 0) return { stale: false, diagnostics: [] };
  return {
    stale: true,
    diagnostics: [
      intentDiagnostic(
        ARXIC_INTENT_ORACLE_STALE,
        'blocked',
        'intent.lineage',
        `Intent lineage drifted: ${drifted.join(', ')}`,
      ),
    ],
  };
}
