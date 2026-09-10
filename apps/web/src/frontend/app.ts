import { trapDialogTab } from './dialog-focus';
/** Dashboard actions: session, polling, navigation, dialogs. Presentation lives in the React panels. */
import { mountProviderPanel, unmountProviderPanel } from './provider-panel';
import { mountWorkspaceShell } from './workspace-shell';
import { mountWorkspacePanel, unmountWorkspacePanel } from './workspace-panels';
import { mountProjectWizard, unmountProjectWizard } from './project-wizard';
import { mountAgentWizard, unmountAgentWizard } from './agent-wizard';
import { updateModelCatalogs } from './model-controls';
import { reviewDrafts, reviewDraftKey } from './review-form';
import { clearPendingRequests, beginPendingRequest, campaignRequestKey } from './pending-requests';
import { initTheme } from './theme';
import { toast, clearToasts, confirmAction, type Command } from './components';
import { updateCommands } from './command-registry';
import { setDashboardActions } from './dashboard-actions';
import {
  LayoutGrid,
  GitCompare,
  ScanSearch,
  Play,
  Route,
  CalendarClock,
  Bot,
  Settings2,
  Plus,
  FolderGit2,
} from 'lucide-react';
import { buildPageInventory, pendingChanges } from '../page-inventory';
import type { Project } from '../types';
import { runModeWords, runNeedsConfirmation } from '../plain-words';
import { PAGE_GRID_SIZE } from './pages-panel';

initTheme();
mountWorkspaceShell(document.querySelector('#workspace-root')!);
const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector(selector) as T;
/**
 * Section names in the words a person would use for them.
 *
 * These were the engine's nouns — "Intent inventory", "Workflow campaigns",
 * "Models & accounts" — which are exact and unreadable. Pages leads because
 * pages are what the product is about; the engine's own vocabulary stays
 * available inside each screen rather than on the way in.
 */
