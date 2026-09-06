import { ElementInspector } from './element-inspector';
import { parseElementScene, type ElementScene } from '../element-scene';
import { useEffect, useRef, useState } from 'react';
import type { Capture } from '../types';
import type { VisualAssessment, VisualCheck } from '../visual-oracle';
import { Button } from './components';
import { Status } from './run-table';

/** Retrieve the hash-checked numeric report; the UI never changes solver verdicts. */
export function AssessmentPanel({
  runId,
  file,
  capture,
}: {
  runId: string;
  file?: string;
  capture?: Pick<Capture, 'file' | 'viewport' | 'sha256' | 'status'>;
}) {
  const [scene, setScene] = useState<ElementScene>();
  const [report, setReport] = useState<VisualAssessment>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<VisualCheck>();
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [imageAttempt, setImageAttempt] = useState(0);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const preview = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (selected && imageState === 'ready') {
      preview.current?.focus();
      preview.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [selected, imageState]);
  if (!file)
    return (
      <p className="scope-note">
        Measurement report unavailable for this capture. Visual checks remain unverified.
      </p>
    );
  const url = `/api/runs/${runId}/artifacts/${encodeURIComponent(file)}`;
  const visibleChecks =
    report?.checks.filter(
      (check) =>
        (filter === 'all' || check.verdict === filter) &&
        `${check.id} ${check.reason}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  async function load() {
    setPending(true);
    setError('');
    try {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Measurement report unavailable. Sign in again or retry.');
      const value = await response.json();
      if (
        value?.assessment?.schemaVersion !== 1 ||
        !Array.isArray(value.assessment.checks) ||
        !Array.isArray(value.assessment.coverage?.gaps)
      )
        throw new Error('Measurement report format is unsupported.');
      setReport(value.assessment);
      setScene(capture ? parseElementScene(value, capture) : undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Measurement report unavailable.');
    } finally {
      setPending(false);
    }
  }
  return (
    <details
      className="measurement-report"
      onToggle={(event) => {
        if (event.currentTarget.open && !report && !pending && !error) void load();
      }}
    >
      <summary>Measured checks and coverage</summary>
      {pending && <p role="status">Loading measurements…</p>}
      {error && (
        <div>
          <p role="alert">{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            Retry measurements
          </Button>
        </div>
      )}
      {report && (
        <>
          <p>
            Assessment: <Status value={report.verdict} /> · Coverage incomplete
          </p>
          <p className="scope-note">
            A pass applies only to the named predicate. Unverified checks require further evidence.
          </p>
          {capture && !scene && (
            <Button variant="outline" disabled={pending} onClick={() => void load()}>
              Retry element measurements
            </Button>
          )}
          {capture && (
            <ElementInspector
              scene={scene}
              capture={capture}
              runId={runId}
              checks={report.checks}
            />
          )}
          {selected?.region && capture && (
            <figure>
              <figcaption>
                {selected.id} · {selected.verdict} · measured region
              </figcaption>
              {imageState === 'loading' && <p role="status">Loading captured image…</p>}
              {imageState === 'error' && (
                <div>
                  <p role="alert">Captured image could not be loaded.</p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setImageState('loading');
                      setImageAttempt((attempt) => attempt + 1);
                    }}
                  >
                    Retry capture image
                  </Button>
                </div>
              )}
              <div
                style={{ position: 'relative', maxWidth: 800, border: '1px solid var(--border)' }}
              >
                <img
                  key={imageAttempt}
                  alt="Captured viewport for selected measurement"
                  src={`/api/runs/${runId}/artifacts/${encodeURIComponent(capture.file)}?measurement=${imageAttempt}`}
                  width={capture.viewport.width}
                  height={capture.viewport.height}
                  style={{
                    width: '100%',
                    height: 'auto',
                    display: imageState === 'ready' ? 'block' : 'none',
                  }}
                  onLoad={() => setImageState('ready')}
                  onError={() => setImageState('error')}
                />
                {imageState === 'ready' && (
                  <svg
                    ref={preview}
                    tabIndex={-1}
                    role="img"
                    aria-label="Measured text region in captured viewport"
                    viewBox={`0 0 ${capture.viewport.width} ${capture.viewport.height}`}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                    }}
                  >
                    <rect {...selected.region} fill="none" stroke="white" strokeWidth={5} />
                    <rect {...selected.region} fill="none" stroke="#b00020" strokeWidth={2} />
                  </svg>
                )}
              </div>
              <a
                className="inline-flex min-h-8 items-center px-1"
                href={`/api/runs/${runId}/artifacts/${encodeURIComponent(capture.file)}`}
                target="_blank"
                rel="noopener"
              >
                Open full-size capture
              </a>
            </figure>
          )}
          <div className="toolbar">
            <input
              aria-label="Find measurement"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Measurement ID or reason"
            />
            <select
              aria-label="Measurement verdict"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">All checks</option>
              <option value="fail">Failed checks</option>
              <option value="unverified">Unverified checks</option>
              <option value="pass">Passed checks</option>
            </select>
          </div>
          {!visibleChecks.length && <p role="status">No checks match these filters.</p>}
          <ul className="measurement-checks">
            {visibleChecks.map((check) => (
              <li key={check.id}>
                <strong>{check.id}</strong> <Status value={check.verdict} />
                <p>{check.reason}</p>
                {check.observed !== undefined && (
                  <p>
                    Measured ratio: {check.observed.toFixed(3)}:1 (display rounded) · Required:{' '}
                    {check.threshold}:1. Verdict uses the unrounded ratio.
                  </p>
                )}
                {check.region && capture && (
                  <Button variant="outline" onClick={() => setSelected(check)}>
                    Locate measured text
                  </Button>
                )}
                <small>
                  Expected: {check.expected}
                  {check.delta !== undefined ? ` · Delta: ${check.delta}` : ''}
                </small>
                <small>Measurements: {check.measurementIds.join(', ') || 'unavailable'}</small>
              </li>
            ))}
          </ul>
          <details>
            <summary>Unverified coverage</summary>
            <ul>
              {report.coverage.gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </details>
        </>
      )}
      <a href={url} download>
        Download measurement evidence (JSON)
      </a>
    </details>
  );
}
