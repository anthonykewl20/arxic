import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  parseScreenshotPrivacyAttestation,
  validateScreenshotArtifactSet,
} from '../../../packages/playwright-screenshot-privacy/src';
import { readBoundedRegularFile } from '../../../packages/playwright-screenshot-privacy/src/safe-filesystem';
import { inside } from './projects';
import { HttpError } from './errors';

export type WorkflowCapture = {
  id: string;
  file: string;
  originalFile: string;
  sha256: string;
  privacyFile: string;
  privacySha256: string;
  width: number;
  height: number;
  mode: 'approved-region' | 'masked-page';
  capturedAt: string;
};
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function invalid(): never {
  throw new HttpError(409, 'Workflow capture integrity check failed');
}
export async function readWorkflowArtifact(path: string, expectedHash: string): Promise<Buffer> {
  const bytes = await readBoundedRegularFile(path, {
    minimumBytes: 1,
    maximumBytes: path.endsWith('.png') ? 16 * 1024 * 1024 : 64 * 1024,
    onFailure: invalid,
  });
  if (hash(bytes) !== expectedHash) invalid();
  return bytes;
}

/** Export only independently attested images; the action decides whether a run is eligible. */
export async function collectWorkflowCaptures(
  directory: string,
  runId: string,
): Promise<WorkflowCapture[]> {
  const engine = join(directory, 'engine');
  const bytes = await readBoundedRegularFile(join(engine, 'promoted', `${runId}.bundle.json`), {
    minimumBytes: 1,
    maximumBytes: 16 * 1024 * 1024,
    onFailure: invalid,
  });
  const bundle = JSON.parse(bytes.toString('utf8')) as {
    artifacts?: Array<{ kind: string; path: string; sha256: string }>;
  };
  if (
    !Array.isArray(bundle.artifacts) ||
    !bundle.artifacts.length ||
    bundle.artifacts.length > 4096
  )
    invalid();
  const artifacts = bundle.artifacts;
  for (const artifact of artifacts) {
    if (
      !artifact ||
      typeof artifact.path !== 'string' ||
      typeof artifact.kind !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(artifact.sha256) ||
      !inside(engine, resolve(artifact.path))
    )
      invalid();
  }
  await validateScreenshotArtifactSet({ artifacts });
  const captures: WorkflowCapture[] = [];
  for (const artifact of artifacts.filter((item) => item.kind === 'screenshot')) {
    const provenance = artifacts.find((item) => item.path === `${artifact.path}.privacy.json`);
    if (!provenance) invalid();
    const [image, privacy] = await Promise.all([
      readWorkflowArtifact(artifact.path, artifact.sha256),
      readWorkflowArtifact(provenance.path, provenance.sha256),
    ]);
    const attestation = parseScreenshotPrivacyAttestation(privacy);
    if (attestation.attestedBy !== '@arxic/verifier') invalid();
    const id = `checkpoint-${String(captures.length + 1).padStart(3, '0')}`;
    const file = `${id}.png`;
    const privacyFile = `${file}.privacy.json`;
    await writeFile(join(directory, file), image, { mode: 0o600, flag: 'wx' });
    await writeFile(join(directory, privacyFile), privacy, { mode: 0o600, flag: 'wx' });
    captures.push({
      id,
      file,
      privacyFile,
      originalFile: basename(artifact.path),
      sha256: artifact.sha256,
      privacySha256: provenance.sha256,
      width: attestation.screenshot.width,
      height: attestation.screenshot.height,
      mode: attestation.capture.mode,
      capturedAt: attestation.capture.capturedAt,
    });
  }
  if (!captures.length) invalid();
  return captures;
}
