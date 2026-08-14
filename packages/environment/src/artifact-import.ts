import { createHash } from 'node:crypto';
import type { RawArtifactSet } from './worker-sandbox';
import {
  ArtifactImportError,
  DEFAULT_RESULT_FILE_LIMIT,
  DEFAULT_RESULT_QUOTA_BYTES,
} from './artifact-quota';

export {
  ArtifactImportError,
  DEFAULT_RESULT_FILE_LIMIT,
  DEFAULT_RESULT_FILE_QUOTA_BYTES,
  DEFAULT_RESULT_QUOTA_BYTES,
} from './artifact-quota';

/** Minimal run-local byte-transport manifest; #157 extends/consumes this handshake. */
export type ArtifactTransportManifest = Readonly<{
  runId: string;
  resultReady: boolean;
  files: ReadonlyArray<Readonly<{ path: string; sha256: string; bytes: number }>>;
}>;
export type ImportedArtifact = Readonly<{
  path: string;
  sha256: string;
  bytes: Uint8Array;
}>;
export type ImportedArtifacts = Readonly<{
  manifest: ArtifactTransportManifest;
  files: readonly ImportedArtifact[];
}>;

export const RESULT_MANIFEST_PATH = 'result-manifest.json';
/** Validate worker-owned bytes as hostile content; hashes confer transport integrity only. */
export function importArtifacts(
  raw: RawArtifactSet,
  expectedRunId: string,
  options: Readonly<{ quotaBytes?: number; fileLimit?: number }> = {},
): ImportedArtifacts {
  const quotaBytes = options.quotaBytes ?? DEFAULT_RESULT_QUOTA_BYTES;
  const fileLimit = options.fileLimit ?? DEFAULT_RESULT_FILE_LIMIT;
  if (raw.entries.length > fileLimit + 1)
    throw new ArtifactImportError('quota', 'Worker result exceeded the file-count quota');
  if (raw.entries.some((entry) => entry.kind === 'symlink'))
    throw new ArtifactImportError('invalid', 'Worker result contains a symlink');
  if (raw.entries.some((entry) => entry.kind === 'other'))
    throw new ArtifactImportError('invalid', 'Worker result contains a non-regular file');
  const regular = new Map(
    raw.entries
      .filter(
        (entry): entry is typeof entry & { kind: 'regular'; bytes: Uint8Array } =>
          entry.kind === 'regular' && entry.bytes !== undefined,
      )
      .map((entry) => [entry.path, entry] as const),
  );
  const totalBytes = [...regular.values()].reduce((total, entry) => total + entry.bytes.length, 0);
  if (totalBytes > quotaBytes)
    throw new ArtifactImportError('quota', 'Worker result exceeded the byte quota');
  const manifestBytes = regular.get(RESULT_MANIFEST_PATH)?.bytes;
  if (!manifestBytes) throw new ArtifactImportError('invalid', 'Worker result manifest is missing');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  } catch {
    throw new ArtifactImportError('invalid', 'Worker result manifest is not valid UTF-8 JSON');
  }
  const manifest = parseManifest(value, expectedRunId, fileLimit);
  const declaredPaths = new Set(manifest.files.map((file) => file.path));
  const actualPaths = [...regular.keys()].filter((path) => path !== RESULT_MANIFEST_PATH);
  if (
    actualPaths.length !== declaredPaths.size ||
    actualPaths.some((path) => !declaredPaths.has(path))
  )
    throw new ArtifactImportError('invalid', 'Worker result files do not match the manifest');
  const files: ImportedArtifact[] = manifest.files.map((declared) => {
    const entry = regular.get(declared.path);
    if (!entry || entry.bytes.length !== declared.bytes)
      throw new ArtifactImportError(
        'invalid',
        `Worker artifact byte count disagrees: ${declared.path}`,
      );
    const digest = createHash('sha256').update(entry.bytes).digest('hex');
    if (digest !== declared.sha256)
      throw new ArtifactImportError(
        'invalid',
        `Worker artifact SHA-256 disagrees: ${declared.path}`,
      );
    return { path: declared.path, sha256: digest, bytes: entry.bytes };
  });
  return { manifest, files };
}

function parseManifest(
  value: unknown,
  expectedRunId: string,
  fileLimit: number,
): ArtifactTransportManifest {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !['runId', 'resultReady', 'files'].includes(key))
  )
    throw new ArtifactImportError('invalid', 'Worker result manifest shape is invalid');
  if (value.runId !== expectedRunId || value.resultReady !== true || !Array.isArray(value.files))
    throw new ArtifactImportError('invalid', 'Worker result manifest handshake is invalid');
  if (value.files.length > fileLimit)
    throw new ArtifactImportError('quota', 'Worker result exceeded the file-count quota');
  const paths = new Set<string>();
  const files = value.files.map((file): ArtifactTransportManifest['files'][number] => {
    if (
      !isRecord(file) ||
      Object.keys(file).some((key) => !['path', 'sha256', 'bytes'].includes(key))
    )
      throw new ArtifactImportError('invalid', 'Worker artifact declaration shape is invalid');
    if (
      typeof file.path !== 'string' ||
      !safeRelativePath(file.path) ||
      paths.has(file.path) ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      typeof file.bytes !== 'number' ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0
    )
      throw new ArtifactImportError('invalid', 'Worker artifact declaration is invalid');
    paths.add(file.path);
    return { path: file.path, sha256: file.sha256, bytes: file.bytes };
  });
  return { runId: expectedRunId, resultReady: true, files };
}

function safeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 1024 &&
    !path.startsWith('/') &&
    !path.startsWith('\\') &&
    !/^[A-Za-z]:/.test(path) &&
    !path.includes('\\') &&
    path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..') &&
    path !== RESULT_MANIFEST_PATH
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
