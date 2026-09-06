import { sha256 } from '@arxic/contracts';
export type FrontendBundle = {
  assets: Map<string, string | Uint8Array>;
  version: string;
  indexHtml: string;
};
export function makeFrontendBundle(assets: Map<string, string | Uint8Array>): FrontendBundle {
  if (
    assets.size !== 3 ||
    !['/app.js', '/app.css', '/index.html'].every((name) => assets.has(name))
  )
    throw new Error('Frontend bundle must contain app.js, app.css and index.html');
  const parts: Uint8Array[] = [];
  for (const [name, body] of [...assets].sort(([a], [b]) => a.localeCompare(b))) {
    parts.push(Buffer.from(name), typeof body === 'string' ? Buffer.from(body) : body);
  }
  return {
    assets,
    version: sha256(Buffer.concat(parts)).slice(0, 16),
    indexHtml: Buffer.from(assets.get('/index.html')!).toString('utf8'),
  };
}
