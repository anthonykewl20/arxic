import type {
  Diagnostic,
  EvidenceEvent,
  SourceIndexer,
  SourceIndexRequest,
} from '@arxic/contracts';
import { scanRepository, type ScanDocument } from './scanner';
import { DEFAULT_SOURCE_SCAN_POLICY, type SourceScanPolicy } from './policy';
import { canonicalJson, type NormalizedSourceIndex } from './normalize';
import type { RouteInventoryInterchange } from './language-packs/interchange';

export * from './diagnostics';
export { ARXIC_SOURCE_UNSAFE_FILE } from './safe-source';
export * from './normalize';
export * from './policy';
export * from './frontend';
export * from './language-packs';
export {
  INTERCHANGE_SCHEMA_VERSION,
  toRouteInventoryInterchange,
  type InterchangeGap,
  type InterchangeRoute,
  type HttpMethod,
  type RouteInventoryInterchange,
} from './language-packs/interchange';

export const PACKAGE_NAME = '@arxic/source-ua-adapter' as const;

export type SourceUaAdapterOptions = {
  policy?: SourceScanPolicy;
  now?: () => string;
};

export class SourceUaAdapter implements SourceIndexer {
  readonly policy: SourceScanPolicy;
  private readonly now: () => string;

  constructor(options: SourceUaAdapterOptions = {}) {
    this.policy = options.policy ?? DEFAULT_SOURCE_SCAN_POLICY;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async *index(input: SourceIndexRequest): AsyncIterable<EvidenceEvent> {
    const result = await this.scan(input);
    yield* result.events;
  }

  async collect(input: SourceIndexRequest): Promise<NormalizedSourceIndex> {
    const result = await this.scan(input);
    // Explicit field pick: interchange inventories are a separate channel and
    // must not alter the NormalizedSourceIndex shape (byte-stable evidence).
    return {
      revision: result.revision,
      manifest: result.manifest,
      events: result.events,
      toolVersions: result.toolVersions,
      generatedAt: this.now(),
    };
  }

  /**
   * Per-pack route inventories in the DG-02 interchange v1 shape (validated by
   * the Domain Inventory's own validator — conformance is integration-tested
   * against the real `validateInterchange`). Frozen SourceIndexer untouched.
   */
  async collectRouteInventories(input: SourceIndexRequest): Promise<RouteInventoryInterchange[]> {
    const result = await this.scan(input);
    return result.inventories ?? [];
  }

  private async scan(input: SourceIndexRequest): Promise<ScanDocument> {
    return scanRepository(input, this.policy);
  }
}

export async function collect(
  input: SourceIndexRequest,
  options: SourceUaAdapterOptions = {},
): Promise<NormalizedSourceIndex> {
  return new SourceUaAdapter(options).collect(input);
}

export function normalizedJson(document: NormalizedSourceIndex): string {
  return canonicalJson(document);
}

export function diagnosticsOf(events: EvidenceEvent[]): Diagnostic[] {
  return events.flatMap((event) => ('diagnostic' in event ? [event.diagnostic] : []));
}
