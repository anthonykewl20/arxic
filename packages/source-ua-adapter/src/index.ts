import type {
  Diagnostic,
  EvidenceEvent,
  SourceIndexer,
  SourceIndexRequest,
} from '@arxic/contracts';
import { scanRepository, type ScanDocument } from './scanner';
import { DEFAULT_SOURCE_SCAN_POLICY, type SourceScanPolicy } from './policy';
import { canonicalJson, type NormalizedSourceIndex } from './normalize';

export * from './diagnostics';
export * from './normalize';
export * from './policy';

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
    return { ...result, generatedAt: this.now() };
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
