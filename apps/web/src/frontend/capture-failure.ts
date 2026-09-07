import type { CaptureFailurePhase } from '../types';

/** Recovery copy reports the attempted operation, without claiming its underlying cause. */
export function captureFailureMessage(phase: CaptureFailurePhase): string {
  switch (phase) {
    case 'navigation':
      return 'Navigation failed. Check the page address, access and server response.';
    case 'readiness':
      return 'Page readiness failed. Check that the page and its fonts finish loading.';
    case 'measurement':
      return 'Page measurement failed. Check that the page remains available during capture.';
    case 'privacy-capture':
      return 'Masked capture failed. Check required privacy masks and browser capture support.';
    case 'evidence-write':
      return 'Evidence could not be saved. Check storage space and write permissions.';
    default:
      return 'Capture failed. Check the target and capture settings.';
  }
}
