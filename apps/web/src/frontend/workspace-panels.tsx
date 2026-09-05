import { InventoryPanel, type InventoryPanelProps } from './inventory-panel';
import { CampaignPanel, type CampaignPanelProps } from './campaign-panel';
import { createRoot, type Root } from 'react-dom/client';
import {
  FolderGit2,
  ArrowUpRight,
  Play,
  ScanSearch,
  Clock3,
  Activity,
  ScanLine,
  ShieldCheck,
  FolderLock,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent } from './components/ui/card';
import { Badge } from './components/ui/badge';
import type { Workbench } from '../workbench';
import type { Run } from '../types';

type State = ReturnType<Workbench['state']>;
const time = (value: string | null) =>
  value ? `${new Date(value).toISOString().slice(0, 19).replace('T', ' ')} UTC` : '—';
export function Status({ value }: { value: string }) {
  return (
    <Badge variant="outline" className={`pill ${value}`}>
      {value}
    </Badge>
  );
}
export function RunTable({ runs }: { runs: Run[] }) {
  if (!runs.length)
    return (
      <div className="empty">
        <Activity size={24} />
        <h2>No runs yet</h2>
        <p className="muted">
          Start with source discovery. Add a test origin for visual comparison or an Arxic
          configuration for AI E2E.
        </p>
      </div>
    );
  return (
    <div className="panel run-list">
      <table className="table">
        <thead>
          <tr>
            <th>PROJECT / RUN</th>
            <th>TYPE</th>
            <th>STATUS</th>
            <th>STARTED</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td data-label="PROJECT / RUN">
                {run.project.name}
                <small>{run.id.slice(0, 8)}</small>
              </td>
              <td data-label="TYPE">{run.mode}</td>
              <td data-label="STATUS">
                <Status value={run.state} /> {run.result && <Status value={run.result.outcome} />}
              </td>
              <td data-label="STARTED">{time(run.createdAt)}</td>
              <td data-label="ACTIONS">
                <Button variant="ghost" size="sm" className="text-button" data-open-run={run.id}>
                  View result <ArrowUpRight />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Overview({ state }: { state: State }) {
  const stats = [
    {
      label: 'Connected projects',
      value: state.projects.length,
      caption: 'Folders on this instance',
      icon: FolderGit2,
    },
    {
      label: 'Active runs',
      value: state.runs.filter((run) => ['queued', 'running'].includes(run.state)).length,
      caption: 'Queued and running',
      icon: Activity,
    },
    {
      label: 'Runs with visual changes',
      value: state.runs.filter((run) =>
        run.result?.captures?.some((capture) => capture.status === 'changed'),
      ).length,
      caption: 'In the latest 200 runs',
      icon: ScanLine,
    },
    {
      label: 'Active schedules',
      value: state.projects.filter((item) => item.cron && !item.paused).length,
      caption: 'UTC · server must be running',
      icon: Clock3,
    },
  ];
  return (
    <>
      <div className="stats">
        {stats.map(({ label, value, caption, icon: Icon }) => (
          <Card className="stat" key={label}>
            <div className="stat-top">
              <span className="stat-label">{label}</span>
              <Icon size={15} />
            </div>
            <strong>{value}</strong>
            <small>{caption}</small>
          </Card>
        ))}
      </div>
      <div className="section-heading">
        <h2>Your projects</h2>
        <small>{state.projects.length} connected</small>
      </div>
      {state.projects.length ? (
        <div className="project-grid">
          {state.projects.map((item) => (
            <Card className="card project-card" key={item.id}>
              <div className="card-top">
                <div className="project-icon" aria-hidden="true">
                  <FolderGit2 size={18} />
                </div>
                <Button variant="ghost" size="sm" className="text-button" data-edit={item.id}>
                  Settings <ArrowUpRight />
                </Button>
              </div>
              <h3>{item.name}</h3>
              <p className="folder">{item.folder}</p>
              <div className="card-info">
                <span>{item.origin || 'Source discovery only'}</span>
                <span>{item.cron && !item.paused ? 'Scheduled' : 'On demand'}</span>
              </div>
              <div className="card-actions">
                <Button className="primary" data-start="discovery" data-project={item.id}>
                  <ScanSearch />
                  Discover intents
                </Button>
                <Button
                  variant="outline"
                  className="secondary"
                  data-start="visual"
                  data-project={item.id}
                >
                  <ScanLine />
                  Visual test
                </Button>
                <Button
                  variant="outline"
                  className="secondary"
                  data-start="agent"
                  data-project={item.id}
                >
                  <Play />
                  AI E2E
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="empty">
          <FolderGit2 size={28} />
          <h2>Connect your first frontend</h2>
          <p className="muted">
            Point Arxic at a project folder to inventory source evidence. Then connect a running
            test app to inspect visual changes and replay behavior.
          </p>
          <Button className="primary" data-add>
            Add project
          </Button>
        </div>
      )}
      <div className="scope-note">
        <strong>Coverage with context.</strong> Discovered surfaces are hypotheses until runtime
        evidence supports them. A matching screenshot does not prove business correctness. Blocked
        and unsupported areas stay visible.
      </div>
      <div className="section-heading">
        <h2>Recent activity</h2>
        <Button variant="ghost" className="text-button" data-go="runs">
          All test runs <ArrowUpRight />
        </Button>
      </div>
      <RunTable runs={state.runs.slice(0, 6)} />
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
        state.projects.map((item) => (
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
                <Button variant="outline" className="secondary" data-edit={item.id}>
                  Configure
                </Button>
              </div>
            </div>
          </Card>
        ))
      ) : (
        <div className="empty">
          <Clock3 size={25} />
          <h2>Add a project to schedule tests</h2>
        </div>
      )}
    </>
  );
}
function Administration({ state }: { state: State }) {
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
          {state.roots.map((root) => (
            <p key={root} className="folder">
              {root}
            </p>
          ))}
          <p className="muted">
            Folders are resolved on the server, including symlinks. Change the root allow-list in
            server configuration.
          </p>
        </Card>
      </div>
      <div className="section-heading">
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
  }: {
    section: 'overview' | 'schedules' | 'admin' | 'campaigns' | 'intents';
    state: State;
    campaign: CampaignPanelProps;
    inventory: InventoryPanelProps;
  },
) {
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
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
  root.render(<Component state={state} />);
}
export function unmountWorkspacePanel(element: Element) {
  roots.get(element)?.unmount();
  roots.delete(element);
}
