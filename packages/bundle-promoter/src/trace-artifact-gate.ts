import type { ArtifactRef } from '@arxic/contracts';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import {
  classifyTraceCarrierPng,
  DEFAULT_TRACE_ARCHIVE_LIMITS,
  inspectPlaywrightTrace,
  isRetainedScreenshotCheckpointFilename,
  isBoundedPlaywrightTraceArchive,
  isSensitiveArtifactFilename,
  readBoundedFile,
} from '@arxic/playwright-trace-sanitizer';

export type ValidatedTraceArtifact = Readonly<{
  trace: ArtifactRef;
  report: ArtifactRef;
  traceBytes: Buffer;
  provenanceBytes: Buffer;
}>;

export type ValidatedScreenshotArtifact = Readonly<{
  screenshot: ArtifactRef;
  bytes: Buffer;
}>;

export type TraceArtifactGateResult =
  | {
      ok: true;
      traces: ReadonlyMap<string, ValidatedTraceArtifact>;
      screenshots: ReadonlyMap<string, ValidatedScreenshotArtifact>;
    }
  | { ok: false; reason: string };

const screenshotMaxBytes = 32 * 1024 * 1024;
const reportMaxBytes = 1024 * 1024;

/**
 * Action-boundary policy for associating trace bytes with their adjacent provenance.
 * ZIP and Playwright graph mechanics remain owned by the shared sanitizer service.
 */
export async function validateTraceArtifacts(
  artifacts: readonly ArtifactRef[],
): Promise<TraceArtifactGateResult> {
  const screenshots = new Map<string, ValidatedScreenshotArtifact>();
  try {
    for (const artifact of artifacts) {
      if (
        (artifact.kind === 'trace' ||
          artifact.kind === 'screenshot' ||
          artifact.kind === 'trace-sanitization-report') &&
        isSensitiveArtifactFilename(basename(artifact.path)) &&
        !(
          artifact.kind === 'screenshot' &&
          isRetainedScreenshotCheckpointFilename(basename(artifact.path))
        )
      ) {
        return { ok: false, reason: 'Artifact filename contains sensitive context' };
      }
      const maxBytes =
        artifact.kind === 'trace-sanitization-report' ||
        artifact.path.toLowerCase().endsWith('.sanitization.json')
          ? reportMaxBytes
          : artifact.kind === 'screenshot'
            ? screenshotMaxBytes
            : DEFAULT_TRACE_ARCHIVE_LIMITS.maxArchiveBytes;
      const bytes = await readBoundedFile(artifact.path, maxBytes);
      const pngClassification = await classifyTraceCarrierPng(bytes);
      const png = pngClassification === 'safe-png';
      if (pngClassification === 'embedded-playwright-trace') {
        return { ok: false, reason: 'PNG ancillary content contains a ZIP archive' };
      }
      const traceArchive =
        !png &&
        (await isBoundedPlaywrightTraceArchive(bytes, {
          maxArchiveBytes: DEFAULT_TRACE_ARCHIVE_LIMITS.maxArchiveBytes,
        }));
      if (traceArchive && artifact.kind !== 'trace') {
        return { ok: false, reason: 'ZIP content is not classified as a trace' };
      }
      if (artifact.kind === 'trace' && !traceArchive) {
        return { ok: false, reason: 'Trace artifact does not contain ZIP structure' };
      }
      if (artifact.path.toLowerCase().endsWith('.zip') && artifact.kind !== 'trace') {
        return { ok: false, reason: 'ZIP artifact is not classified as a trace' };
      }
      if (artifact.kind === 'trace' && !artifact.path.toLowerCase().endsWith('.zip')) {
        return { ok: false, reason: 'Trace artifact is not a ZIP path' };
      }
      if (png && artifact.kind !== 'screenshot') {
        return { ok: false, reason: 'PNG content has an incompatible artifact kind' };
      }
      if (artifact.kind === 'screenshot') {
        if (!png) {
          return { ok: false, reason: 'Screenshot artifact is not a strict PNG' };
        }
        if (sha256(bytes) !== artifact.sha256) {
          return { ok: false, reason: 'Screenshot artifact hash mismatch' };
        }
        screenshots.set(artifact.path, { screenshot: artifact, bytes });
      }
    }
  } catch {
    return { ok: false, reason: 'Artifact is unreadable or exceeds its safety limit' };
  }
  const mislabeledReport = artifacts.find(
    ({ kind, path }) =>
      path.toLowerCase().endsWith('.sanitization.json') && kind !== 'trace-sanitization-report',
  );
  if (mislabeledReport) {
    return { ok: false, reason: 'Sanitization sidecar has an incompatible artifact kind' };
  }
  const invalidReportPath = artifacts.find(
    ({ kind, path }) =>
      kind === 'trace-sanitization-report' &&
      !path.toLowerCase().endsWith('.zip.sanitization.json'),
  );
  if (invalidReportPath) {
    return { ok: false, reason: 'Trace sanitization report has an incompatible path' };
  }
  const traces = artifacts.filter(({ kind }) => kind === 'trace');
  const reports = artifacts.filter(({ kind }) => kind === 'trace-sanitization-report');
  if (new Set(traces.map(({ path }) => path)).size !== traces.length) {
    return { ok: false, reason: 'Duplicate trace artifact path' };
  }
  if (new Set(reports.map(({ path }) => path)).size !== reports.length) {
    return { ok: false, reason: 'Duplicate trace sanitization report path' };
  }

  const matched = new Map<string, ValidatedTraceArtifact>();
  try {
    for (const trace of traces) {
      const report = reports.find(({ path }) => path === `${trace.path}.sanitization.json`);
      if (!report) return { ok: false, reason: 'Trace artifact lacks sanitization provenance' };
      const inspected = await inspectPlaywrightTrace({
        tracePath: trace.path,
        provenancePath: report.path,
      });
      if (!inspected.ok) {
        return { ok: false, reason: `Trace artifact failed sanitization (${inspected.code})` };
      }
      if (inspected.traceSha256 !== trace.sha256 || inspected.provenanceSha256 !== report.sha256) {
        return { ok: false, reason: 'Trace artifact or provenance hash mismatch' };
      }
      matched.set(trace.path, {
        trace,
        report,
        traceBytes: inspected.traceBytes,
        provenanceBytes: inspected.provenanceBytes,
      });
    }
  } catch {
    return { ok: false, reason: 'Trace artifact or sanitization provenance is unreadable' };
  }

  if (
    reports.some(({ path }) => !traces.some((trace) => path === `${trace.path}.sanitization.json`))
  ) {
    return { ok: false, reason: 'Trace sanitization report has no matching trace artifact' };
  }
  return { ok: true, traces: matched, screenshots };
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
