import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const manifestFileName = 'inspection-manifest.json';
const readableManifestFileName = 'inspection-manifest.txt';
const signOffFileName = 'inspection-sign-off.md';
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Builds a census of retained screenshot files below a promoted bundle, run, or
 * evidence directory. It deliberately does not decide whether a screenshot is
 * safe; that remains a human release-gate decision.
 */
export async function createInspectionManifest(root) {
  const resolvedRoot = resolve(root);
  let rootStats;
  try {
    rootStats = await stat(resolvedRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Inspection root does not exist: ${resolvedRoot}`);
    }
    throw error;
  }
  if (!rootStats.isDirectory()) {
    throw new Error(`Inspection root is not a directory: ${resolvedRoot}`);
  }

  const screenshots = await collectScreenshots(resolvedRoot);
  const groups = groupScreenshots(screenshots);
  return {
    schemaVersion: 1,
    root: basename(resolvedRoot),
    screenshotCount: screenshots.length,
    groups,
  };
}

export async function writeInspectionManifest(root) {
  const resolvedRoot = resolve(root);
  const manifest = await createInspectionManifest(resolvedRoot);
  const outputs = {
    json: join(resolvedRoot, manifestFileName),
    text: join(resolvedRoot, readableManifestFileName),
    signOff: join(resolvedRoot, signOffFileName),
  };
  await mkdir(dirname(outputs.json), { recursive: true });
  await Promise.all([
    writeFile(outputs.json, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    writeFile(outputs.text, renderReadableManifest(manifest), 'utf8'),
    writeFile(outputs.signOff, renderSignOffTemplate(manifest), 'utf8'),
  ]);
  return { manifest, outputs };
}

async function collectScreenshots(root) {
  const screenshots = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if ((!entry.isFile() && !entry.isSymbolicLink()) || !isScreenshot(entry.name)) continue;
      const fileStats = await lstat(path);
      const relativePath = relative(root, path).split(sep).join('/');
      if (entry.isSymbolicLink()) {
        screenshots.push({
          relativePath,
          byteSize: fileStats.size,
          symlink: true,
          sha256Note: 'sha256 unavailable: symlink not followed',
          dimensionsNote: 'dimensions unavailable: symlink not followed',
        });
        continue;
      }
      const [sha256, header] = await Promise.all([sha256File(path), readHeader(path)]);
      screenshots.push({
        relativePath,
        byteSize: fileStats.size,
        sha256,
        ...(isPng(entry.name)
          ? pngDimensions(header)
          : { dimensionsNote: 'dimensions skipped: non-PNG' }),
      });
    }
  }
  await walk(root);
  return screenshots.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, 'en'),
  );
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(path);
    const hash = createHash('sha256');
    stream.once('error', reject);
    hash.once('error', reject);
    hash.once('finish', () => resolve(hash.digest('hex')));
    stream.pipe(hash);
  });
}

async function readHeader(path) {
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(24);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

function isScreenshot(name) {
  return /\.(?:png|jpe?g)$/iu.test(name);
}

function isPng(name) {
  return /\.png$/iu.test(name);
}

function pngDimensions(bytes) {
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, pngSignature.length).equals(pngSignature) ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    return { dimensionsNote: 'dimensions unavailable: missing PNG IHDR header' };
  }
  return { dimensions: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } };
}

function groupScreenshots(screenshots) {
  const grouped = new Map();
  for (const screenshot of screenshots) {
    const group = groupForPath(screenshot.relativePath);
    const current = grouped.get(group) ?? [];
    current.push(screenshot);
    grouped.set(group, current);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([path, files]) => ({ path, files }));
}

function groupForPath(relativePath) {
  const parts = relativePath.split('/');
  const namedGroup = parts.findLastIndex((part) => /^(?:bundle|run)(?:[-_].+)?$/iu.test(part));
  if (namedGroup >= 0) return parts.slice(0, namedGroup + 1).join('/');
  return parts.length === 1 ? '.' : parts.slice(0, -1).join('/');
}

export function renderReadableManifest(manifest) {
  const lines = [
    'Screenshot inspection manifest',
    `Root: ${manifest.root}`,
    `Screenshots: ${manifest.screenshotCount}`,
  ];
  for (const group of manifest.groups) {
    lines.push('', `Group: ${group.path}`);
    for (const file of group.files) {
      const dimensions = file.dimensions
        ? `${file.dimensions.width}x${file.dimensions.height}`
        : file.dimensionsNote;
      const sha256 = file.sha256 ?? file.sha256Note;
      lines.push(
        `- ${file.relativePath} | ${file.byteSize} bytes | sha256 ${sha256} | ${dimensions}${file.symlink ? ' | symlink: true' : ''}`,
      );
    }
  }
  if (manifest.groups.some((group) => group.files.some((file) => file.symlink))) {
    lines.push(
      '',
      'Caveat: symlinks require manual resolution by the inspector; targets were not followed.',
    );
  }
  return `${lines.join('\n')}\n`;
}

export function renderSignOffTemplate(manifest) {
  const lines = [
    '# Human screenshot inspection sign-off',
    '',
    'Complete this checklist only after visually inspecting every listed screenshot and its adjacent privacy provenance. This template is not a certification by automation or an LLM.',
    '',
    `Inspection root: ${manifest.root}`,
    `Screenshot count: ${manifest.screenshotCount}`,
    '',
  ];
  for (const group of manifest.groups) {
    lines.push(`## ${group.path}`, '');
    for (const file of group.files) {
      lines.push(
        `- [ ] \`${file.relativePath}\``,
        '  - Reviewer initials:',
        '  - PASS / FAIL:',
        '  - Notes:',
      );
    }
    lines.push('');
  }
  lines.push(
    '## Release sign-off',
    '',
    'Date:',
    'Reviewer:',
    'Release:',
    'Bundle/run set reviewed:',
    'Provenance reviewed:',
    'Overall result: PASS / FAIL',
    '',
  );
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [root] = process.argv.slice(2);
  if (!root) {
    console.error('Usage: node scripts/inspection-manifest.mjs <bundle-or-run-or-evidence-root>');
    process.exitCode = 1;
  } else {
    writeInspectionManifest(root)
      .then(({ manifest, outputs }) => {
        console.log(`Wrote inspection manifest for ${manifest.screenshotCount} screenshot(s).`);
        console.log(`JSON: ${outputs.json}`);
        console.log(`Readable: ${outputs.text}`);
        console.log(`Sign-off: ${outputs.signOff}`);
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
