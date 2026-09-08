import { useEffect, useMemo, useRef, useState } from 'react';
import { captureFailureMessage } from './capture-failure';
import { CaptureGallery } from './capture-gallery';
import { DiffViewer } from './diff-viewer';
import { WorkflowCheckpoints } from './workflow-checkpoints';
import { AssessmentPanel } from './assessment-panel';
import type { RunHistoryPage } from '../run-history';
import { Button, Input } from './components';
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
  history?: RunHistoryPage;
  loading?: boolean;
  error?: string;
  onFilter?: (kind: 'project' | 'mode' | 'status', value: string) => void;
  search?: string;
  mode?: string;
  status?: string;
  onRefresh: RefreshModels;
  onReview: (request: ReviewRequest) => Promise<void>;
};
export function RunPanel(props: RunPanelProps) {
  const { state, selectedId, projectId } = props;
  const history = props.history;
  const filtered = !!(props.search || props.mode || props.status || projectId);
  const chosen = state.runs.find(
    (run) => run.id === selectedId && (!projectId || run.projectId === projectId),
  );
  return (
    <>
      <div className="toolbar">
        <select
          id="project-filter"
          aria-label="Filter by project"
          value={projectId}
          onChange={(event) => {
            event.stopPropagation();
            props.onFilter?.('project', event.currentTarget.value);
          }}
        >
          <option value="">All projects</option>
          {state.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <form id="run-search" key={props.search} className="search-form">
          <Input
            aria-label="Search runs"
            name="query"
            defaultValue={props.search}
            placeholder="Project name or run ID"
            maxLength={200}
          />
          <Button type="submit" variant="outline">
            Search runs
          </Button>
        </form>
        <select
          id="run-mode"
          aria-label="Run type"
          value={props.mode ?? ''}
          onChange={(event) => {
            event.stopPropagation();
            props.onFilter?.('mode', event.currentTarget.value);
          }}
        >
          <option value="">All types</option>
          <option value="discovery">Discovery</option>
          <option value="visual">Visual</option>
          <option value="agent">AI E2E</option>
          <option value="review">AI visual review</option>
        </select>
        <select
          id="run-status"
          aria-label="Run status"
          value={props.status ?? ''}
          onChange={(event) => {
            event.stopPropagation();
            props.onFilter?.('status', event.currentTarget.value);
          }}
        >
          <option value="">All statuses</option>
          {['queued', 'running', 'completed', 'blocked', 'cancelled'].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        {filtered && (
          <Button variant="ghost" data-clear-run-filters>
            Clear run filters
          </Button>
        )}
      </div>
      {props.loading ? (
        <p role="status">Loading runs…</p>
      ) : props.error ? (
        <div>
          <p role="alert">{props.error}</p>
          <Button variant="outline" data-retry-run-history>
            Retry run history
          </Button>
        </div>
      ) : history?.total === 0 && filtered ? (
        <div className="empty" role="status">
          <h2>No matching runs</h2>
          <p>Try a project name, part of a run ID, or clear the filters.</p>
        </div>
      ) : (
        <RunTable
          runs={
            history?.runs ?? state.runs.filter((run) => !projectId || run.projectId === projectId)
          }
        />
      )}
      {history && !props.loading && !props.error && (
        <div className="pagination" role="navigation" aria-label="Run history pages">
          <small role="status">
            {history.total
              ? `${history.offset + 1}–${Math.min(history.offset + history.runs.length, history.total)} of ${history.total}`
              : '0'}{' '}
            runs · All stored history
          </small>
          <Button variant="outline" data-run-page="-1" disabled={!history.offset}>
            Previous runs
          </Button>
          <Button
            variant="outline"
            data-run-page="1"
            disabled={history.offset + history.limit >= history.total}
          >
            Next runs
          </Button>
        </div>
      )}
      {chosen && !props.loading && !props.error && (
        <RunDetail {...props} key={chosen.id} run={chosen} />
      )}
    </>
  );
}
function RunDetail({ run, state, onRefresh, onReview }: RunPanelProps & { run: Run }) {
  const result = run.result;
  const changedIds = useMemo(
    () =>
      (result?.captures ?? [])
        .filter((capture) => capture.status === 'changed')
        .map((capture) => capture.id),
    [result],
  );
  const [activeReview, setActiveReview] = useState<string | null>(null);
  const loop = useRef({ changedIds, activeReview });
  loop.current = { changedIds, activeReview };
  useEffect(() => {
    function review(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      )
        return;
      const { changedIds: ids, activeReview: active } = loop.current;
      if (event.key === 'a') {
        const card = active
          ? document.querySelector(`[data-capture-id="${CSS.escape(active)}"]`)
          : null;
        const approve = card?.querySelector<HTMLButtonElement>('[data-approve]');
        if (approve && !approve.disabled) {
          event.preventDefault();
          approve.click();
        }
        return;
      }
      if ((event.key !== 'j' && event.key !== 'k') || !ids.length) return;
      event.preventDefault();
      const current = active ? ids.indexOf(active) : -1;
      const next =
        current === -1
          ? event.key === 'j'
            ? 0
            : ids.length - 1
          : event.key === 'j'
            ? (current + 1) % ids.length
            : (current - 1 + ids.length) % ids.length;
      setActiveReview(ids[next]);
    }
    window.addEventListener('keydown', review);
    return () => window.removeEventListener('keydown', review);
  }, []);
  useEffect(() => {
    if (!activeReview) return;
    document
      .querySelector(`[data-capture-id="${CSS.escape(activeReview)}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeReview]);
  const canEditCapture =
    run.mode === 'visual' &&
    result?.findings?.some(
      (item) => item.kind === 'capture-blocked-check-target-and-privacy-masks',
    ) &&
    state.projects.some((project) => project.id === run.projectId);
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
            <div className="section-heading">
              <h3>Findings and capture diagnostics</h3>
              {canEditCapture && (
                <Button variant="outline" data-edit={run.projectId}>
                  Edit capture settings
                </Button>
              )}
            </div>
            <ul>
              {result.findings.map((item, index) => (
                <li
                  key={`${item.path}:${item.kind}:${index}`}
                  className={item.failurePhase ? 'capture-diagnostic' : undefined}
                >
                  <span>
                    {item.environment && (
                      <>
                        {item.environment.browser} · {item.environment.colorScheme} ·{' '}
                        {item.environment.deviceScaleFactor ?? 1}× ·{' '}
                      </>
                    )}
                    {item.path}
                    {!item.failurePhase && (
                      <>
                        {' '}
                        · {item.kind}: {item.count}
                      </>
                    )}
                  </span>
                  {item.failurePhase && (
                    <>
                      <p>{captureFailureMessage(item.failurePhase)}</p>
                      <small>
                        {item.count} failed checkpoint{item.count === 1 ? '' : 's'}
                      </small>
                    </>
                  )}
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
      <WorkflowCheckpoints run={run} />
      {result?.visualEnvironments && (
        <section aria-label="Visual environments">
          <h3>Visual environments</h3>
          <p className="muted">
            Only the environments below were attempted. Other browsers, themes, locales and
            interaction states remain uncovered.
          </p>
          <ul>
            {result.visualEnvironments.map((cell) => (
              <li key={`${cell.browser}-${cell.colorScheme}-${cell.deviceScaleFactor ?? 1}`}>
                <strong>
                  {cell.browser} · {cell.colorScheme} · {cell.deviceScaleFactor ?? 1}×
                </strong>{' '}
                <Status value={cell.outcome} /> · {cell.captures} captures
                {cell.omittedPages ? (
                  <p>
                    {cell.omittedPages} pages omitted by the shared capture budget. Coverage is
                    incomplete.
                  </p>
                ) : null}
                {cell.reason && <p>{cell.reason}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!!changedIds.length && (
        <p className="muted" data-review-loop-hint>
          Review changed captures from the keyboard: j next · k previous · a approve focused.
        </p>
      )}
      <CaptureGallery key={run.id} captures={result?.captures ?? []}>
        {(capture) => {
          const approved = state.baselines.some(
            (item) => item.run_id === run.id && item.capture_id === capture.id,
          );
          const reviewing = capture.id === activeReview;
          return (
            <article
              className={reviewing ? 'capture capture-reviewing' : 'capture'}
              data-capture-id={capture.id}
              aria-current={reviewing ? 'true' : undefined}
              key={capture.id}
            >
              <div className="capture-head">
                <div>
                  <h3>
                    {capture.path}{' '}
                    <span className="muted">
                      {capture.viewport.width} × {capture.viewport.height}
                    </span>
                  </h3>
                  <p>
                    {capture.environment?.browser ?? 'chromium'} ·{' '}
                    {capture.environment?.colorScheme ?? 'light'} ·{' '}
                    {capture.environment?.deviceScaleFactor ?? 1}×
                  </p>
                  <small>
                    Comparison at capture time:{' '}
                    {capture.status === 'needs-baseline' ? (
                      'no prior baseline'
                    ) : (
                      <Status value={capture.status} />
                    )}{' '}
                    {capture.authenticated && <Status value="signed in" />}{' '}
                    {capture.changedPixels !== undefined && (
                      <>
                        {capture.changedPixels.toLocaleString()} changed pixels
                        {capture.ratio !== undefined && ` · ${(capture.ratio * 100).toFixed(3)}%`}
                      </>
                    )}
                  </small>
                </div>
                {approved ? (
                  <Status value="current approved baseline" />
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
              <DiffViewer runId={run.id} capture={capture} />
              {capture.videoFile && (
                <figure className="capture-video">
                  <video
                    controls
                    preload="metadata"
                    src={`/api/runs/${run.id}/artifacts/${encodeURIComponent(capture.videoFile)}`}
                  />
                  <figcaption>Session video · unmasked, inspect before sharing</figcaption>
                </figure>
              )}
              <AssessmentPanel
                key={capture.assessmentSha256 ?? capture.id}
                runId={run.id}
                file={capture.assessmentFile}
                capture={capture}
              />
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
        }}
      </CaptureGallery>
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
        in a fresh anonymous browser at {capture.viewport.width} × {capture.viewport.height}, with{' '}
        {capture.environment?.deviceScaleFactor ?? 1}× pixel density and the recorded privacy masks.
      </p>
      <div className="review-image">
        <a href={url} target="_blank" rel="noopener">
          <img src={url} alt="Reviewed screenshot with numbered proposed defect regions" />
        </a>
        <svg
          viewBox={`0 0 ${capture.viewport.width * (capture.environment?.deviceScaleFactor ?? 1)} ${capture.viewport.height * (capture.environment?.deviceScaleFactor ?? 1)}`}
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
