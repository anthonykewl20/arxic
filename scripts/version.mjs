import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  canonicalVersion,
  bumpVersion,
  formatVersionLabel,
} from '../packages/contracts/src/version-policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const current = (await readFile(join(root, 'VERSION'), 'utf8')).trim();
const command = process.argv[2];
if (command === 'label') console.log(formatVersionLabel(current));
else {
  if (!['set', 'minor', 'patch'].includes(command))
    throw new Error('Usage: node scripts/version.mjs label|minor|patch|set <version>');
  const next =
    command === 'set' ? canonicalVersion(process.argv[3]) : bumpVersion(current, command);
  const paths = ['package.json'];
  for (const parent of ['apps', 'packages'])
    for (const entry of await readdir(join(root, parent), { withFileTypes: true }))
      if (entry.isDirectory()) paths.push(`${parent}/${entry.name}/package.json`);
  const manifests = await Promise.all(
    paths.map(async (path) => ({
      path,
      data: JSON.parse(await readFile(join(root, path), 'utf8')),
    })),
  );
  for (const { path, data } of manifests)
    await writeFile(join(root, path), `${JSON.stringify({ ...data, version: next }, null, 2)}\n`);
  await writeFile(join(root, 'VERSION'), `${next}\n`);
  console.log(
    `${formatVersionLabel(current)} → ${formatVersionLabel(next)}; ${manifests.length} manifests aligned`,
  );
}
