import { canonicalJson, type StagedBundle } from '@arxic/contracts';

export function freezeBundle(bundle: StagedBundle): Uint8Array {
  return Buffer.from(`${canonicalJson(bundle)}\n`, 'utf8');
}
