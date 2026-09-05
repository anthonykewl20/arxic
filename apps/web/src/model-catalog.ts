/** Provider catalog mechanics. No baked-in model IDs or fallback catalog. */
export type CatalogModel = {
  id: string;
  prices?: { promptPerMillion: number; completionPerMillion: number };
};
const validId = /^[a-zA-Z0-9][a-zA-Z0-9._:/[\]-]{0,119}$/u;
export async function discoverHttpModels(
  baseUrl: string,
  credential?: string,
): Promise<CatalogModel[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/u, '')}/models`, {
    headers: credential ? { Authorization: `Bearer ${credential}` } : {},
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Model discovery failed (HTTP ${response.status})`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Provider returned an empty catalog response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) throw new Error('Provider catalog exceeds the response limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Provider returned an invalid catalog response');
  }
  const rows = (data as { data?: unknown })?.data;
  if (!Array.isArray(rows) || rows.length > 10_000)
    throw new Error('Provider returned an invalid catalog response');
  const seen = new Set<string>();
  return rows.flatMap((row): CatalogModel[] => {
    if (!row || typeof row.id !== 'string' || !validId.test(row.id) || seen.has(row.id)) return [];
    seen.add(row.id);
    const model: CatalogModel = { id: row.id };
    const prompt = row.pricing?.prompt;
    const completion = row.pricing?.completion;
    if (
      [prompt, completion].every(
        (value) =>
          (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) &&
          Number.isFinite(Number(value) * 1_000_000) &&
          Number(value) >= 0,
      )
    ) {
      model.prices = {
        promptPerMillion: Number(prompt) * 1_000_000,
        completionPerMillion: Number(completion) * 1_000_000,
      };
    }
    return [model];
  });
}
