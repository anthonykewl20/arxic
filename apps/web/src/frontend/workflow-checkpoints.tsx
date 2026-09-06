import { useState } from 'react';
import { Button } from './components';
import type { Run } from '../types';
import type { WorkflowCapture } from '../workflow-captures';
import { time } from './display';
function CheckpointImage({ runId, capture }: { runId: string; capture: WorkflowCapture }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const url = `/api/runs/${runId}/artifacts/${encodeURIComponent(capture.file)}`;
  return (
    <article className="capture">
      <h4>
        {capture.id} · {capture.width} × {capture.height}
      </h4>
      <p>
        {capture.mode === 'approved-region' ? 'Approved region' : 'Masked page'} ·{' '}
        {time(capture.capturedAt)}
      </p>
      {status !== 'ready' && (
        <p role="status">
          {status === 'error'
            ? 'Screenshot unavailable. Its file may be missing or changed.'
            : 'Loading workflow screenshot…'}
        </p>
      )}
      <img
        key={retry}
        src={`${url}?attempt=${retry}`}
        alt={`Workflow ${capture.id}`}
        hidden={status === 'error'}
        onLoad={() => setStatus('ready')}
        onError={() => setStatus('error')}
        className="checkpoint-image"
      />
      {status === 'error' ? (
        <Button
          variant="outline"
          onClick={() => {
            setStatus('loading');
            setRetry(retry + 1);
          }}
        >
          Retry screenshot
        </Button>
      ) : status === 'ready' ? (
        <p>
          <a href={url} target="_blank" rel="noopener">
            Open full-size {capture.id}
          </a>
        </p>
      ) : null}
      <details>
        <summary>Checkpoint evidence and privacy</summary>
        <p>
          Original evidence file: {capture.originalFile}. The gallery copy retains the original
          image bytes and provenance.
        </p>
        <p>
          <a
            href={`/api/runs/${runId}/artifacts/${encodeURIComponent(capture.privacyFile)}`}
            target="_blank"
            rel="noopener"
          >
            View privacy provenance for {capture.id}
          </a>
        </p>
        <p className="muted checkpoint-hash">Image SHA-256: {capture.sha256}</p>
      </details>
    </article>
  );
}
export function WorkflowCheckpoints({ run }: { run: Run }) {
  const captures = run.result?.workflowCaptures ?? [];
  const gap = run.result?.workflowCaptureGap;
  if (!captures.length && !gap) return null;
  return (
    <section aria-label="Workflow checkpoints" className="panel">
      <h3>Workflow checkpoints</h3>
      <p>
        Captured during verifier replays. These show workflow states; visual baseline comparison and
        a full UI audit are separate checks.
      </p>
      {gap && <p role="status">{gap}</p>}
      {captures.map((capture) => (
        <CheckpointImage key={capture.id} runId={run.id} capture={capture} />
      ))}
    </section>
  );
}
