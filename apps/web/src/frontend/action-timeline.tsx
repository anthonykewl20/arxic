import { useEffect, useState } from 'react';
import { browserName, sizeName, themeName } from '../plain-words';
import { captureForStep, stepsForCaptures, type ActionStep } from '../action-log';
import type { Capture } from '../types';

/**
 * What Arxic actually did, in order, said in words.
 *
 * Every visual run records a sanitized action log — navigate, sign in, mask,
 * photograph — and until now the dashboard offered it as a link to raw JSON.
 * A recording of the session would be more direct, but video frames cannot
 * carry the privacy masks a screenshot gets, so the product refuses to record
 * one. This is what can be shown honestly instead: the same steps, in the same
 * order, readable.
 *
 * Fetched on disclosure rather than with the run: the log is per-run evidence
 * that only matters once somebody asks how a screenshot came about.
 */

/** Each recorded action, as the thing it did rather than the routine that did it. */
const actions: Record<string, { label: string; detail?: (result: string) => string }> = {
  'crawl-same-origin-links': {
    label: 'Followed the links on your pages',
    detail: (result) => `Found ${result.replace(' visited,', ' pages by visiting') || result}.`,
  },
  'sign-in-form': {
    label: 'Signed in',
    detail: (result) =>
      result === 'failed'
        ? 'The form was filled and submitted, but the page stayed put.'
        : `Filled the form, finding its fields by ${result.replace('fields by ', '')}.`,
  },
  navigate: { label: 'Opened the page' },
  'capture-input-masked-viewport': {
    label: 'Photographed the page',
    detail: (result) =>
      result === 'stable'
        ? 'The page had stopped moving, so the screenshot can be compared.'
        : 'The page was still moving, so this screenshot was not compared.',
  },
  'capture-isolated-regions': {
    label: 'Photographed parts of the page on their own',
    detail: (result) => `${result}, so a neighbour's height change cannot flag them.`,
  },
  'capture-refused': {
    label: 'Could not photograph the page',
    detail: () => 'The page could not be reached, or a privacy mask never appeared.',
  },
  'environment-refused': {
    label: 'A browser would not start',
    detail: () => 'Nothing was photographed in it. Check the browsers installed on this server.',
  },
};

const describe = (entry: ActionStep) => {
  const known = actions[entry.action];
  if (!known) return { label: entry.action.replace(/-/gu, ' '), detail: entry.result };
  return {
    label: known.label,
    detail: entry.result && known.detail ? known.detail(entry.result) : undefined,
  };
};

export function ActionTimeline({
  runId,
  captures,
  label = 'What Arxic did on this run',
}: {
  runId: string;
  /** Given, the log is narrowed to the steps that produced these captures. */
  captures?: Capture[];
  label?: string;
}) {
  const [entries, setEntries] = useState<ActionStep[]>();
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || entries || error) return;
    let live = true;
    void fetch(`/api/runs/${runId}/artifacts/timeline.json`, { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('gone'))))
      .then((value) => live && setEntries(Array.isArray(value) ? value : []))
      .catch(() => live && setError('The action log for this run is no longer available.'));
    return () => {
      live = false;
    };
  }, [open, runId, entries, error]);
  const steps = entries && (captures ? stepsForCaptures(entries, captures) : entries);
  return (
    <details
      className="action-timeline"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      data-action-timeline
    >
      <summary>{label}</summary>
      {error && <p role="alert">{error}</p>}
      {!entries && !error && <p role="status">Reading the action log…</p>}
      {steps && !steps.length && <p>Nothing was recorded for this page.</p>}
      {steps && steps.length > 0 && (
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px]">
          {steps.map((entry, index) => {
            const words = describe(entry);
            const shot = captures && captureForStep(entry, captures);
            return (
              <li key={`${entry.action}-${index}`}>
                {words.label}
                {/* A run merges every browser's log, and photographs each path
                    once per screen size, so two lines can otherwise read
                    identically. Each says which one it belongs to. */}
                {entry.environment && (
                  <span className="text-[var(--foreground-muted)]">
                    {' '}
                    in {browserName(entry.environment.browser)},{' '}
                    {themeName(entry.environment.colorScheme).toLowerCase()}
                    {shot ? `, ${sizeName(shot.viewport.width).toLowerCase()}` : ''}
                  </span>
                )}
                {words.detail && (
                  <span className="block text-[12px] text-[var(--foreground-muted)]">
                    {words.detail}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p className="muted text-[12px]">
        Field values never enter this log. The exact bytes and how they were sanitized stay
        downloadable: <a href={`/api/runs/${runId}/artifacts/timeline.json`}>the log itself</a> and{' '}
        <a href={`/api/runs/${runId}/artifacts/timeline.sanitization.json`}>its provenance</a>.
      </p>
    </details>
  );
}
