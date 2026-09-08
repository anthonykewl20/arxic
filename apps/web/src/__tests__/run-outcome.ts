import type { Run } from '../types';

/**
 * A journey's setup visual run must fail naming the engine's cause, not a
 * bare "produced no captures" (#502): since #515 a blocked or cancelled run
 * carries a summary and per-finding reasons, and reading captures off a
 * non-completed run is what turned one transient navigation failure into an
 * opaque `expected undefined to be 'changed'` assertion.
 */
export function requireCompletedRun(run: Run | undefined, label: string): Run {
  if (run?.state !== 'completed') {
    const reasons = (run?.result?.findings ?? [])
      .filter((finding) => finding.reason)
      .map((finding) => finding.reason)
      .join(' | ');
    throw new Error(
      `${label} visual run ended ${run?.state ?? 'unknown'}: ${run?.result?.summary ?? 'no summary'}${reasons ? ` — ${reasons}` : ''}`,
    );
  }
  return run;
}
