import { RetentionPanel } from './retention-panel';
import { RunPanel, type RunPanelProps } from './run-panel';
import { RunTable, Status } from './run-table';
import { time } from './display';
import { InventoryPanel, type InventoryPanelProps } from './inventory-panel';
import { CampaignPanel, type CampaignPanelProps } from './campaign-panel';
import { createRoot, type Root } from 'react-dom/client';
import { useState } from 'react';
import { FolderGit2, ArrowUpRight, Clock3, ShieldCheck, FolderLock, Plus } from 'lucide-react';
import { Button, Card, CardContent, Input, StatusDot, toneOf } from './components';
import type { Workbench } from '../workbench';

type State = ReturnType<Workbench['state']>;
function projectHealth(state: State, id: string) {
  const runs = state.runs.filter((run) => run.projectId === id);
  const latest = runs[0];
  if (!latest) return { tone: 'neutral' as const, label: 'No runs yet' };
  if (['queued', 'running'].includes(latest.state))
    return { tone: 'info' as const, label: latest.state === 'queued' ? 'Queued' : 'Running' };
  const outcome = latest.result?.outcome ?? latest.state;
  const changed = latest.result?.captures?.some((capture) => capture.status === 'changed');
  if (changed) return { tone: 'warning' as const, label: 'Visual changes' };
  return { tone: toneOf(outcome), label: outcome.charAt(0).toUpperCase() + outcome.slice(1) };
}
function Overview({ state }: { state: State }) {
  const stats = [
    { label: 'Projects', value: state.projects.length, caption: 'Connected on this instance' },
    {
      label: 'Active runs',
      value: state.runs.filter((run) => ['queued', 'running'].includes(run.state)).length,
      caption: 'Queued and running',
    },
    {
      label: 'Visual changes',
      value: state.runs.filter((run) =>
        run.result?.captures?.some((capture) => capture.status === 'changed'),
      ).length,
      caption: 'In the latest 200 runs',
    },
    {
      label: 'Active schedules',
      value: state.projects.filter((item) => item.cron && !item.paused).length,
      caption: 'UTC · server must be running',
    },
  ];
  const columns = 'minmax(0, 2fr) minmax(0, 2fr) 120px 110px 270px';
  return (
    <>
      <div className="stats">
        {stats.map(({ label, value, caption }) => (
          <Card className="stat" key={label}>
            <span className="stat-label">{label}</span>
            <strong>{value}</strong>
            <small>{caption}</small>
          </Card>
        ))}
      </div>
      <div className="section">
        <div className="section-heading">
          <h2>Projects</h2>
          <small>{state.projects.length} connected</small>
        </div>
        {state.projects.length ? (
          <div className="panel list project-grid" style={{ display: 'flex' }}>
            <div className="list-row list-head" style={{ gridTemplateColumns: columns }}>
              <span>Name</span>
              <span>Source</span>
              <span>Status</span>
              <span>Schedule</span>
              <span />
            </div>
            {state.projects.map((item) => {
              const health = projectHealth(state, item.id);
              return (
                <div className="list-row" key={item.id} style={{ gridTemplateColumns: columns }}>
                  <div className="list-name">
                    <FolderGit2 size={16} aria-hidden="true" />
                    <h3>{item.name}</h3>
                    <Button variant="ghost" size="sm" className="text-button" data-edit={item.id}>
                      Settings
                    </Button>
                  </div>
                  <span className="folder">{item.folder}</span>
                  <StatusDot tone={health.tone}>{health.label}</StatusDot>
                  <span className="muted text-xs">
                    {item.cron && !item.paused ? `${item.cron} UTC` : 'On demand'}
                  </span>
                  <div className="list-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      data-start="discovery"
                      data-project={item.id}
                    >
                      Discover intents
                    </Button>
                    <Button variant="outline" size="sm" data-start="visual" data-project={item.id}>
                      Visual test
                    </Button>
                    <Button variant="outline" size="sm" data-start="agent" data-project={item.id}>
                      AI E2E
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty">
            <FolderGit2 size={24} aria-hidden="true" />
            <h2>Connect your first project</h2>
            <p className="muted">
              Pick a folder on this server or paste a GitHub URL. Arxic inventories the source
              first; add a running test app later for visual and AI runs.
            </p>
            <Button data-add>
              <Plus /> Connect project
            </Button>
          </div>
        )}
      </div>
      <div className="scope-note">
        <strong>Coverage with context.</strong> Discovered surfaces are hypotheses until runtime
        evidence supports them. A matching screenshot does not prove business correctness. Blocked
        and unsupported areas stay visible.
      </div>
      <div className="section">
        <div className="section-heading">
          <h2>Recent runs</h2>
          <Button variant="ghost" size="sm" className="text-button" data-go="runs">
            All test runs <ArrowUpRight />
          </Button>
        </div>
        <RunTable runs={state.runs.slice(0, 6)} />
      </div>
    </>
  );
}
function Schedules({ state }: { state: State }) {
  return (
    <>
      <div className="scope-note">
        Schedules use UTC and require this server to remain running. Missed slots are coalesced into
        one run after restart. Jobs run one at a time; no catch-up burst.
      </div>
      {state.projects.length ? (
        <div className="section">
          {state.projects.map((item) => (
            <Card className="card" key={item.id}>
              <div className="card-top">
                <div>
                  <h3>{item.name}</h3>
                  <p className="muted">
                    {item.cron || 'No schedule configured'} · {item.scheduleMode}
                  </p>
                  <small>Next due: {item.paused ? 'Paused' : time(item.nextRunAt)}</small>
                </div>
                <div>
                  <Status value={item.paused || !item.cron ? 'paused' : 'active'} />{' '}
                  <Button variant="outline" size="sm" data-edit={item.id}>
                    Configure
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="empty">
          <Clock3 size={25} />
          <h2>Add a project to schedule tests</h2>
        </div>
      )}
    </>
  );
}
async function rootsRequest(method: 'POST' | 'DELETE', path: string) {
  const response = await fetch('/api/roots', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (!response.ok)
    throw new Error(typeof body.error === 'string' ? body.error : 'Workspace root request failed');
}
function WorkspaceRoots({ state, onChanged }: { state: State; onChanged?: () => Promise<void> }) {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function apply(action: () => Promise<void>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      await onChanged?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Workspace root request failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {state.roots.map((root) => (
        <p key={root} className="folder">
          {root}
          <Button
            variant="ghost"
            size="sm"
            className="text-button"
            disabled={busy}
            onClick={() => {
              void apply(() => rootsRequest('DELETE', root), 'Workspace root removed');
            }}
          >
            Remove
          </Button>
        </p>
      ))}
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          const value = path;
          if (!value) return;
          void apply(async () => rootsRequest('POST', value), 'Workspace root added').then(() =>
            setPath(''),
          );
        }}
      >
        <Input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="/absolute/path/on/this/server"
          aria-label="Workspace root path"
        />
        <Button type="submit" size="sm" disabled={busy || !path}>
          <Plus size={14} /> Add root
        </Button>
      </form>
      {error ? <p className="scope-note">{error}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}
      <p className="muted">
        Folders are resolved on the server, including symlinks. Added roots persist across restarts;
        a root with a connected project cannot be removed.
      </p>
    </>
  );
}
function Administration({ state, onChanged }: { state: State; onChanged?: () => Promise<void> }) {
  return (
    <>
      <div className="project-grid">
        <Card className="card">
          <ShieldCheck size={20} />
          <p className="eyebrow">ACCESS & EXECUTION</p>
          <h2>Single administrator</h2>
          <p className="muted">
            Session-based access. Eight-hour sessions. Token rotation requires a server restart. Run
            jobs execute on this host with the operator’s installed engines and agent credentials.
          </p>
          <div className="scope-note">
            Only mount trusted project folders. This instance is not a multi-tenant sandbox.
          </div>
        </Card>
        <Card className="card">
          <FolderLock size={20} />
          <p className="eyebrow">ALLOWED PROJECT ROOTS</p>
          <h2>Server workspace</h2>
          <WorkspaceRoots state={state} onChanged={onChanged} />
        </Card>
      </div>
      <RetentionPanel />
      <div className="section-heading mt-6">
        <h2>Administrator activity</h2>
        <small>Latest 100 events</small>
      </div>
      <Card>
        <CardContent className="admin-activity">
          <ul className="audit-list">
            {state.audit.length ? (
              state.audit.map((item, index) => (
                <li key={`${item.at}-${index}`}>
                  <span>
                    {item.action}
                    <small className="folder"> {item.subject}</small>
                  </span>
                  <small>{time(item.at)}</small>
                </li>
              ))
            ) : (
              <li>No activity recorded.</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
const roots = new WeakMap<Element, Root>();
export function mountWorkspacePanel(
  element: Element,
  {
    section,
    state,
    campaign,
    inventory,
    runPanel,
    admin,
  }: {
    section: 'overview' | 'schedules' | 'admin' | 'campaigns' | 'intents' | 'runs';
    state: State;
    campaign: CampaignPanelProps;
    inventory: InventoryPanelProps;
    runPanel: RunPanelProps;
    admin?: { onChanged?: () => Promise<void> };
  },
) {
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }
  if (section === 'runs') {
    root.render(<RunPanel {...runPanel} />);
    return;
  }
  if (section === 'intents') {
    root.render(<InventoryPanel {...inventory} />);
    return;
  }
  if (section === 'campaigns') {
    root.render(<CampaignPanel {...campaign} />);
    return;
  }
  const Component = { overview: Overview, schedules: Schedules, admin: Administration }[section];
  root.render(<Component state={state} onChanged={admin?.onChanged} />);
}
export function unmountWorkspacePanel(element: Element) {
  roots.get(element)?.unmount();
  roots.delete(element);
}