const titles: Record<string, string> = {
  pages: 'Pages',
  changes: 'Changes',
  runs: 'Test runs',
  campaigns: 'User journeys',
  schedules: 'Schedules',
  overview: 'Projects',
  intents: 'Code scan',
  providers: 'AI models',
  admin: 'Settings',
};
const descriptions: Record<string, string> = {
  pages: 'Every page Arxic found, what is on it, and whether it still looks right.',
  changes: 'Screenshots that differ from the picture you approved. Approve the intended ones.',
  runs: 'Every test that has run, and the evidence it produced.',
  campaigns:
    'A journey is a path through several pages — sign in, add to basket, check out. Pick the ones that matter and an AI walks each of them in a real browser.',
  schedules: 'Tests that run on their own, on a UTC timer.',
  overview: 'The projects Arxic is watching. Connect one, or change how it is tested.',
  intents:
    'What reading your code turned up: the addresses it serves, the journeys it declares, and the components behind them.',
  providers: 'Connect a provider once; Arxic lists the models it offers.',
  admin: 'Access, sign-in details, storage, and the activity log.',
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let state: any = { projects: [], runs: [], audit: [], baselines: [] };
let section = 'pages';
let selectedProject = '';
let selectedRun = '';
let selectedCampaign = '';
let runSearch = '';
let runModeFilter = '';
let runStatusFilter = '';
let runOffset = 0;
const workflowSelections = new Map<string, Set<string>>();
const workflowPages = new Map<string, number>();
const campaignPages = new Map<string, number>();
let sessionEpoch = 0;
let refreshSequence = 0;
let signingOut = false;
let declarationKind = '';
let declarationSearch = '';
let selectedEnvironment = '';
let pageSearch = '';
let pageFilter = '';
let pageOffset = 0;
let selectedPage = '';
const declarationPages = new Map<string, number>();
const projectDialog = () => $<HTMLDialogElement>('#project-dialog');
const agentDialog = () => $<HTMLDialogElement>('#agent-dialog');

function readLocation() {
  const params = new URL(location.href).searchParams;
  const view = params.get('view') ?? 'pages';
  section = Object.hasOwn(titles, view) ? view : 'pages';
  const id = (name: string) => {
    const value = params.get(name) ?? '';
    return /^[a-f0-9-]{36}$/u.test(value) ? value : '';
  };
  selectedProject = id('project');
  selectedEnvironment = ['development', 'staging', 'production'].includes(params.get('env') ?? '')
    ? params.get('env')!
    : '';
  selectedRun = section === 'runs' ? id('run') : '';
  selectedCampaign = section === 'campaigns' ? id('campaign') : '';
  runSearch = (params.get('query') ?? '').slice(0, 200);
  runModeFilter = ['discovery', 'visual', 'agent', 'review'].includes(params.get('mode') ?? '')
    ? params.get('mode')!
    : '';
  runStatusFilter = ['queued', 'running', 'completed', 'blocked', 'cancelled'].includes(
    params.get('status') ?? '',
  )
    ? params.get('status')!
    : '';
  const offset = Number(params.get('offset') ?? 0);
  const bounded = Number.isSafeInteger(offset) && offset >= 0 && offset <= 1_000_000 ? offset : 0;
  runOffset = section === 'runs' ? bounded : 0;
  pageOffset = section === 'pages' ? bounded : 0;
  // A page is addressed by its own path, so a link to /login survives a reload
  // and can be shared. Bounded and required to look like a path.
  const page = params.get('page') ?? '';
  selectedPage = section === 'pages' && page.startsWith('/') && page.length <= 512 ? page : '';
  pageSearch = section === 'pages' ? (params.get('query') ?? '').slice(0, 200) : '';
  pageFilter =
    section === 'pages' &&
    ['needs-review', 'problem', 'untested', 'ok'].includes(params.get('state') ?? '')
      ? params.get('state')!
      : '';
}
function writeLocation() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  if (section !== 'pages') url.searchParams.set('view', section);
  if (selectedProject) url.searchParams.set('project', selectedProject);
  if (selectedEnvironment) url.searchParams.set('env', selectedEnvironment);
  if (section === 'pages') {
    if (selectedPage) url.searchParams.set('page', selectedPage);
    if (pageSearch) url.searchParams.set('query', pageSearch);
    if (pageFilter) url.searchParams.set('state', pageFilter);
    if (pageOffset) url.searchParams.set('offset', String(pageOffset));
  }
  if (section === 'runs') {
    if (selectedRun) url.searchParams.set('run', selectedRun);
    if (runSearch) url.searchParams.set('query', runSearch);
    if (runModeFilter) url.searchParams.set('mode', runModeFilter);
    if (runStatusFilter) url.searchParams.set('status', runStatusFilter);
    if (runOffset) url.searchParams.set('offset', String(runOffset));
  }
  if (section === 'campaigns' && selectedCampaign)
    url.searchParams.set('campaign', selectedCampaign);
  if (url.href !== location.href) history.pushState(null, '', url);
  document.title = `${selectedPage && section === 'pages' ? selectedPage : titles[section]} · Arxic`;
}
projectDialog().addEventListener('keydown', trapDialogTab);
agentDialog().addEventListener('keydown', trapDialogTab);
readLocation();
window.addEventListener('popstate', () => {
  readLocation();
  void refresh()
    .then(() => $('#page-title').focus())
    .catch((error) => notice(error.message));
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(path: string, method = 'GET', body?: unknown): Promise<any> {
  const epoch = sessionEpoch;
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (epoch !== sessionEpoch)
    throw new Error('Request completed in an earlier session. Refresh to view its status.');
  if (!response.ok) {
    if (response.status === 401 && epoch === sessionEpoch) {
      sessionEpoch++;
      clearSession();
    }
    throw Object.assign(new Error(data.error ?? 'Request failed'), { status: response.status });
  }
  return data;
}
function closeProjectDialog() {
  projectDialog().close();
  unmountProjectWizard($('#project-wizard-root'));
}
function closeAgentDialog() {
  agentDialog().close();
  unmountAgentWizard($('#agent-wizard-root'));
}
function clearSession() {
  state = { projects: [], runs: [], audit: [], baselines: [] };
  selectedRun = '';
  selectedProject = '';
  selectedCampaign = '';
  runSearch = '';
  runModeFilter = '';
  runStatusFilter = '';
  runOffset = 0;
  declarationKind = '';
  declarationSearch = '';
  workflowPages.clear();
  campaignPages.clear();
  declarationPages.clear();
  const workspacePanel = $('#workspace-panel-root');
  const providerPanel = $('#provider-panel-root');
  if (workspacePanel) unmountWorkspacePanel(workspacePanel);
  if (providerPanel) unmountProviderPanel(providerPanel);
  reviewDrafts.clear();
  clearToasts();
  updateCommands([]);
  clearPendingRequests();
  workflowSelections.clear();
  updateModelCatalogs([]);
  closeProjectDialog();
  closeAgentDialog();
  $('#content').replaceChildren();
  $('#app').hidden = true;
  $('#login').hidden = false;
}
/** One announcement channel for the whole dashboard; the Toaster owns presentation. */
function notice(message: string) {
  toast(message);
}
async function refresh() {
  if (signingOut) return;
  const epoch = sessionEpoch;
  const sequence = ++refreshSequence;
  try {
    const snapshot = await api('/state');
    if (epoch !== sessionEpoch || sequence !== refreshSequence) return;
    if (section === 'runs') {
      const params = new URLSearchParams({
        query: runSearch,
        mode: runModeFilter,
        status: runStatusFilter,
        project: selectedProject,
        offset: String(runOffset),
        limit: '25',
      });
      snapshot.runHistory = await api(`/runs?${params}`);
      if (epoch !== sessionEpoch || sequence !== refreshSequence) return;
      runOffset = snapshot.runHistory.offset;
      for (const run of snapshot.runHistory.runs) {
        if (!snapshot.runs.some((item: { id: string }) => item.id === run.id))
          snapshot.runs.push(run);
      }
    }
    const desired: string[] =
      section === 'intents'
        ? snapshot.projects
            .flatMap((item: { id: string }) =>
              ['hasInventory', 'hasLedger'].map(
                (key) =>
                  snapshot.runs.find(
                    (run: Record<string, unknown>) => run.projectId === item.id && run[key],
                  )?.id,
              ),
            )
            .filter(Boolean)
        : section === 'runs' && selectedRun
          ? [selectedRun]
          : [];
    await Promise.all(
      desired.map(async (id) => {
        let detail;
        try {
          detail = await api(`/runs/${id}`);
        } catch (error) {
          if ((error as { status?: number }).status === 404) {
            if (selectedRun === id) selectedRun = '';
            notice('This run is no longer available. Browse the remaining run history.');
            return;
          }
          throw error;
        }
        const index = snapshot.runs.findIndex((run: { id: string }) => run.id === id);
        if (index >= 0) snapshot.runs[index] = detail;
        else snapshot.runs.push(detail);
      }),
    );
    if (section === 'campaigns' && selectedCampaign) {
      const detail = await api(`/campaigns/${selectedCampaign}`);
      const index = snapshot.campaigns.findIndex(
        (item: { id: string }) => item.id === selectedCampaign,
      );
      if (index >= 0) snapshot.campaigns[index] = detail;
      else snapshot.campaigns.push(detail);
    }
    if (epoch !== sessionEpoch || sequence !== refreshSequence || signingOut) return;
    state = snapshot;
    updateModelCatalogs(state.modelConnections ?? []);
    $('#app').hidden = false;
    $('#login').hidden = true;
    $('#version').textContent = state.versionLabel;
    if (state.queueError) notice(state.queueError);
    if (agentDialog().open) renderAgentWizard();
    if (
      !projectDialog().open &&
      !document.activeElement?.closest('#declaration-search, #run-search, [data-review-form]')
    )
      render();
  } catch (error) {
    if (epoch !== sessionEpoch || sequence !== refreshSequence || signingOut) return;
    if (section === 'runs') {
      state.runHistoryLoading = false;
      state.runHistoryError = 'Run history could not be loaded. Retry or check your connection.';
      render();
    }
    throw error;
  }
}
async function refreshRunHistory() {
  state.runHistoryLoading = true;
  state.runHistoryError = '';
  render();
  await refresh();
}

function project(id: string) {
  return state.projects.find((item: { id: string }) => item.id === id);
}
/**
 * The projects the scope bar admits.
 *
 * One definition, so Pages, Changes and the projects table cannot disagree
 * about what the operator is looking at — and so no screen needs a project
 * filter of its own.
 */
function scopedProjects(): Project[] {
  return (state.projects as Project[]).filter(
    (item) =>
      (!selectedProject || item.id === selectedProject) &&
      (!selectedEnvironment || (item.environment ?? 'development') === selectedEnvironment),
  );
}
/**
 * The scope bar's project list is data, so it is filled here rather than in the
 * shell. Rebuilt only when the set of projects changes: replacing the options
 * on every 2.5s poll would close the menu under the operator's cursor.
 */
function renderScope() {
  const select = $<HTMLSelectElement>('#project-scope');
  if (!select) return;
  const ids = (state.projects as Array<{ id: string; name: string }>).map((item) => item.id);
  const rendered = [...select.options].slice(1).map((option) => option.value);
  if (rendered.join('\u0000') !== ids.join('\u0000')) {
    select.replaceChildren(new Option('All projects', ''));
    for (const item of state.projects as Array<{ id: string; name: string }>)
      select.append(new Option(item.name, item.id));
  }
  select.value = selectedProject;
  const environment = $<HTMLSelectElement>('#environment-scope');
  if (environment) environment.value = selectedEnvironment;
}
function render() {
  writeLocation();
  publishCommands();
  renderScope();
  const scoped = scopedProjects();
  const pages = buildPageInventory({
    projects: scoped,
    runs: state.runs,
    baselines: state.baselines,
  });
  // An open page owns the heading: "Pages" above a screenshot of the sign-in
  // screen tells a person nothing about where they are.
  const open = selectedPage
    ? pages.find(
        (item) =>
          item.path === selectedPage && (!selectedProject || item.projectId === selectedProject),
      )
    : undefined;
  $('#page-title').textContent = open ? open.title : titles[section]!;
  $('#breadcrumb').textContent = open ? open.title : titles[section]!;
  $('#page-description').textContent = open
    ? `${open.projectName} · ${open.path}`
    : descriptions[section]!;
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach((button) => {
    const active = button.dataset.nav === section;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const providerRoot = $('#provider-panel-root');
  const workspacePanel = $('#workspace-panel-root');
  // The badge is the product's standing question: how many pictures are
  // waiting on a person. Written into the shell rather than passed through it,
  // because the shell mounts once and the count changes on every poll.
  const waiting = pendingChanges(pages).length;
  const badge = $<HTMLElement>('[data-nav-badge="changes"]');
  if (badge) {
    badge.textContent = waiting ? String(waiting) : '';
    badge.hidden = !waiting;
  }
  if (
    ['pages', 'changes', 'overview', 'schedules', 'admin', 'campaigns', 'intents', 'runs'].includes(
      section,
    )
  ) {
    if (providerRoot) unmountProviderPanel(providerRoot);
    if (!workspacePanel) $('#content').innerHTML = '<div id="workspace-panel-root"></div>';
    mountWorkspacePanel($('#workspace-panel-root'), {
      section: section as 'overview',
      state,
      runPanel: {
        state,
        selectedId: selectedRun,
        projectId: selectedProject,
        history: state.runHistory,
        loading: state.runHistoryLoading,
        error: state.runHistoryError,
        onFilter: (kind: 'project' | 'mode' | 'status', value: string) => {
          if (kind === 'project') selectedProject = value;
          if (kind === 'mode') runModeFilter = value;
          if (kind === 'status') runStatusFilter = value;
          runOffset = 0;
          void refreshRunHistory().catch((error) => notice(error.message));
        },
        search: runSearch,
        mode: runModeFilter,
        status: runStatusFilter,
        onRefresh: refreshModels,
        onReview: requestVisualReview,
      },
      pages: {
        pages,
        projects: state.projects,
        runs: state.runs,
        projectId: selectedProject,
        search: pageSearch,
        filter: pageFilter,
        offset: pageOffset,
        selected: selectedPage,
        scoped: !!(selectedProject || selectedEnvironment),
        onClearScope: () => {
          selectedProject = '';
          selectedEnvironment = '';
          pageOffset = 0;
          render();
        },
        onFilter: (kind: 'project' | 'status', value: string) => {
          if (kind === 'project') selectedProject = value;
          if (kind === 'status') pageFilter = value;
          pageOffset = 0;
          render();
        },
        onSearch: (value: string) => {
          pageSearch = value;
          pageOffset = 0;
          render();
        },
        onPage: (direction: -1 | 1) => {
          pageOffset = Math.max(0, pageOffset + direction * PAGE_GRID_SIZE);
          render();
        },
      },
      inventory: {
        // Scoped, like every other screen: the sidebar decides what is in view.
        projects: scoped,
        runs: state.runs,
        projectId: selectedProject,
        kind: declarationKind,
        search: declarationSearch,
        declarationPages,
        selections: workflowSelections,
        workflowPages,
        outcomes: state.outcomes ?? {},
        intentOutcomes: state.intentOutcomes ?? {},
      },
      campaign: {
        campaigns: state.campaigns ?? [],
        selectedId: selectedCampaign,
        projectId: selectedProject,
        pages: campaignPages,
        runs: state.runs ?? [],
      },
      admin: { onChanged: refresh },
    });
    return;
  }
  if (workspacePanel) unmountWorkspacePanel(workspacePanel);
  if (section === 'providers') {
    if (!providerRoot) $('#content').innerHTML = '<div id="provider-panel-root"></div>';
    mountProviderPanel($('#provider-panel-root'), {
      connections: state.modelConnections ?? [],
      setup: state.providerSetup ?? [],
      onRefresh: refreshModels,
      onConnectSecret: saveProviderSecret,
      onDisconnectSecret: removeProviderSecret,
    });
    return;
  }
  if (providerRoot) unmountProviderPanel(providerRoot);
}
/** Navigate to a section the same way a sidebar click does, from anywhere. */
function goToSection(next: string) {
  if (!Object.hasOwn(titles, next)) return;
  section = next;
  // Leaving Pages closes whatever page was open; otherwise the heading keeps
  // announcing "Sign in" while the Changes queue is on screen.
  if (next !== 'pages') selectedPage = '';
  writeLocation();
  void refresh()
    .then(() => $('#page-title').focus())
    .catch((error) => notice(error.message));
}
const sectionIcons: Record<string, Command['icon']> = {
  pages: LayoutGrid,
  changes: GitCompare,
  runs: Play,
  campaigns: Route,
  schedules: CalendarClock,
  overview: FolderGit2,
  intents: ScanSearch,
  providers: Bot,
  admin: Settings2,
};
/**
 * Rebuilt from the workspace on every render so the palette can reach whatever
 * exists right now — not just the fixed navigation. A project is one keystroke
 * from being discovered, tested or configured; a recent run is one from being
 * opened.
 */
function publishCommands() {
  const commands: Command[] = [
    ...Object.keys(titles).map((id) => ({
      id: `go:${id}`,
      label: titles[id]!,
      group: 'Go to',
      icon: sectionIcons[id],
      keywords: descriptions[id],
      run: () => goToSection(id),
    })),
    {
      id: 'action:new-project',
      label: 'Connect project',
      group: 'Actions',
      icon: Plus,
      keywords: 'add repository folder github source',
      run: () => editProject(),
    },
    {
      id: 'action:connect-agent',
      label: 'Connect agent',
      group: 'Actions',
      icon: Bot,
      keywords: 'model provider ai',
      run: () => connectAgent(),
    },
  ];
  for (const item of state.projects as Array<{ id: string; name: string }>) {
    commands.push(
      {
        id: `project:settings:${item.id}`,
        label: `Settings — ${item.name}`,
        group: 'Projects',
        icon: FolderGit2,
        keywords: 'configure edit project',
        run: () => editProject(item.id),
      },
      ...(['discovery', 'visual', 'agent'] as const).map((mode) => ({
        id: `project:${mode}:${item.id}`,
        label: `${runModeWords(mode).label} — ${item.name}`,
        group: 'Projects',
        icon: Play,
        keywords: `run start ${mode}`,
        run: () => void startRun(item.id, mode),
      })),
    );
  }
  for (const run of (state.runs as Array<Record<string, string>>).slice(0, 8)) {
    const owner = project(run.projectId!);
    commands.push({
      id: `run:${run.id}`,
      label: `${owner?.name ?? 'Run'} — ${runModeWords(String(run.mode)).label}`,
      group: 'Recent runs',
      icon: Play,
      hint: run.id!.slice(0, 8),
      keywords: `${run.id} ${run.state}`,
      run: () => {
        selectedRun = run.id!;
        goToSection('runs');
      },
    });
  }
  updateCommands(commands);
}
/** Queue a run and land on it, from a row button or the palette alike. */
/**
 * A run against production acts on the real site.
 *
 * A screenshot test only looks. An AI walkthrough clicks, types and submits,
 * and a state checkpoint configured to submit empty forms does too. Against
 * the copy customers use, that deserves one question first — and exactly one,
 * because a confirmation people meet on every run is a confirmation they stop
 * reading.
 */
async function confirmRisk(projectId: string, mode: string) {
  const target = project(projectId);
  if (!target || !runNeedsConfirmation(target, mode)) return true;
  return confirmAction({
    title: 'Run this against production?',
    body:
      mode === 'agent'
        ? `${target.name} points at production. An AI walkthrough clicks, types and submits forms on the site your customers use.`
        : `${target.name} points at production. This project has checkpoints that submit forms with empty fields, on the site your customers use.`,
    confirmLabel: 'Run it anyway',
    destructive: true,
  });
}
async function startRun(projectId: string, mode: string, paths?: string[]) {
  if (!(await confirmRisk(projectId, mode))) return;
  try {
    const run = await api(`/projects/${projectId}/runs`, 'POST', {
      mode,
      ...(paths ? { paths } : {}),
    });
    selectedRun = run.id;
    section = 'runs';
    writeLocation();
    await refresh();
  } catch (error) {
    notice((error as Error).message);
  }
}
function editProject(id = '', focus?: 'login') {
  mountProjectWizard($('#project-wizard-root'), {
    project: project(id),
    ...(focus ? { focus } : {}),
    api,
    onRefreshModels: refreshModels,
    onClose: closeProjectDialog,
    onSaved: async () => {
      closeProjectDialog();
      // A project that has just been connected has no pages yet, so landing
      // back on Pages shows an empty screen and hides the next thing to do.
      // The project itself, with its run controls, is where the person is
      // going anyway.
      if (!id) {
        section = 'overview';
        selectedPage = '';
        writeLocation();
      }
      await refresh();
      notice(id ? 'Project settings saved.' : 'Project connected.');
    },
  });
  if (!projectDialog().open) projectDialog().showModal();
}
function renderAgentWizard() {
  mountAgentWizard($('#agent-wizard-root'), {
    connections: state.modelConnections ?? [],
    setup: state.providerSetup ?? [],
    onRefresh: refreshModels,
    onClose: closeAgentDialog,
    onOpenProviders: () => {
      closeAgentDialog();
      section = 'providers';
      writeLocation();
      void refresh().catch((error) => notice(error.message));
    },
  });
}
function connectAgent() {
  renderAgentWizard();
  if (!agentDialog().open) agentDialog().showModal();
}
for (const dialog of [projectDialog(), agentDialog()])
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (dialog.id === 'project-dialog') closeProjectDialog();
    else closeAgentDialog();
  });
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  sessionEpoch++;
  try {
    await api('/session', 'POST', {
      token: (form.elements.namedItem('token') as HTMLInputElement).value,
    });
    form.reset();
    $('#login-error').textContent = '';
    // Session cleanup clears in-memory selection; the requested URL remains the entry point.
    readLocation();
    await refresh();
  } catch (error) {
    $('#login-error').textContent = (error as Error).message;
  }
});
$('#logout').addEventListener('click', async () => {
  sessionEpoch++;
  signingOut = true;
  try {
    await api('/session', 'DELETE', {});
    clearSession();
  } catch (error) {
    notice((error as Error).message);
  } finally {
    signingOut = false;
  }
});
$('#new-project').addEventListener('click', () => editProject());
document.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.dataset.workflowRow) {
    const id = target.dataset.discovery!;
    const selected = workflowSelections.get(id) ?? new Set<string>();
    if (target.checked && selected.size >= 20) {
      target.checked = false;
      notice('Choose at most 20 workflows per campaign.');
      return;
    }
    if (target.checked) selected.add(target.value);
    else selected.delete(target.value);
    workflowSelections.set(id, selected);
    render();
  }
  if (target.id === 'declaration-kind') {
    declarationKind = target.value;
    declarationPages.clear();
    render();
  }
  // The scope bar and the run-history project filter set the same thing; the
  // bar is the one that survives, and runs re-query the server because their
  // history is paged there rather than in the polled snapshot.
  if (target.id === 'project-scope' || target.id === 'project-filter') {
    selectedProject = target.value;
    runOffset = 0;
    pageOffset = 0;
    selectedPage = '';
    if (section === 'runs') void refresh().catch((error) => notice(error.message));
    else render();
  }
  if (target.id === 'environment-scope') {
    selectedEnvironment = target.value;
    pageOffset = 0;
    selectedPage = '';
    // A project outside the chosen environment cannot stay selected, or the
    // two halves of the scope would contradict each other.
    if (selectedProject && !scopedProjects().some((item) => item.id === selectedProject))
      selectedProject = '';
    render();
  }
});
document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  if (form.id === 'run-search') {
    event.preventDefault();
    runSearch = String(new FormData(form).get('query') ?? '').trim();
    runOffset = 0;
    (document.activeElement as HTMLElement | null)?.blur();
    void refreshRunHistory().catch((error) => notice(error.message));
    return;
  }
  if (form.id !== 'declaration-search') return;
  event.preventDefault();
  declarationSearch = String(new FormData(form).get('query') ?? '');
  declarationPages.clear();
  render();
});
async function requestVisualReview(request: Record<string, unknown> & { sourceRunId: string }) {
  const epoch = sessionEpoch;
  const { sourceRunId, ...body } = request;
  const run = await api(`/runs/${sourceRunId}/reviews`, 'POST', body);
  if (epoch !== sessionEpoch || signingOut) return;
  reviewDrafts.delete(reviewDraftKey(sourceRunId, body.captureId as string, body.sha256 as string));
  (document.activeElement as HTMLElement | null)?.blur();
  selectedRun = run.id;
  section = 'runs';
  writeLocation();
  state.runs = [run, ...state.runs.filter((item: { id: string }) => item.id !== run.id)];
  render();
  try {
    await refresh();
  } catch (error) {
    notice((error as Error).message);
  }
}
document.addEventListener('submit', async (event) => {
  const form = event.target as HTMLFormElement;
  if (!form.dataset.campaignForm) return;
  event.preventDefault();
  const release = beginPendingRequest(
    campaignRequestKey(form.dataset.project!, form.dataset.discovery!),
  );
  if (!release) return;
  try {
    // Variant rows are collected per DOM row (not per field name): conditional
    // per-kind inputs would misalign FormData.getAll indexes across mixed kinds.
    const slug = (label: string) =>
      label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-+|-+$/gu, '');
    const valueOf = (row: Element, name: string) =>
      (row.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement | null)
        ?.value ?? '';
    const variants: NonNullable<import('../types').Campaign['variants']> = [
      ...form.querySelectorAll('.variant-fields'),
    ]
      .map((row): NonNullable<import('../types').Campaign['variants']>[number] => {
        const label = valueOf(row, 'variant-label').trim();
        const kind = valueOf(row, 'variant-kind') || 'persona';
        // Variant key: deterministic slug of the label; the server validates
        // the final shape and surfaces its 400s.
        const key = slug(label);
        if (kind === 'flag') {
          const flagName = valueOf(row, 'variant-flag-name').trim();
          return {
            label,
            key,
            kind: 'flag',
            // The dashboard exposes one flag per variant row; the API accepts up to 30.
            flags: { [flagName]: valueOf(row, 'variant-flag-value') === 'true' },
          };
        }
        if (kind === 'state') return { label, key, kind: 'state', state: 'anonymous' };
        // Login override: collected only when a route is present — a routeless
        // row keeps the project login surface; labels left blank keep the
        // project values server-side.
        const loginRoute = valueOf(row, 'variant-login-route').trim();
        const emailLabel = valueOf(row, 'variant-login-email-label').trim();
        const passwordLabel = valueOf(row, 'variant-login-password-label').trim();
        const submitLabel = valueOf(row, 'variant-login-submit-label').trim();
        return {
          label,
          key,
          kind: 'persona',
          persona: {
            emailRef: valueOf(row, 'variant-email').trim(),
            passwordRef: valueOf(row, 'variant-password').trim(),
          },
          ...(loginRoute
            ? {
                login: {
                  route: loginRoute,
                  ...(emailLabel ? { emailLabel } : {}),
                  ...(passwordLabel ? { passwordLabel } : {}),
                  ...(submitLabel ? { submitLabel } : {}),
                },
              }
            : {}),
        };
      })
      .filter((variant) => {
        if (variant.kind === 'persona')
          return variant.label || variant.persona.emailRef || variant.persona.passwordRef;
        if (variant.kind === 'flag') return variant.label || Object.keys(variant.flags).length > 0;
        return variant.label;
      });
    const campaign = await api(`/projects/${form.dataset.project}/campaigns`, 'POST', {
      discoveryRunId: form.dataset.discovery,
      inventoryRowIds: [...(workflowSelections.get(form.dataset.discovery!) ?? [])],
      ...(variants.length ? { variants } : {}),
    });
    selectedCampaign = campaign.id;
    section = 'campaigns';
    writeLocation();
    render();
    await refresh();
  } catch (error) {
    notice((error as Error).message);
  } finally {
    release();
  }
});
/**
 * The action set every dashboard control calls.
 *
 * Replaces a delegated `document` click listener that read ~18 `data-*`
 * attributes: a control's behaviour now lives on the control, and an element
 * carrying a matching attribute somewhere else in the tree can no longer fire
 * an action by accident. The attributes stay — journeys address controls by
 * them — but nothing reads them at runtime any more.
 *
 * Each entry reports its own failure through the announcement channel; a click
 * handler must never leave a rejected promise unobserved.
 */
