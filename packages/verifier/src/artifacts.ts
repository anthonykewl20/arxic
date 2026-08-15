import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sha256, type ArtifactRef } from '@arxic/contracts';
import {
  retainCaptureArtifacts,
  type TraceSanitizationFailure,
} from '@arxic/playwright-trace-sanitizer';
import type {
  ScreenshotPrivacyPolicy,
  TrustedScreenshotCaptureBinding,
} from '@arxic/playwright-screenshot-privacy';

export type ArtifactHashFailure = {
  artifact: ArtifactRef;
  reason: 'missing' | 'mismatch';
};

export class TraceSanitizationError extends Error {
  readonly failure: TraceSanitizationFailure;

  constructor(failure: TraceSanitizationFailure) {
    super(`Trace sanitization failed (${failure.code})`);
    this.name = 'TraceSanitizationError';
    this.failure = failure;
  }
}

export async function captureRunArtifacts(
  testDirectory: string,
  artifactsDirectory: string,
  run: number,
  options: {
    forbiddenSubstrings?: readonly string[];
    screenshotCheckpoints?: readonly string[];
    screenshotPrivacy?: Readonly<{
      binding: TrustedScreenshotCaptureBinding;
      policy: ScreenshotPrivacyPolicy;
      correlation: string;
      attester: '@arxic/verifier';
      attestedAt: string;
    }>;
  } = {},
): Promise<ArtifactRef[]> {
  const retained = await retainCaptureArtifacts({
    roots: [join(testDirectory, 'artifacts'), join(testDirectory, 'test-results')],
    destination: join(artifactsDirectory, 'verification', `run-${run}`),
    forbiddenSubstrings: options.forbiddenSubstrings,
    screenshotCheckpoints: options.screenshotCheckpoints,
    screenshotPrivacy: options.screenshotPrivacy
      ? { testDirectory, ...options.screenshotPrivacy }
      : undefined,
  });
  if (retained.ok) return retained.refs;
  if (retained.traceFailure) throw new TraceSanitizationError(retained.traceFailure);
  throw new Error(`${retained.code}: ${retained.message}`);
}

export async function verifyArtifactHashes(
  artifacts: ArtifactRef[],
  baseDirectory?: string,
): Promise<ArtifactHashFailure[]> {
  const failures: ArtifactHashFailure[] = [];
  for (const artifact of artifacts) {
    const path = baseDirectory ? resolveArtifactPath(baseDirectory, artifact.path) : artifact.path;
    try {
      const digest = sha256(await readFile(path));
      if (digest !== artifact.sha256) failures.push({ artifact, reason: 'mismatch' });
    } catch {
      failures.push({ artifact, reason: 'missing' });
    }
  }
  return failures;
}

export async function artifactRef(kind: string, path: string): Promise<ArtifactRef> {
  const bytes = await readFile(path);
  return { kind, path, sha256: sha256(bytes) };
}

export function resolveArtifactPath(baseDirectory: string, path: string): string {
  const base = resolve(baseDirectory);
  const candidate = resolve(base, path);
  if (candidate !== base && !candidate.startsWith(`${base}/`)) {
    throw new Error(`Artifact path escapes the staged directory: ${path}`);
  }
  return candidate;
}
