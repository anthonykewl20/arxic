import { useEffect, useRef, useState } from 'react';
import { Button, Card, Checkbox, Input, Label } from './components';
import { time } from './display';
import type { Workbench } from '../workbench';

type State = ReturnType<Workbench['retentionState']>;
type Preview = ReturnType<Workbench['previewRetention']>;
async function request<T>(path: string, value?: unknown): Promise<T> {
  const response = await fetch(
    `/api/retention${path}`,
    value === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(value),
        },
  );
  const body = await response.json();
  if (!response.ok)
    throw new Error(typeof body.error === 'string' ? body.error : 'Retention request failed');
  return body as T;
}

export function RetentionPanel() {
  const [state, setState] = useState<State>();
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState('30');
  const [keep, setKeep] = useState('20');
  const [consent, setConsent] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const policy = { enabled, maxAgeDays: Number(days), keepLatest: Number(keep) };
  const valid =
    Number.isInteger(policy.maxAgeDays) &&
    policy.maxAgeDays >= 1 &&
    policy.maxAgeDays <= 3650 &&
    Number.isInteger(policy.keepLatest) &&
    policy.keepLatest >= 1 &&
    policy.keepLatest <= 1000;
  const dirty = state && JSON.stringify(policy) !== JSON.stringify(state.policy);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      if (alive.current)
        setError(failure instanceof Error ? failure.message : 'Retention request failed');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function load() {
    await perform(async () => {
      const next = await request<State>('');
      if (!alive.current) return;
      setState(next);
      setEnabled(next.policy.enabled);
      setDays(String(next.policy.maxAgeDays));
      setKeep(String(next.policy.keepLatest));
    });
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, []);
  function changed() {
    setPreview(undefined);
    setConsent(false);
    setNotice('');
    setError('');
  }
  return (
    <Card role="region" aria-label="Evidence retention" className="retention-panel form-stack">
      <div>
        <h2>Evidence retention</h2>
        <p className="muted">
          Keep useful history and remove expired runs automatically. Deletion is permanent.
        </p>
      </div>
      {error && <div role="alert">{error}</div>}
      {notice && <p role="status">{notice}</p>}
      {!state ? (
        <div>
          {busy ? (
            <p role="status">Loading retention settings…</p>
          ) : (
            <Button variant="outline" onClick={() => void load()}>
              Retry retention settings
            </Button>
          )}
        </div>
      ) : (
        <>
          <p>
            <strong>
              {state.policy.enabled
                ? 'Automatic cleanup is enabled.'
                : 'Automatic cleanup is disabled.'}
            </strong>{' '}
            Cleanup runs about once a minute while the queue is idle.
          </p>
          <fieldset disabled={busy} className="form-stack">
            <legend className="sr-only">Retention policy</legend>
            <Checkbox
              label="Automatically delete expired runs"
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked);
                changed();
              }}
            />
            <div className="form-grid">
              <Label>
                Delete runs older than (days)
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  value={days}
                  onChange={(event) => {
                    setDays(event.target.value);
                    changed();
                  }}
                />
              </Label>
              <Label>
                Keep newest runs per project
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={keep}
                  onChange={(event) => {
                    setKeep(event.target.value);
                    changed();
                  }}
                />
              </Label>
            </div>
            <p className="muted">
              Active runs, baselines, and evidence used by reviews or campaigns stay protected. The
              newest runs per project are kept even when expired.
            </p>
            <div>
              <Button
                variant="outline"
                disabled={!valid}
                onClick={() =>
                  void perform(async () => {
                    const next = await request<Preview>('/preview', policy);
                    if (alive.current) setPreview(next);
                  })
                }
              >
                Preview retention
              </Button>
            </div>
            {preview && (
              <div className="form-stack">
                <p>
                  <strong>{preview.candidateCount} eligible for deletion</strong> across{' '}
                  {preview.total} runs. Each cleanup removes at most {preview.batchLimit} eligible
                  runs.
                </p>
                <details>
                  <summary>Why other runs are kept</summary>
                  <ul>
                    {Object.entries(preview.protected).map(([reason, count]) => (
                      <li key={reason}>
                        {
                          {
                            active: 'Active',
                            baseline: 'Baseline evidence',
                            review: 'Review evidence',
                            campaign: 'Campaign evidence',
                            recent: 'Newest per project',
                            age: 'Within age limit',
                            invalid: 'Invalid metadata',
                            pending: 'Deletion awaiting recovery',
                          }[reason]
                        }
                        : {count}
                      </li>
                    ))}
                  </ul>
                </details>
                {preview.candidates.length > 0 && (
                  <div>
                    <h3>Next cleanup batch</h3>
                    <ul className="retention-candidates">
                      {preview.candidates.map((run) => (
                        <li key={run.id}>
                          <strong>
                            {run.projectName} · {run.mode}
                          </strong>
                          <span>{run.id}</span>
                          <small>Finished {time(run.finishedAt)}</small>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {enabled && (
              <Checkbox
                label="I authorize automatic deletion under this policy"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
            )}
            {enabled && !preview && (
              <p className="muted">Preview the affected runs before saving an enabled policy.</p>
            )}
            <div>
              <Button
                disabled={!valid || (enabled && (!consent || !preview))}
                onClick={() =>
                  void perform(async () => {
                    const next = await request<State>('', { ...policy, confirmDeletion: consent });
                    if (!alive.current) return;
                    setState(next);
                    setConsent(false);
                    setNotice('Retention policy saved.');
                  })
                }
              >
                Save retention policy
              </Button>
            </div>
          </fieldset>
          <div className="form-stack">
            {dirty && <p className="muted">Save your changes before running cleanup.</p>}
            <div>
              <Button
                variant="outline"
                disabled={busy || !!dirty || (!state.policy.enabled && !state.pendingDeletions)}
                onClick={() =>
                  void perform(async () => {
                    let result: { deleted: number };
                    try {
                      result = await request<{ deleted: number }>('/cleanup', {});
                    } catch (failure) {
                      // Keep the original cleanup failure even if refreshing status also fails.
                      try {
                        const next = await request<State>('');
                        if (alive.current) setState(next);
                      } catch {
                        /* The cleanup error remains actionable. */
                      }
                      throw failure;
                    }
                    if (!alive.current) return;
                    setNotice(
                      `Deleted ${result.deleted} ${result.deleted === 1 ? 'run' : 'runs'}.`,
                    );
                    const next = await request<State>('');
                    if (!alive.current) return;
                    setState(next);
                    const snapshot = await request<Preview>('/preview', next.policy);
                    if (alive.current) setPreview(snapshot);
                  })
                }
              >
                Clean up now
              </Button>
            </div>
            {state.lastCleanup && (
              <p>
                Last cleanup: {state.lastCleanup.outcome} · {time(state.lastCleanup.at)} ·{' '}
                {state.lastCleanup.deleted} deleted. {state.lastCleanup.message}
              </p>
            )}
            {!!state.pendingDeletions && (
              <p role="status">
                {state.pendingDeletions}{' '}
                {state.pendingDeletions === 1
                  ? 'authorized deletion awaits'
                  : 'authorized deletions await'}{' '}
                recovery. Retry cleanup after fixing storage. These deletions resume after restart
                even if automatic cleanup is disabled.
              </p>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