function guard<A extends unknown[]>(run: (...args: A) => Promise<unknown>) {
  return (...args: A) => {
    void run(...args).catch((error) => notice((error as Error).message));
  };
}
setDashboardActions({
  navigate: goToSection,
  addProject: () => editProject(),
  openPage: (projectId: string, path: string) => {
    selectedProject = projectId;
    selectedPage = path;
    section = 'pages';
    writeLocation();
    void refresh()
      .then(() => $('#page-title').focus())
      .catch((error) => notice(error.message));
  },
  closePage: () => {
    selectedPage = '';
    writeLocation();
    void refresh()
      .then(() => $('#page-title').focus())
      .catch((error) => notice(error.message));
  },
  /**
   * One page, photographed on its own. A whole-project run to re-check the
   * sign-in screen is minutes of browsers for one screenshot, so the button on
   * a page tests that page — and says so before it starts.
   */
  runPageTest: guard(async (projectId: string, path: string) => {
    await startRun(projectId, 'visual', [path]);
    notice(`Testing ${path}. The result appears here when the browsers finish.`);
  }),
  editProject: (id: string) => editProject(id),
  projectCredentials: (id: string) => editProject(id, 'login'),
  connectAgent: () => connectAgent(),
  startRun: guard(async (projectId: string, mode: string) => startRun(projectId, mode)),
  openRun: guard(async (id: string) => {
    selectedRun = id;
    section = 'runs';
    writeLocation();
    await refresh();
    $('.run-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }),
  cancelRun: guard(async (id: string) => {
    await api(`/runs/${id}/cancel`, 'POST', {});
    await refresh();
  }),
  deleteRun: guard(async (id: string) => {
    if (
      !(await confirmAction({
        title: 'Delete this run?',
        body: 'Its captures, diffs and timeline are removed from this server. Baselines you already approved are kept.',
        confirmLabel: 'Delete run',
        destructive: true,
      }))
    )
      return;
    await api(`/runs/${id}`, 'DELETE', {});
    selectedRun = '';
    await refresh();
    notice('Run deleted.');
  }),
  approveBaseline: guard(async (runId: string, captureId: string) => {
    await api(`/runs/${runId}/baselines`, 'POST', { captureId });
    await refresh();
    notice('Baseline approved. Future comparisons use these captured pixels.');
  }),
  openCampaign: guard(async (id: string) => {
    selectedCampaign = id;
    section = 'campaigns';
    writeLocation();
    await refresh();
  }),
  cancelCampaign: guard(async (id: string) => {
    await api(`/campaigns/${id}/cancel`, 'POST', {});
    await refresh();
  }),
  retryRunHistory: guard(async () => refreshRunHistory()),
  clearRunFilters: guard(async () => {
    runSearch = '';
    runModeFilter = '';
    runStatusFilter = '';
    selectedProject = '';
    runOffset = 0;
    await refreshRunHistory();
  }),
  pageRuns: guard(async (direction: number) => {
    runOffset = Math.max(0, runOffset + direction * 25);
    await refreshRunHistory();
  }),
  pageWorkflows: (id: string, direction: number) => {
    workflowPages.set(id, Math.max(0, (workflowPages.get(id) ?? 0) + direction));
    render();
  },
  pageCampaign: (id: string, direction: number) => {
    campaignPages.set(id, Math.max(0, (campaignPages.get(id) ?? 0) + direction));
    render();
  },
  pageDeclarations: (id: string, direction: number) => {
    declarationPages.set(id, Math.max(0, (declarationPages.get(id) ?? 0) + direction));
    render();
  },
});

void refresh().catch(() => {});
setInterval(() => {
  if (!$('#app').hidden && !projectDialog().open)
    void refresh().catch((error) => notice(error.message));
}, 2500);

async function refreshModels(id: string) {
  const epoch = sessionEpoch;
  if (
    state.modelConnections?.find((item: { id: string }) => item.id === id)?.catalog.status ===
    'unavailable'
  )
    return;
  try {
    const result = await api(
      `/model-connections${id ? `/${encodeURIComponent(id)}` : ''}/refresh`,
      'POST',
      {},
    );
    if (epoch !== sessionEpoch || signingOut) return;
    state.modelConnections = result.modelConnections;
    updateModelCatalogs(state.modelConnections);
    if (section === 'providers') render();
    if (agentDialog().open) renderAgentWizard();
  } catch (error) {
    notice((error as Error).message);
  }
}
async function saveProviderSecret(id: string, value: string) {
  const epoch = sessionEpoch;
  const result = await api('/provider-secrets', 'POST', { connection: id, value });
  if (epoch !== sessionEpoch || signingOut) return;
  state.modelConnections = result.modelConnections;
  updateModelCatalogs(state.modelConnections);
  if (section === 'providers') render();
  if (agentDialog().open) renderAgentWizard();
}
async function removeProviderSecret(id: string) {
  const epoch = sessionEpoch;
  const result = await api('/provider-secrets', 'DELETE', { connection: id });
  if (epoch !== sessionEpoch || signingOut) return;
  state.modelConnections = result.modelConnections;
  updateModelCatalogs(state.modelConnections);
  if (section === 'providers') render();
  if (agentDialog().open) renderAgentWizard();
}
setInterval(() => {
  if (document.hidden || $('#app').hidden) return;
  const selected = new Set(
    [...document.querySelectorAll<HTMLSelectElement>('[data-model-connection]')].map(
      (select) => select.value,
    ),
  );
  for (const id of selected) void refreshModels(id);
}, 5 * 60_000);
