import {
  serializeScreenshotPrivacyPolicy,
  type ScreenshotPrivacyPolicy,
} from '../../../packages/playwright-screenshot-privacy/src';
export type CheckpointCapture = ScreenshotPrivacyPolicy['capture'];

/** One existing privacy contract validates config, guided settings and execution. */
export function validateCheckpointCapture(capture: unknown): CheckpointCapture {
  return serializeScreenshotPrivacyPolicy({
    schemaVersion: 1,
    id: 'checkpoint-validation',
    authority: {
      kind: 'repository-policy',
      reference: 'arxic.yaml:policy.checkpointCapture',
      recordedAt: '2026-09-06T00:00:00.000Z',
    },
    capture,
  }).policy.capture;
}

export function checkpointPrivacyPolicy(
  capture: CheckpointCapture | undefined,
  runId: string,
  recordedAt: string,
): ScreenshotPrivacyPolicy {
  return serializeScreenshotPrivacyPolicy({
    schemaVersion: 1,
    id: `${runId}-${capture ? 'checkpoints' : 'cli-main-mask'}`,
    authority: {
      kind: 'repository-policy',
      reference: capture ? 'arxic.yaml:policy.checkpointCapture' : 'arxic.yaml:policy.screenshots',
      recordedAt,
    },
    capture: capture ?? {
      mode: 'masked-page',
      fullPage: true,
      masks: [{ kind: 'role', role: 'main', exact: true }],
    },
  }).policy;
}
