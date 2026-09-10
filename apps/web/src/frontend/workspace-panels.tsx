import { actions } from './dashboard-actions';
import { RetentionPanel } from './retention-panel';
import { CredentialsPanel } from './credentials-panel';
import { RunPanel, type RunPanelProps } from './run-panel';
import { RunTable, Status } from './run-table';
import { time } from './display';
import { InventoryPanel, type InventoryPanelProps } from './inventory-panel';
import { ChangesPanel, PagesPanel, type PagesPanelProps } from './pages-panel';
import { buildPageInventory, pendingChanges } from '../page-inventory';
import { environmentWords } from '../plain-words';
import { CampaignPanel, type CampaignPanelProps } from './campaign-panel';
import { createRoot, type Root } from 'react-dom/client';
import { useState } from 'react';
import {
  FolderGit2,
  ArrowUpRight,
  AlertTriangle,
  Clock3,
  ShieldCheck,
  FolderLock,
  Plus,
  Bot,
  KeyRound,
  Settings2,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  EmptyState,
  Input,
  Menu,
  Note,
  Section,
  Stat,
  StatusDot,
  toneOf,
  type Column,
} from './components';
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
  const active = state.runs.filter((run) => ['queued', 'running'].includes(run.state));
  const waiting = pendingChanges(
    buildPageInventory({
      projects: state.projects,
      runs: state.runs,
      baselines: state.baselines,
    }),
  ).length;
  const scheduled = state.projects.filter((item) => item.cron && !item.paused);
  const columns: ReadonlyArray<Column<State['projects'][number]>> = [
    {
      key: 'name',
      header: 'Project',
      width: '40%',
      truncate: true,
      // The name opens the project's settings, so the row needs no separate
      // Settings control at all — one fewer button per row than either the
      // buttons-for-everything layout or hiding it in the overflow menu, and
      // the name is where people already aim. It stays a heading: that is how
      // assistive technology and every journey identifies the row.
      cell: (item) => (
        <span className="flex flex-col items-start">
          <h3 className="text-[13px] font-medium">
            <button
              type="button"
              data-edit={item.id}
              className="rounded-sm text-left text-[var(--foreground)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              onClick={() => actions().editProject(item.id)}
            >
              {item.name}
            </button>
          </h3>
          <span className="folder text-[11px]" title={item.folder}>
            {item.folder}
          </span>
        </span>
      ),
    },
    {
      key: 'environment',
      header: 'Environment',
      cell: (item) => {
        const words = environmentWords(item.environment);
        return (
          <Badge variant="outline" className={`pill env-${words.term}`} title={words.detail}>
            {words.label}
          </Badge>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      cell: (item) => {
        const health = projectHealth(state, item.id);
        return <StatusDot tone={health.tone}>{health.label}</StatusDot>;
      },
    },
    {
      key: 'schedule',
      header: 'Schedule',
      cell: (item) => (
        <span className="tabular-nums text-[var(--foreground-muted)]">
          {item.cron && !item.paused ? `${item.cron} UTC` : 'On demand'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      bare: true,
      // The two everyday runs stay on the row, always, in the same order; only
      // the rarer actions move into the menu. Choosing which button to show
      // from the project's history would make the control set unlearnable —
      // "Visual test" would be a button on one row and a menu entry on the next.
      cell: (item) => (
        <span className="flex items-center justify-end gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => actions().startRun(item.id, 'discovery')}
          >
            Read the code
          </Button>
          <Button variant="outline" size="sm" onClick={() => actions().startRun(item.id, 'visual')}>
            Screenshot test
          </Button>
          <Menu
            label={`More actions for ${item.name}`}
            items={[
              {
                label: 'AI walkthrough',
                icon: Bot,
                onSelect: () => actions().startRun(item.id, 'agent'),
              },
              {
                label: 'Sign-in details',
                icon: KeyRound,
                onSelect: () => actions().projectCredentials(item.id),
              },
              {
                label: 'Project settings',
                icon: Settings2,
                onSelect: () => actions().editProject(item.id),
              },
            ]}
          />
        </span>
      ),
    },
  ];
  return (
    <>
      {waiting > 0 && (
        <button type="button" className="attention" onClick={() => actions().navigate('changes')}>
          <span className="attention-mark" aria-hidden="true">
            <AlertTriangle size={14} />
          </span>
          <span>
            <strong>
              {waiting} {waiting === 1 ? 'screenshot needs' : 'screenshots need'} your decision
            </strong>
            <small>
              Compare each one against the picture you approved, and say which is right.
            </small>
          </span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      )}
      <div className="stats">
        <Stat label="Projects" value={state.projects.length} caption="Watched by this server" />
        <Stat label="Running now" value={active.length} caption="Queued and in progress" />
        <Stat
          label="Waiting on you"
          value={waiting}
          caption="Screenshots that changed"
          tone={waiting ? 'attention' : 'default'}
        />
        <Stat
          label="Schedules"
          value={scheduled.length}
          caption={scheduled.length ? 'Running on UTC slots' : 'None set'}
        />
      </div>
      <Section title="Projects" meta={`${state.projects.length} connected`}>
        <DataTable
          caption="Connected projects"
          columns={columns}
          rows={state.projects}
          rowKey={(item) => item.id}
          empty={
            <EmptyState
              icon={FolderGit2}
              title="Connect your first project"
              action={
                <Button data-add onClick={() => actions().addProject()}>
                  <Plus /> Connect project
                </Button>
              }
            >
              Pick a folder on this server or paste a GitHub URL. Arxic reads the code to find your
              pages; point it at a running copy of the site and it will photograph them too.
            </EmptyState>
          }
        />
      </Section>
      <Section
        title="Recent tests"
        actions={
          <Button
            variant="ghost"
            size="sm"
            data-go="runs"
            onClick={() => actions().navigate('runs')}
          >
            All test runs
          </Button>
        }
      >
        <RunTable runs={state.runs.slice(0, 6)} />
      </Section>
      <Note>
        <strong>What a passing test means.</strong> A page that matches its approved picture looks
        the same as last time — that is all it proves. Pages found by reading code have not been
        opened yet, and anything Arxic could not reach stays visible rather than being counted as
        fine.
      </Note>
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
                  <Button
                    variant="outline"
                    size="sm"
                    data-edit={item.id}
                    onClick={() => actions().editProject(item.id)}
                  >
                    Configure
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={Clock3} title="Add a project to schedule tests">
          A connected project can run on a recurring UTC slot.
        </EmptyState>
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
        <p key={root} className="folder flex items-center justify-between gap-2">
          <span className="min-w-0 truncate" title={root}>
            {root}
          </span>
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
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="self-start"
          disabled={busy || !path}
        >
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
          <h2>
            <ShieldCheck size={16} aria-hidden="true" /> Access and execution
          </h2>
          <p className="muted">
            One administrator, session-based, eight hours per session. Rotating the token needs a
            server restart. Runs execute on this host with the engines and agent credentials
            installed for the operator.
          </p>
          <Note>
            Only mount project folders you trust. This instance is not a multi-tenant sandbox.
          </Note>
        </Card>
        <Card className="card">
          <h2>
            <FolderLock size={16} aria-hidden="true" /> Project roots
          </h2>
          <p className="muted">Folders on this server that projects may be connected from.</p>
          <WorkspaceRoots state={state} onChanged={onChanged} />
        </Card>
      </div>
      <CredentialsPanel />
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
    pages,
    runPanel,
    admin,
  }: {
    section:
      'pages' | 'changes' | 'overview' | 'schedules' | 'admin' | 'campaigns' | 'intents' | 'runs';
    state: State;
    campaign: CampaignPanelProps;
    inventory: InventoryPanelProps;
    pages: PagesPanelProps;
    runPanel: RunPanelProps;
    admin?: { onChanged?: () => Promise<void> };
  },
) {
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }
  if (section === 'pages') {
    root.render(<PagesPanel {...pages} />);
    return;
  }
  if (section === 'changes') {
    root.render(
      <ChangesPanel
        pages={pages.pages}
        projects={pages.projects}
        projectId={pages.projectId}
        onFilter={pages.onFilter}
      />,
    );
    return;
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
  if (section === 'overview') {
    root.render(<Overview state={state} />);
    return;
  }
  if (section === 'schedules') {
    root.render(<Schedules state={state} />);
    return;
  }
  root.render(<Administration state={state} onChanged={admin?.onChanged} />);
}
export function unmountWorkspacePanel(element: Element) {
  roots.get(element)?.unmount();
  roots.delete(element);
}
