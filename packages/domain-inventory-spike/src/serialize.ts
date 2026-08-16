import type { DomainInventory } from './types';

/**
 * Canonical byte-stable serialization. Volatile runtime fields (timestamps,
 * run ids, browser versions, build digests) are stripped so two inventories
 * built from identical inputs serialize identically. Rows and clusters are
 * already canonically ordered by the builder.
 */
export function serializeInventory(inventory: DomainInventory): string {
  return `${JSON.stringify(stabilize(inventory), replacer, 0)}\n`;
}

function replacer(_key: string, value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value === 'object' && value !== null) {
    if ('kind' in value && value.kind === 'runtime') {
      const { runId, timestamp, browserVersion, appBuildDigest, ...stable } = value as Record<
        string,
        unknown
      >;
      void runId;
      void timestamp;
      void browserVersion;
      void appBuildDigest;
      return { kind: 'runtime', url: stable.url };
    }
  }
  return value;
}

export function stabilize(inventory: DomainInventory): unknown {
  return JSON.parse(
    JSON.stringify(
      {
        schemaVersion: inventory.schemaVersion,
        inputs: inventory.inputs,
        rows: inventory.rows.map((row) => ({
          ...row,
          runtimeRefs: row.runtimeRefs.map((ref) => ({
            kind: 'runtime',
            url: ref.url,
          })),
        })),
        clusters: inventory.clusters,
        stats: inventory.stats,
      },
      replacer,
    ),
  );
}
