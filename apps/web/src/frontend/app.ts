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

initTheme();
mountWorkspaceShell(document.querySelector('#workspace-root')!);
const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector(selector) as T;
const titles: Record<string, string> = {
  overview: 'Workspace overview',
  intents: 'Intent inventory',
  runs: 'Test runs',
  campaigns: 'Workflow campaigns',
  schedules: 'Schedules',
  admin: 'Administration',
  providers: 'Models & accounts',
};
const descriptions: Record<string, string> = {
  overview: 'Manage projects, uncover gaps, and review what changed.',
  intents: 'Source evidence, AI proposals, and the coverage still missing.',
  runs: 'Inspect outcomes, compare captures, and review evidence.',
  campaigns: 'Follow selected workflows and keep uncovered surfaces visible.',
  schedules: 'Keep testing with recurring, controlled runs.',
  admin: 'Manage instance access, execution scope, and review activity.',
  providers: 'Connect subscriptions and APIs. Discover models directly from your providers.',
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let state: any = { projects: [], runs: [], audit: [], baselines: [] };
let section = 'overview';
let selectedProject = '';
let selectedRun = '';
let selectedCampaign = '';
const workflowSelections = new Map<string, Set<string>>();
const workflowPages = new Map<string, number>();
const campaignPages = new Map<string, number>();
let noticeTimer: ReturnType<typeof setTimeout>;
let sessionEpoch = 0;
let refreshSequence = 0;
let signingOut = false;
let declarationKind = '';
let declarationSearch = '';
const declarationPages = new Map<string, number>();
const projectDialog = () => $<HTMLDialogElement>('#project-dialog');
const agentDialog = () => $<HTMLDialogElement>('#agent-dialog');

function readLocation() {
  const params = new URL(location.href).searchParams;
  const view = params.get('view') ?? 'overview';
  section = Object.hasOwn(titles, view) ? view : 'overview';
  const id = (name: string) => {
    const value = params.get(name) ?? '';
    return /^[a-f0-9-]{36}$/u.test(value) ? value : '';
  };
  selectedProject = id('project');
  selectedRun = section === 'runs' ? id('run') : '';
  selectedCampaign = section === 'campaigns' ? id('campaign') : '';
}
function writeLocation() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  if (section !== 'overview') url.searchParams.set('view', section);
  if (selectedProject) url.searchParams.set('project', selectedProject);
  if (section === 'runs' && selectedRun) url.searchParams.set('run', selectedRun);
  if (section === 'campaigns' && selectedCampaign) url.searchParams.set('campaign', selectedCampaign);
  if (url.href !== location.href) history.pushState(null, '', url);
  document.title = `${titles[section]} · Arxic`;
}
readLocation();
window.addEventListener('popstate', () => {
  readLocation();
  void refresh().then(() => $('#page-title').focus()).catch((error) => notice(error.message));
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
    throw new Error(data.error ?? 'Request failed');
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
  clearPendingRequests();
  workflowSelections.clear();
  updateModelCatalogs([]);
  closeProjectDialog();
  closeAgentDialog();
  $('#content').replaceChildren();
  $('#app').hidden = true;
  $('#login').hidden = false;
}
function notice(message: string) {
  $('#notice').textContent = message;
  $('#notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    $('#notice').hidden = true;
  }, 10_000);
}
async function refresh() {
  if (signingOut) return;
  const epoch = sessionEpoch;
  const sequence = ++refreshSequence;
  const snapshot = await api('/state');
  if (epoch !== sessionEpoch || sequence !== refreshSequence) return;
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
      const detail = await api(`/runs/${id}`);
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
    !document.activeElement?.closest('#declaration-search, [data-review-form]')
  )
    render();
}
function project(id: string) {
  return state.projects.find((item: { id: string }) => item.id === id);
}
function render() {
  writeLocation();
  $('#page-title').textContent = titles[section];
  $('#breadcrumb').textContent = titles[section];
  $('#page-description').textContent = descriptions[section];
  document
    .querySelectorAll<HTMLElement>('[data-nav]')
    .forEach((button) => {
      const active = button.dataset.nav === section;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  const providerRoot = $('#provider-panel-root');
  const workspacePanel = $('#workspace-panel-root');
  if (['overview', 'schedules', 'admin', 'campaigns', 'intents', 'runs'].includes(section)) {
    if (providerRoot) unmountProviderPanel(providerRoot);
    if (!workspacePanel) $('#content').innerHTML = '<div id="workspace-panel-root"></div>';
    mountWorkspacePanel($('#workspace-panel-root'), {
      section: section as 'overview',
      state,
      runPanel: {
        state,
        selectedId: selectedRun,
        projectId: selectedProject,
        onRefresh: refreshModels,
        onReview: requestVisualReview,
      },
      inventory: {
        projects: state.projects,
        runs: state.runs,
        projectId: selectedProject,
        kind: declarationKind,
        search: declarationSearch,
        declarationPages,
        selections: workflowSelections,
        workflowPages,
      },
      campaign: {
        campaigns: state.campaigns ?? [],
        selectedId: selectedCampaign,
        projectId: selectedProject,
        pages: campaignPages,
      },
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
    });
    return;
  }
  if (providerRoot) unmountProviderPanel(providerRoot);
}
function editProject(id = '') {
  mountProjectWizard($('#project-wizard-root'), {
    project: project(id),
    api,
    onRefreshModels: refreshModels,
    onClose: closeProjectDialog,
    onSaved: async () => {
      closeProjectDialog();
      await refresh();
      notice('Project settings saved.');
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
$('#connect-agent').addEventListener('click', () => connectAgent());
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
  if (target.id === 'project-filter') {
    selectedProject = target.value;
    render();
  }
});
document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
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
    const campaign = await api(`/projects/${form.dataset.project}/campaigns`, 'POST', {
      discoveryRunId: form.dataset.discovery,
      inventoryRowIds: [...(workflowSelections.get(form.dataset.discovery!) ?? [])],
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
document.addEventListener('click', async (event) => {
  const button = (event.target as Element).closest('button');
  if (!button || button.closest('dialog')) return;
  try {
    if (button.dataset.openCampaign) {
      selectedCampaign = button.dataset.openCampaign;
      section = 'campaigns';
      writeLocation();
      await refresh();
    }
    if (button.dataset.cancelCampaign) {
      button.disabled = true;
      await api(`/campaigns/${button.dataset.cancelCampaign}/cancel`, 'POST', {});
      await refresh();
    }
    if (button.dataset.workflowPage || button.dataset.campaignPage) {
      const pages = button.dataset.workflowPage ? workflowPages : campaignPages;
      const id = (button.dataset.workflowPage ?? button.dataset.campaignPage)!;
      pages.set(id, Math.max(0, (pages.get(id) ?? 0) + Number(button.dataset.direction)));
      render();
    }
    if (button.dataset.declarationPage) {
      const id = button.dataset.declarationPage;
      declarationPages.set(
        id,
        Math.max(0, (declarationPages.get(id) ?? 0) + Number(button.dataset.direction)),
      );
      render();
    }
    if (button.dataset.nav || button.dataset.go) {
      section = (button.dataset.nav ?? button.dataset.go)!;
      writeLocation();
      await refresh();
      $('#page-title').focus();
    }
    if (button.hasAttribute('data-add')) editProject();
    if (button.hasAttribute('data-connect-agent')) connectAgent();
    if (button.dataset.edit) editProject(button.dataset.edit);
    if (button.dataset.start) {
      button.disabled = true;
      const run = await api(`/projects/${button.dataset.project}/runs`, 'POST', {
        mode: button.dataset.start,
      });
      selectedRun = run.id;
      section = 'runs';
      writeLocation();
      await refresh();
    }
    if (button.dataset.openRun) {
      selectedRun = button.dataset.openRun;
      section = 'runs';
      writeLocation();
      await refresh();
      $('.run-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (
      button.dataset.deleteRun &&
      window.confirm('Delete this run and its artifacts? Approved baselines are protected.')
    ) {
      await api(`/runs/${button.dataset.deleteRun}`, 'DELETE', {});
      selectedRun = '';
      await refresh();
      notice('Run deleted.');
    }
    if (button.dataset.cancel) {
      await api(`/runs/${button.dataset.cancel}/cancel`, 'POST', {});
      await refresh();
    }
    if (button.dataset.approve) {
      button.disabled = true;
      await api(`/runs/${button.dataset.run}/baselines`, 'POST', {
        captureId: button.dataset.approve,
      });
      await refresh();
      notice('Baseline approved. Future comparisons use these captured pixels.');
    }
  } catch (error) {
    notice((error as Error).message);
  } finally {
    button.disabled = false;
  }
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
setInterval(() => {
  if (document.hidden || $('#app').hidden) return;
  const selected = new Set(
    [...document.querySelectorAll<HTMLSelectElement>('[data-model-connection]')].map(
      (select) => select.value,
    ),
  );
  for (const id of selected) void refreshModels(id);
}, 5 * 60_000);
