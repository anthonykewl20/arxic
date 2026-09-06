import { useState } from 'react';
import type { VisualAssessment } from '../visual-oracle';
import { Button } from './components';
import { Status } from './run-table';

/** Retrieve the hash-checked numeric report; the UI never changes solver verdicts. */
export function AssessmentPanel({ runId, file }: { runId: string; file?: string }) {
  const [report, setReport] = useState<VisualAssessment>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (!file)
    return (
      <p className="scope-note">
        Measurement report unavailable for this capture. Visual checks remain unverified.
      </p>
    );
  const url = `/api/runs/${runId}/artifacts/${encodeURIComponent(file)}`;
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
          <ul className="measurement-checks">
            {report.checks.map((check) => (
              <li key={check.id}>
                <strong>{check.id}</strong> <Status value={check.verdict} />
                <p>{check.reason}</p>
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
