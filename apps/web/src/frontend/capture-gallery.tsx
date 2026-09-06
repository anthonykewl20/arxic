import { useId, useRef, useState, type ReactNode } from 'react';
import type { Capture } from '../types';
import {
  captureEnvironment,
  capturePageSize,
  captureViewport,
  emptyCaptureFilters,
  selectCaptures,
  type CaptureFilters,
} from '../capture-selection';
import { Button, Input } from './components';

/** Local view state never rewrites run coverage, comparison results or action targets. */
export function CaptureGallery({
  captures,
  children,
}: {
  captures: Capture[];
  children: (capture: Capture) => ReactNode;
}) {
  const [filters, setFilters] = useState(emptyCaptureFilters);
  const [requestedPage, setPage] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const selection = selectCaptures(captures, filters, requestedPage);
  const filtered = Object.values(filters).some(Boolean);
  function change(key: keyof CaptureFilters, value: string) {
    setFilters((old) => ({ ...old, [key]: value }));
    setPage(0);
  }
  function move(page: number) {
    setPage(page);
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: 'start' });
  }
  const choices = (values: string[]) => [...new Set(values)].sort();
  const select = (
    key: keyof CaptureFilters,
    label: string,
    values: string[],
    labels: Record<string, string> = {},
  ) => (
    <label className="grid min-w-0 gap-1" htmlFor={`${id}-${key}`}>
      {label}
      <select
        className="min-h-11 w-full min-w-0"
        id={`${id}-${key}`}
        aria-label={label}
        value={filters[key]}
        onChange={(event) => {
          event.stopPropagation();
          change(key, event.currentTarget.value);
        }}
      >
        <option value="">All</option>
        {values.map((value) => (
          <option key={value} value={value}>
            {labels[value] ?? value}
          </option>
        ))}
      </select>
    </label>
  );
  if (!captures.length) return null;
  return (
    <section aria-label="Capture gallery" className="space-y-4">
      <h3 tabIndex={-1} ref={heading}>
        Captured pages
      </h3>
      <p className="muted">
        Find a page or comparison within this run. Filters change this list only; execution coverage
        above stays unchanged.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid min-w-0 gap-1" htmlFor={`${id}-path`}>
          Search capture paths
          <Input
            className="min-h-11"
            id={`${id}-path`}
            type="search"
            value={filters.path}
            maxLength={200}
            onChange={(event) => {
              event.stopPropagation();
              change('path', event.currentTarget.value);
            }}
            placeholder="/settings"
          />
        </label>
        {select(
          'browser',
          'Capture browser',
          choices(captures.map((c) => captureEnvironment(c).browser)),
        )}
        {select(
          'colorScheme',
          'Capture theme',
          choices(captures.map((c) => captureEnvironment(c).colorScheme)),
        )}
        {select('viewport', 'Capture viewport', choices(captures.map(captureViewport)))}
        {select('status', 'Comparison at capture time', choices(captures.map((c) => c.status)), {
          'needs-baseline': 'No prior baseline',
          changed: 'Changed',
          unchanged: 'Unchanged',
          unstable: 'Unstable',
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <p role="status">
          {selection.total} matching captures of {captures.length}
        </p>
        {filtered && (
          <Button
            className="min-h-11"
            variant="outline"
            onClick={() => {
              setFilters(emptyCaptureFilters);
              setPage(0);
            }}
          >
            Clear capture filters
          </Button>
        )}
      </div>
      {!selection.total ? (
        <p>No captures match these filters. Try another path or clear the capture filters.</p>
      ) : (
        <>
          <nav aria-label="Capture pages" className="flex flex-wrap items-center gap-3">
            <Button
              className="min-h-11"
              variant="outline"
              disabled={selection.page === 0}
              onClick={() => move(selection.page - 1)}
            >
              Previous captures
            </Button>
            <span>
              Page {selection.page + 1} of {selection.pages} ·{' '}
              {selection.page * capturePageSize + 1}–
              {Math.min((selection.page + 1) * capturePageSize, selection.total)}
            </span>
            <Button
              className="min-h-11"
              variant="outline"
              disabled={selection.page + 1 >= selection.pages}
              onClick={() => move(selection.page + 1)}
            >
              Next captures
            </Button>
          </nav>
          {selection.items.map(children)}
        </>
      )}
    </section>
  );
}
