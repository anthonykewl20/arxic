import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ArtifactRef } from '@arxic/contracts';
import { discoverCaptureArtifactCandidates } from './artifact-discovery';
import {
  discardCapturedArtifact,
  isSensitiveArtifactFilename,
  sanitizeCapturedPlaywrightTrace,
  type TraceSanitizationFailure,
} from './trace-sanitizer';
import {
  isPolicyOwnedScreenshotFilename,
  readTraceCarrierFreePng,
  validateScreenshotCheckpointFilenames,
} from './trace-carrier-classifier';

export type CaptureRetentionFailureCode =
  | 'CAPTURE_DESTINATION_FAILED'
  | 'CAPTURE_SOURCE_REJECTED'
  | 'SCREENSHOT_REJECTED'
  | 'TRACE_SANITIZATION_FAILED'
  | 'SCREENSHOT_CHECKPOINT_MAPPING_FAILED'
  | 'CAPTURE_FAILED'
  | 'CAPTURE_CLEANUP_FAILED';

export type RetainCaptureArtifactsResult =
  | Readonly<{ ok: true; refs: ArtifactRef[] }>
  | Readonly<{
      ok: false;
      code: CaptureRetentionFailureCode;
      message: string;
      missingCheckpoints?: readonly string[];
      traceFailure?: TraceSanitizationFailure;
    }>;

export async function retainCaptureArtifacts(input: {
  roots: readonly string[];
  destination: string;
  forbiddenSubstrings?: readonly string[];
  screenshotCheckpoints?: readonly string[];
}): Promise<RetainCaptureArtifactsResult> {
  const forbiddenSubstrings = input.forbiddenSubstrings ?? [];
  const screenshotCheckpoints = input.screenshotCheckpoints ?? [];
  const refs: ArtifactRef[] = [];
  const screenshotSourceNames: string[] = [];
  const sequences = { screenshot: 0, trace: 0 };
  let destinationReady = false;
  let failure: Exclude<RetainCaptureArtifactsResult, { ok: true }> | undefined;
  try {
    await rm(input.destination, { recursive: true, force: true });
    await mkdir(input.destination, { recursive: true });
    destinationReady = true;
    const files = await discoverCaptureArtifactCandidates(input.roots);
    for (const source of files) {
      const sourceName = basename(source);
      const kind = source.endsWith('.png') ? 'screenshot' : 'trace';
      const policyOwnedScreenshot =
        kind === 'screenshot' && isPolicyOwnedScreenshotFilename(sourceName, screenshotCheckpoints);
      if (isSensitiveArtifactFilename(sourceName, forbiddenSubstrings) && !policyOwnedScreenshot) {
        failure = await rejectCapturedSource(
          source,
          'CAPTURE_SOURCE_REJECTED',
          'Artifact source filename rejected by retention policy',
        );
        break;
      }
      sequences[kind] += 1;
      if (kind === 'screenshot') {
        const screenshot = await readTraceCarrierFreePng(source);
        if (!screenshot.ok) {
          failure = await rejectCapturedSource(
            source,
            'SCREENSHOT_REJECTED',
            'Screenshot source is not a strict trace-carrier-free PNG',
          );
          break;
        }
        screenshotSourceNames.push(sourceName);
        const retainedName = policyOwnedScreenshot
          ? `${String(sequences.screenshot).padStart(3, '0')}-${sourceName}`
          : `screenshot-${String(sequences.screenshot).padStart(3, '0')}.png`;
        const target = join(input.destination, retainedName);
        await writeFile(target, screenshot.bytes);
        refs.push(await artifactRef('screenshot', target));
        continue;
      }
      const target = join(
        input.destination,
        `trace-${String(sequences.trace).padStart(3, '0')}.zip`,
      );
      const provenancePath = `${target}.sanitization.json`;
      const sanitized = await sanitizeCapturedPlaywrightTrace({
        sourcePath: source,
        outputPath: target,
        provenancePath,
        forbiddenSubstrings,
      });
      if (!sanitized.ok) {
        failure = {
          ok: false,
          code: 'TRACE_SANITIZATION_FAILED',
          message: `Trace sanitization failed (${sanitized.code}: ${sanitized.message})`,
          traceFailure: sanitized,
        };
        break;
      }
      refs.push(
        await artifactRef('trace', target),
        await artifactRef('trace-sanitization-report', provenancePath),
      );
    }
    if (!failure) {
      const mapping = validateScreenshotCheckpointFilenames(
        screenshotSourceNames,
        screenshotCheckpoints,
        forbiddenSubstrings,
      );
      if (!mapping.ok) {
        failure = {
          ok: false,
          code: 'SCREENSHOT_CHECKPOINT_MAPPING_FAILED',
          message: `Screenshot checkpoint mapping failed (${mapping.code})${mapping.missingCheckpoint ? `: ${mapping.missingCheckpoint}` : ''}`,
          ...(mapping.missingCheckpoint ? { missingCheckpoints: [mapping.missingCheckpoint] } : {}),
        };
      }
    }
  } catch (error) {
    failure = {
      ok: false,
      code: destinationReady ? 'CAPTURE_FAILED' : 'CAPTURE_DESTINATION_FAILED',
      message: errorMessage(error),
    };
  }
  if (!failure) return { ok: true, refs };
  try {
    await rm(input.destination, { recursive: true, force: true });
  } catch (cleanup) {
    return {
      ok: false,
      code: 'CAPTURE_CLEANUP_FAILED',
      message: `Artifact capture destination cleanup failed; primary: ${failure.code}: ${failure.message}; cleanup: ${errorMessage(cleanup)}`,
      ...(failure.traceFailure ? { traceFailure: failure.traceFailure } : {}),
    };
  }
  return failure;
}

async function rejectCapturedSource(
  source: string,
  code: 'CAPTURE_SOURCE_REJECTED' | 'SCREENSHOT_REJECTED',
  message: string,
): Promise<Exclude<RetainCaptureArtifactsResult, { ok: true }>> {
  const discarded = await discardCapturedArtifact(source);
  return {
    ok: false,
    code,
    message: discarded.ok ? message : `${message}; source cleanup ${discarded.sourceDisposition}`,
  };
}

async function artifactRef(kind: string, path: string): Promise<ArtifactRef> {
  const bytes = await readFile(path);
  return { kind, path, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
