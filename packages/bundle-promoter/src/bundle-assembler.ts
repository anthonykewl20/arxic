import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { ArtifactRef, StagedBundle } from '@arxic/contracts';
import { validateTraceArtifacts } from './trace-artifact-gate';

export type ProvenanceInput = Readonly<{
  repository: string;
  commit: string;
  appBuildDigest: string;
  toolVersions?: Readonly<Record<string, string>>;
}>;

export type BundleAssemblyInput = Readonly<{
  bundle: StagedBundle;
  stagedDirectory: string;
  outputDirectory: string;
  verificationArtifacts?: readonly ArtifactRef[];
  provenance: ProvenanceInput;
  now?: () => string;
}>;

export type AssembledFile = Readonly<{
  path: string;
  sha256: string;
  size: number;
}>;

export type BundleAssembly = Readonly<{
  directory: string;
  files: readonly AssembledFile[];
  checksumsSha256: string;
  notice: string;
  provenance: string;
}>;

const stagedFiles = [
  'tests/workflow.spec.ts',
  'fixtures/workflow.fixture.ts',
  'playwright.config.ts',
] as const;

export async function assembleBundle(input: BundleAssemblyInput): Promise<BundleAssembly> {
  const stagedDirectory = resolve(input.stagedDirectory);
  const directory = resolve(input.outputDirectory);
  if (
    dirname(directory) === directory ||
    stagedDirectory === directory ||
    stagedDirectory.startsWith(`${directory}${sep}`)
  ) {
    throw new Error('Bundle output directory must not contain the staged directory or be a root');
  }
  const traceGate = await validateTraceArtifacts(input.verificationArtifacts ?? []);
  if (!traceGate.ok) throw new Error(traceGate.reason);
  const validatedTraces = traceGate.traces;
  const validatedScreenshots = traceGate.screenshots;
  await rm(directory, { recursive: true, force: true });
  await Promise.all([
    mkdir(join(directory, 'tests'), { recursive: true }),
    mkdir(join(directory, 'fixtures'), { recursive: true }),
    mkdir(join(directory, 'evidence'), { recursive: true }),
    mkdir(join(directory, 'artifacts', 'screenshots'), { recursive: true }),
    mkdir(join(directory, 'artifacts', 'traces'), { recursive: true }),
    mkdir(join(directory, 'artifacts', 'reports'), { recursive: true }),
  ]);

  const generatedAt = (input.now ?? (() => new Date().toISOString()))();
  const provenance = canonicalJson({
    schemaVersion: 1,
    generatedAt,
    repository: input.provenance.repository,
    commit: input.provenance.commit,
    appBuildDigest: input.provenance.appBuildDigest,
    generator: { id: '@arxic/bundle-promoter', version: '0.0.0' },
    ...(input.provenance.toolVersions ? { toolVersions: input.provenance.toolVersions } : {}),
  });
  const notice = `Arxic verified workflow bundle.\nWorkflow: ${input.bundle.workflow.id}\nGenerated: ${generatedAt}\nLicense: MIT\nThis bundle contains independently inspectable privacy-preserving Playwright action timelines.\n`;

  await Promise.all([
    writeFile(join(directory, 'manifest.json'), canonicalJson(input.bundle.manifest), 'utf8'),
    writeFile(join(directory, 'workflow.json'), canonicalJson(input.bundle.workflow), 'utf8'),
    writeFile(join(directory, 'plan.md'), input.bundle.plan, 'utf8'),
    writeFile(
      join(directory, 'evidence', 'index.json'),
      canonicalJson(input.bundle.evidenceIndex),
      'utf8',
    ),
    writeFile(join(directory, 'provenance.json'), provenance, 'utf8'),
    writeFile(join(directory, 'NOTICE'), notice, 'utf8'),
  ]);

  for (const relativePath of stagedFiles) {
    const artifact = input.bundle.artifacts.find((item) => item.path === relativePath);
    if (!artifact) throw new Error(`Staged bundle does not declare ${relativePath}`);
    const source = safeResolve(stagedDirectory, artifact.path);
    const bytes = await readFile(source);
    assertHash(artifact, bytes);
    await copyFile(source, join(directory, relativePath));
  }

  const verificationArtifacts = [...(input.verificationArtifacts ?? [])]
    .filter(({ kind }) => kind === 'screenshot' || kind === 'trace')
    .sort((left, right) => compareCodepoints(left.path, right.path));
  const artifactSequences = { screenshot: 0, trace: 0 };
  for (const artifact of verificationArtifacts) {
    const kind = artifact.kind === 'trace' ? 'trace' : 'screenshot';
    artifactSequences[kind] += 1;
    const name = `${String(artifactSequences[kind]).padStart(3, '0')}-${kind}.${kind === 'trace' ? 'zip' : 'png'}`;
    const kindDirectory = kind === 'screenshot' ? 'screenshots' : 'traces';
    if (kind === 'trace') {
      const validated = validatedTraces.get(artifact.path);
      if (!validated) throw new Error('Validated trace disappeared after preflight');
      await Promise.all([
        writeFile(join(directory, 'artifacts', kindDirectory, name), validated.traceBytes),
        writeFile(
          join(directory, 'artifacts', 'reports', `${name}.sanitization.json`),
          validated.provenanceBytes,
        ),
      ]);
      continue;
    }
    const validated = validatedScreenshots.get(artifact.path);
    if (!validated) throw new Error('Validated screenshot disappeared after preflight');
    await writeFile(join(directory, 'artifacts', kindDirectory, name), validated.bytes);
  }

  const files = await assembledFiles(directory, false);
  const checksumsSha256 = `${files.map((file) => `${file.sha256}  ${file.path}`).join('\n')}\n`;
  await writeFile(join(directory, 'checksums.sha256'), checksumsSha256, 'utf8');
  return {
    directory,
    files: await assembledFiles(directory, true),
    checksumsSha256,
    notice,
    provenance,
  };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('bundle contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCodepoints(left, right))
        .map(([key, item]) => {
          if (item === undefined) throw new TypeError(`bundle contains undefined at ${key}`);
          return [key, canonicalize(item)];
        }),
    );
  }
  throw new TypeError(`bundle contains unsupported ${typeof value}`);
}

function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeResolve(baseDirectory: string, relativePath: string): string {
  const candidate = resolve(baseDirectory, relativePath);
  if (candidate !== baseDirectory && !candidate.startsWith(`${baseDirectory}${sep}`)) {
    throw new Error(`Artifact path escapes the staged directory: ${relativePath}`);
  }
  return candidate;
}

function assertHash(artifact: ArtifactRef, bytes: Uint8Array): void {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== artifact.sha256) {
    throw new Error(`Artifact hash mismatch for ${artifact.path}`);
  }
}

async function assembledFiles(
  directory: string,
  includeChecksums: boolean,
): Promise<AssembledFile[]> {
  const paths = await filesUnder(directory);
  return Promise.all(
    paths
      .filter((path) => includeChecksums || path !== 'checksums.sha256')
      .sort()
      .map(async (path) => {
        const bytes = await readFile(join(directory, path));
        return {
          path,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          size: (await stat(join(directory, path))).size,
        };
      }),
  );
}

async function filesUnder(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = prefix ? join(prefix, entry.name) : entry.name;
      return entry.isDirectory() ? filesUnder(directory, path) : Promise.resolve([path]);
    }),
  );
  return nested.flat();
}
