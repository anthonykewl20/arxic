import { Button } from './components/ui/button';
import { RunTable, Status } from './run-table';
import { ReviewForm, reviewDraftKey, type ReviewRequest } from './review-form';
import { time } from './display';
import type { RefreshModels } from './model-controls';
import type { Run } from '../types';
import type { Workbench } from '../workbench';

export type RunPanelProps = {
  state: ReturnType<Workbench['state']>;
  selectedId: string;
  projectId: string;
  onRefresh: RefreshModels;
  onReview: (request: ReviewRequest) => Promise<void>;
};
export function RunPanel(props: RunPanelProps) {
  const { state, selectedId, projectId } = props;
  const chosen = state.runs.find(
    (run) => run.id === selectedId && (!projectId || run.projectId === projectId),
  );
  return (
    <>
      <div className="toolbar">
        <select id="project-filter" aria-label="Filter by project" defaultValue={projectId}>
          <option value="">All projects</option>
          {state.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <small>Latest 200 runs. All results persist on this instance.</small>
      </div>
      <RunTable runs={state.runs.filter((run) => !projectId || run.projectId === projectId)} />
      {chosen && <RunDetail {...props} key={chosen.id} run={chosen} />}
    </>
  );
}
function CaptureFigure({ label, runId, file }: { label: string; runId?: string; file?: string }) {
  const url = file ? `/api/runs/${runId}/artifacts/${encodeURIComponent(file)}` : '';
  return (
    <figure>
      <figcaption>{label}</figcaption>
      {file ? (
        <a href={url} target="_blank" rel="noopener">
          <img alt={label} src={url} />
        </a>
      ) : (
        <div className="placeholder">Awaiting a reviewed baseline</div>
      )}
    </figure>
  );
}
function RunDetail({ run, state, onRefresh, onReview }: RunPanelProps & { run: Run }) {
  const result = run.result;
  return (
    <section className="run-detail">
      <div className="section-heading">
        <div>
          <h2>
            {run.project.name} / {run.mode}
          </h2>
          <small>{run.id}</small>
        </div>
        {['running', 'queued'].includes(run.state) ? (
          <Button variant="destructive" className="danger" data-cancel={run.id}>
            Cancel run
          </Button>
        ) : run.visualReview ? (
          <Button
            variant="outline"
            className="secondary"
            data-open-run={run.visualReview.sourceRunId}
          >
            View source capture
          </Button>
        ) : run.workflowScope ? (
          <Button
            variant="outline"
            className="secondary"
            data-open-campaign={run.workflowScope.campaignId}
          >
            View campaign
          </Button>
        ) : (
          <Button
            variant="outline"
            className="secondary"
            data-start={run.mode}
            data-project={run.projectId}
          >
            Run again
          </Button>
        )}
      </div>
      <div className="panel">
        <div className="result-summary">
          <Status value={run.state} /> {result && <Status value={result.outcome} />}
          <p>{result?.summary ?? 'The job is queued or running. Results update automatically.'}</p>
        </div>
        {!!result?.findings?.length && (
          <div className="findings">
            <h3>Observed frontend findings</h3>
            <ul>
              {result.findings.map((item, index) => (
                <li key={`${item.path}:${item.kind}:${index}`}>
                  {item.path} · {item.kind}: {item.count}
                </li>
              ))}
            </ul>
          </div>
        )}
        {(!!result?.engineRun || !!result?.diagnostics) && (
          <details>
            <summary>Engine diagnostics and evidence</summary>
            <pre>
              {JSON.stringify({ diagnostics: result.diagnostics, run: result.engineRun }, null, 2)}
            </pre>
          </details>
        )}
      </div>
      {(result?.captures ?? []).map((capture) => {
        const approved = state.baselines.some(
          (item) => item.run_id === run.id && item.capture_id === capture.id,
        );
        return (
          <article className="capture" key={capture.id}>
            <div className="capture-head">
              <div>
                <h3>
                  {capture.path}{' '}
                  <span className="muted">
                    {capture.viewport.width} × {capture.viewport.height}
                  </span>
                </h3>
                <small>
                  <Status value={capture.status} />{' '}
                  {capture.changedPixels !== undefined && (
                    <>
                      {capture.changedPixels.toLocaleString()} changed pixels
                      {capture.ratio !== undefined && ` · ${(capture.ratio * 100).toFixed(3)}%`}
                    </>
                  )}
                </small>
              </div>
              {approved ? (
                <Status value="approved baseline" />
              ) : (
                run.state === 'completed' &&
                capture.status !== 'unstable' && (
                  <Button
                    variant="outline"
                    className="secondary"
                    data-approve={capture.id}
                    data-run={run.id}
                  >
                    Approve as baseline
                  </Button>
                )
              )}
            </div>
            <div className="compare">
              <CaptureFigure
                label="Approved baseline"
                runId={capture.baselineRunId}
                file={capture.baselineFile}
              />
              <CaptureFigure label="Current capture" runId={run.id} file={capture.file} />
              <CaptureFigure label="Pixel difference" runId={run.id} file={capture.diffFile} />
            </div>
            {run.state === 'completed' && capture.status !== 'unstable' && (
              <ReviewForm
                key={reviewDraftKey(run.id, capture.id, capture.sha256)}
                run={run}
                capture={capture}
                onRefresh={onRefresh}
                onReview={onReview}
              />
            )}
          </article>
        );
      })}
      <VisualReviewPanel run={run} />
      {run.workflowScope ? (
        <p className="scope-note">
          Kept as campaign evidence. Start another selected campaign from Intent inventory to test
          again.
        </p>
      ) : (
        !['queued', 'running'].includes(run.state) && (
          <p className="section-heading">
            <Button variant="destructive" className="danger" data-delete-run={run.id}>
              Delete run and artifacts
            </Button>
          </p>
        )
      )}
      {!!result?.captures?.length && (
        <div className="scope-note">
          Inputs are masked. Review all remaining pixels before sharing. Baseline approval records
          your visual decision; it does not assign a verified business outcome. Captures cover
          configured viewports and paths only.{' '}
          <a href={`/api/runs/${run.id}/artifacts/timeline.json`}>Action timeline</a> ·{' '}
          <a href={`/api/runs/${run.id}/artifacts/timeline.sanitization.json`}>
            Sanitization provenance
          </a>
        </div>
      )}
    </section>
  );
}
function VisualReviewPanel({ run }: { run: Run }) {
  const review = run.result?.review;
  if (!review) return null;
  const capture = review.capture;
  const url = `/api/runs/${review.sourceRunId}/artifacts/${encodeURIComponent(capture.file)}`;
  return (
    <section className="panel visual-review-result">
      <h3>AI visual hypotheses</h3>
      <p>{review.coverage}</p>
      <Button variant="ghost" className="text-button" data-open-run={review.sourceRunId}>
        View source capture and reproduction →
      </Button>
      <p>
        Reproduce: open{' '}
        <a href={run.project.origin + capture.path} target="_blank" rel="noopener">
          {capture.path}
        </a>{' '}
        in a fresh anonymous browser at {capture.viewport.width} × {capture.viewport.height}, with
        the recorded privacy masks.
      </p>
      <div className="review-image">
        <a href={url} target="_blank" rel="noopener">
          <img src={url} alt="Reviewed screenshot with numbered proposed defect regions" />
        </a>
        <svg
          viewBox={`0 0 ${capture.viewport.width} ${capture.viewport.height}`}
          aria-label="Proposed regions"
          role="img"
        >
          {review.findings.map((finding, index) => (
            <g key={finding.id}>
              <title>{finding.title}</title>
              <rect
                x={finding.region.x}
                y={finding.region.y}
                width={finding.region.width}
                height={finding.region.height}
              />
              <text x={finding.region.x + 4} y={finding.region.y + 18}>
                {index + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p>
        <strong>Independent criterion:</strong>{' '}
        {review.acceptanceCriterion || 'None supplied. Independent acceptance coverage is missing.'}
      </p>
      {review.findings.length ? (
        review.findings.map((finding, index) => (
          <article className="review-finding" key={finding.id}>
            <h4>
              {index + 1}. {finding.title} <Status value={finding.truthState} />
            </h4>
            <p>{finding.description}</p>
            <p>
              <strong>Suggested check (AI proposal):</strong> {finding.suggestedCheck}
            </p>
            <small>
              {finding.severity} · region {finding.region.x}, {finding.region.y},{' '}
              {finding.region.width} × {finding.region.height}
            </small>
          </article>
        ))
      ) : (
        <p>No defect hypotheses returned. This does not establish a defect-free frontend.</p>
      )}
      <details>
        <summary>Image and model provenance</summary>
        <p>
          Sharing authorized {time(review.inspectedAndAuthorizedAt)}. Estimated cost: $
          {review.estimatedCostUsd.toFixed(6)}.
        </p>
        <pre>
          {JSON.stringify({ imageSha256: capture.sha256, model: review.runRecord }, null, 2)}
        </pre>
      </details>
    </section>
  );
}
