import { useState } from 'react';
import { beginPendingRequest, usePendingRequest } from './pending-requests';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { ModelControls, type RefreshModels } from './model-controls';
import type { Capture, Run } from '../types';

export type ReviewDraft = {
  modelConnection: string;
  model: string;
  modelSecretRef: string;
  budgetUsd: string;
  acceptanceCriterion: string;
  inspectedAndAuthorized: boolean;
  open: boolean;
};
export type ReviewRequest = Omit<ReviewDraft, 'budgetUsd' | 'open'> & {
  sourceRunId: string;
  captureId: string;
  sha256: string;
  budgetUsd: number;
};
export const reviewDraftKey = (runId: string, captureId: string, hash: string) =>
  `${runId}:${captureId}:${hash}`;
export const reviewDrafts = new Map<string, ReviewDraft>();
export function ReviewForm({
  run,
  capture,
  onRefresh,
  onReview,
}: {
  run: Run;
  capture: Capture;
  onRefresh: RefreshModels;
  onReview: (request: ReviewRequest) => Promise<void>;
}) {
  const key = reviewDraftKey(run.id, capture.id, capture.sha256);
  const [draft, setDraft] = useState<ReviewDraft>(
    () =>
      reviewDrafts.get(key) ?? {
        modelConnection: run.project.execution?.modelConnection ?? '',
        model: run.project.execution?.model ?? '',
        modelSecretRef: run.project.execution?.modelSecretRef ?? '',
        budgetUsd: String(run.project.execution?.modelBudgetUsd ?? 0.025),
        acceptanceCriterion: '',
        inspectedAndAuthorized: false,
        open: false,
      },
  );
  const pending = usePendingRequest(key);
  const [error, setError] = useState('');
  const change = (patch: Partial<ReviewDraft>) =>
    setDraft((previous) => {
      const next = { ...previous, ...patch };
      reviewDrafts.set(key, next);
      return next;
    });
  return (
    <details
      data-detail-key={key}
      className="review-controls"
      open={draft.open}
      onToggle={(event) => change({ open: event.currentTarget.open })}
    >
      <summary>Ask AI to review this screenshot</summary>
      <form
        data-review-form={key}
        data-run={run.id}
        data-capture={capture.id}
        data-hash={capture.sha256}
        aria-busy={pending}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!draft.inspectedAndAuthorized) return;
          const release = beginPendingRequest(key);
          if (!release) return;
          setError('');
          try {
            await onReview({
              modelConnection: draft.modelConnection,
              model: draft.model,
              modelSecretRef: draft.modelSecretRef,
              acceptanceCriterion: draft.acceptanceCriterion,
              inspectedAndAuthorized: draft.inspectedAndAuthorized,
              budgetUsd: Number(draft.budgetUsd),
              sourceRunId: run.id,
              captureId: capture.id,
              sha256: capture.sha256,
            });
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not submit this review.');
          } finally {
            release();
          }
        }}
      >
        <p>
          Inspect the full current capture above before sharing it with the selected model provider.
          This review covers these pixels only.
        </p>
        <fieldset disabled={pending} className="review-fields">
          <ModelControls
            value={draft}
            onChange={change}
            onRefresh={onRefresh}
            listId={`models-${capture.id}-${run.id}`}
          />
          <label>
            Review model secret reference
            <Input
              name="modelSecretRef"
              maxLength={95}
              placeholder="ARXIC_SECRET_MODEL_KEY"
              value={draft.modelSecretRef}
              onChange={(event) => change({ modelSecretRef: event.target.value })}
            />
            <small>
              Blank uses the selected provider credential. Enter an environment variable name only.
            </small>
          </label>
          <label>
            Review budget estimate (USD)
            <Input
              name="budgetUsd"
              type="number"
              min="0.001"
              max="100"
              step="0.001"
              required
              value={draft.budgetUsd}
              onChange={(event) => change({ budgetUsd: event.target.value })}
            />
          </label>
          <small>
            One request, no automatic retry. The estimate uses a 20,000 input / 4,000 output token
            allowance and is not a billing ceiling. Host-agent usage is operator-managed.
          </small>
          <label>
            Independent acceptance criterion (optional)
            <textarea
              name="acceptanceCriterion"
              maxLength={2000}
              placeholder="Expected behavior or a requirement from your specification"
              value={draft.acceptanceCriterion}
              onChange={(event) => change({ acceptanceCriterion: event.target.value })}
            />
          </label>
          <label className="review-consent">
            <input
              name="inspectedAndAuthorized"
              type="checkbox"
              required
              checked={draft.inspectedAndAuthorized}
              onChange={(event) => change({ inspectedAndAuthorized: event.target.checked })}
            />
            I inspected this screenshot and authorize sending its visible pixels to the configured
            model provider.
          </label>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {pending && <p role="status">Submitting review…</p>}
        <Button
          type="submit"
          className="primary"
          disabled={pending || !draft.inspectedAndAuthorized}
        >
          Review these pixels
        </Button>
      </form>
    </details>
  );
}
