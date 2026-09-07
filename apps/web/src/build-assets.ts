import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { sha256 } from '@arxic/contracts';
import { frontendAssets } from './frontend-assets';
const directory = resolve(process.argv[2]);
const bundle = await frontendAssets();
await mkdir(directory, { recursive: true });
const files: Record<string, string> = {};
for (const [name, body] of bundle.assets) {
  const file = name.slice(1);
  files[file] = sha256(typeof body === 'string' ? Buffer.from(body) : body);
  await writeFile(join(directory, file), body);
}
const jobSha256 = sha256(await readFile(join(directory, '../web-job.js')));
await writeFile(
  join(directory, 'manifest.json'),
  JSON.stringify({ version: bundle.version, files, jobSha256 }, null, 2),
);
