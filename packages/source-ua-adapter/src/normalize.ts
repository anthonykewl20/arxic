import type { EvidenceEvent } from '@arxic/contracts';
import type { ManifestFile } from './manifest';

export type NormalizedSourceIndex = {
  revision: { repository: string; commit: string | null; dirty: boolean };
  manifest: ManifestFile[];
  events: EvidenceEvent[];
  toolVersions: Record<string, string>;
  generatedAt: string;
};

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}
