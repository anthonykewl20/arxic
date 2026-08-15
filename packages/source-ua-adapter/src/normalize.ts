import { canonicalJson as serializeCanonicalJson, type EvidenceEvent } from '@arxic/contracts';
import type { ManifestFile } from './manifest';

export type NormalizedSourceIndex = {
  revision: { repository: string; commit: string | null; dirty: boolean };
  manifest: ManifestFile[];
  events: EvidenceEvent[];
  toolVersions: Record<string, string>;
  generatedAt: string;
};

const serializeSourceIndex = (value: unknown): string =>
  serializeCanonicalJson(value, { mode: 'legacy' });

export { serializeSourceIndex as canonicalJson };
