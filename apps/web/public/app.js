import {
  mountProviderPanel,
  unmountProviderPanel,
  mountWorkspaceShell,
  mountWorkspacePanel,
  unmountWorkspacePanel,
  mountProjectModelControls,
  unmountProjectModelControls,
  updateModelCatalogs,
  reviewDrafts,
  reviewDraftKey,
} from '/provider-ui.js';
mountWorkspaceShell(document.querySelector('#workspace-root'));
const $ = (selector) => document.querySelector(selector);
const titles = {
  overview: 'Workspace overview',
  intents: 'Intent inventory',
  runs: 'Test runs',
  campaigns: 'Workflow campaigns',
  schedules: 'Schedules',
  admin: 'Administration',
  providers: 'Models & accounts',
};
let state = { projects: [], runs: [], audit: [], baselines: [] };
let section = 'overview';
let selectedProject = '';
let selectedRun = '';
let selectedCampaign = '';
const workflowSelections = new Map();
const workflowPages = new Map();
const campaignPages = new Map();
let editing = '';
let noticeTimer;
let sessionEpoch = 0;
let refreshSequence = 0;
let signingOut = false;
let declarationKind = '';
let declarationSearch = '';
const declarationPages = new Map();

async function api(path, method = 'GET', body) {
  const epoch = sessionEpoch;
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && epoch === sessionEpoch) {
      sessionEpoch++;
      $('#app').hidden = true;
      $('#login').hidden = false;
    }
    throw new Error(data.error ?? 'Request failed');
  }
  return data;
}
function notice(message) {
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
  const desired =
    section === 'intents'
      ? snapshot.projects
          .flatMap((item) =>
            ['hasInventory', 'hasLedger'].map(
              (key) => snapshot.runs.find((run) => run.projectId === item.id && run[key])?.id,
            ),
          )
          .filter(Boolean)
      : section === 'runs' && selectedRun
        ? [selectedRun]
        : [];
  await Promise.all(
    desired.map(async (id) => {
      const detail = await api(`/runs/${id}`);
      const index = snapshot.runs.findIndex((run) => run.id === id);
      if (index >= 0) snapshot.runs[index] = detail;
      else snapshot.runs.push(detail);
    }),
  );
  if (section === 'campaigns' && selectedCampaign) {
    const detail = await api(`/campaigns/${selectedCampaign}`);
    const index = snapshot.campaigns.findIndex((item) => item.id === selectedCampaign);
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
  if (
    !$('#project-dialog').open &&
    !document.activeElement?.closest('#declaration-search, [data-review-form]')
  )
    render();
}
function project(id) {
  return state.projects.find((item) => item.id === id);
}
function render() {
  $('#page-title').textContent = titles[section];
  $('#breadcrumb').textContent = titles[section];
  $('#page-description').textContent = {
    overview: 'Manage projects, uncover gaps, and review what changed.',
    intents: 'Source evidence, AI proposals, and the coverage still missing.',
    runs: 'Inspect outcomes, compare captures, and review evidence.',
    campaigns: 'Follow selected workflows and keep uncovered surfaces visible.',
    schedules: 'Keep testing with recurring, controlled runs.',
    admin: 'Manage instance access, execution scope, and review activity.',
    providers: 'Connect subscriptions and APIs. Discover models directly from your providers.',
  }[section];
  document
    .querySelectorAll('[data-nav]')
    .forEach((button) => button.classList.toggle('active', button.dataset.nav === section));
  const providerRoot = $('#provider-panel-root');
  const workspacePanel = $('#workspace-panel-root');
  if (['overview', 'schedules', 'admin', 'campaigns', 'intents', 'runs'].includes(section)) {
    if (providerRoot) unmountProviderPanel(providerRoot);
    if (!workspacePanel) $('#content').innerHTML = '<div id="workspace-panel-root"></div>';
    mountWorkspacePanel($('#workspace-panel-root'), {
      section,
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
function toggleExecution() {
  const form = $('#project-form');
  const enabled = form.elements.namedItem('guided').checked;
  $('#execution-fields').hidden = !enabled;
  $('#execution-fields').disabled = !enabled;
  form.elements.namedItem('configPath').disabled = enabled;
}
const executionNumbers = ['modelBudgetUsd', 'maxRuntimeMinutes', 'maxUrls', 'maxDepth'];
const executionLists = ['frameworks', 'domains', 'languages'];
const splitList = (value) =>
  String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
function editProject(id = '') {
  editing = id;
  const item = project(id) ?? {
    paths: ['/'],
    masks: [],
    viewports: [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ],
    paused: true,
    scheduleMode: 'discovery',
  };
  const form = $('#project-form');
  form.reset();
  mountProjectModelControls(
    $('#execution-model-controls'),
    {
      modelConnection: item.execution?.modelConnection ?? '',
      model: item.execution?.model ?? '',
    },
    refreshModels,
  );
  if (item.execution?.modelConnection) void refreshModels(item.execution.modelConnection);
  for (const key of ['name', 'folder', 'origin', 'configPath', 'cron', 'scheduleMode'])
    form.elements.namedItem(key).value = item[key] ?? '';
  form.elements.namedItem('paths').value = item.paths.join('\n');
  form.elements.namedItem('masks').value = item.masks.join('\n');
  form.elements.namedItem('viewports').value = item.viewports
    .map((view) => `${view.width}x${view.height}`)
    .join(', ');
  form.elements.namedItem('paused').checked = item.paused;
  form.elements.namedItem('captureConsent').checked = item.captureConsent;
  form.elements.namedItem('guided').checked = !!item.execution;
  if (item.execution) {
    for (const [key, value] of Object.entries(item.execution)) {
      if (key === 'model' || key === 'modelConnection') continue;
      if (key === 'persona') {
        for (const [field, text] of Object.entries(value))
          form.elements.namedItem(`persona_${field}`).value = text;
      } else if (key === 'featureFlags') {
        form.elements.namedItem('exec_featureFlags').value = Object.entries(value)
          .map(([flag, enabled]) => `${flag}=${enabled}`)
          .join('\n');
      } else
        form.elements.namedItem(`exec_${key}`).value = Array.isArray(value)
          ? value.join(', ')
          : value;
    }
  }
  toggleExecution();
  $('#dialog-title').textContent = editing ? 'Project settings' : 'Connect a project';
  $('#project-error').textContent = '';
  $('#project-dialog').showModal();
}
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  sessionEpoch++;
  try {
    await api('/session', 'POST', { token: event.target.elements.token.value });
    event.target.reset();
    $('#login-error').textContent = '';
    await refresh();
  } catch (error) {
    $('#login-error').textContent = error.message;
  }
});
$('#logout').addEventListener('click', async () => {
  sessionEpoch++;
  signingOut = true;
  try {
    await api('/session', 'DELETE', {});
    state = { projects: [], runs: [], audit: [], baselines: [] };
    selectedRun = '';
    selectedProject = '';
    const workspacePanel = $('#workspace-panel-root');
    const providerPanel = $('#provider-panel-root');
    if (workspacePanel) unmountWorkspacePanel(workspacePanel);
    if (providerPanel) unmountProviderPanel(providerPanel);
    unmountProjectModelControls($('#execution-model-controls'));
    reviewDrafts.clear();
    workflowSelections.clear();
    updateModelCatalogs([]);
    $('#project-form').reset();
    toggleExecution();
    $('#content').replaceChildren();
    $('#app').hidden = true;
    $('#login').hidden = false;
  } catch (error) {
    notice(error.message);
  } finally {
    signingOut = false;
  }
});
$('#new-project').addEventListener('click', () => editProject());
$('#project-form').elements.namedItem('guided').addEventListener('change', toggleExecution);
$('#close-dialog').addEventListener('click', () => $('#project-dialog').close());
$('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = new FormData(event.target);
  const body = Object.fromEntries(
    ['name', 'folder', 'origin', 'configPath', 'cron', 'scheduleMode'].map((key) => [
      key,
      values.get(key),
    ]),
  );
  body.paths = String(values.get('paths'))
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  body.masks = String(values.get('masks'))
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  body.viewports = String(values.get('viewports'))
    .split(',')
    .map((value) => {
      const [width, height] = value.trim().split('x').map(Number);
      return { width, height };
    });
  body.paused = values.has('paused');
  body.captureConsent = values.has('captureConsent');
  try {
    if (values.has('guided')) {
      body.configPath = '';
      body.execution = { persona: {} };
      for (const [name, value] of values) {
        if (name.startsWith('persona_')) body.execution.persona[name.slice(8)] = value;
        if (!name.startsWith('exec_')) continue;
        const key = name.slice(5);
        if (key === 'featureFlags') {
          const flags = String(value)
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const match = /^([A-Za-z][A-Za-z0-9_.-]{0,99})=(true|false)$/u.exec(line);
              if (!match) throw new Error('Use name=true or name=false for each feature flag');
              return [match[1], match[2] === 'true'];
            });
          if (new Set(flags.map(([key]) => key)).size !== flags.length)
            throw new Error('Feature flag names must be unique');
          body.execution.featureFlags = Object.fromEntries(flags);
        } else
          body.execution[key] = executionNumbers.includes(key)
            ? Number(value)
            : executionLists.includes(key)
              ? splitList(value)
              : value;
      }
    }
    await api(`/projects${editing ? `/${editing}` : ''}`, editing ? 'PUT' : 'POST', body);
    $('#project-dialog').close();
    await refresh();
    notice('Project settings saved.');
  } catch (error) {
    $('#project-error').textContent = error.message;
  }
});
document.addEventListener('change', (event) => {
  if (event.target.dataset.workflowRow) {
    const id = event.target.dataset.discovery;
    const selected = workflowSelections.get(id) ?? new Set();
    if (event.target.checked && selected.size >= 20) {
      event.target.checked = false;
      notice('Choose at most 20 workflows per campaign.');
      return;
    }
    if (event.target.checked) selected.add(event.target.value);
    else selected.delete(event.target.value);
    workflowSelections.set(id, selected);
    render();
  }
  if (event.target.id === 'declaration-kind') {
    declarationKind = event.target.value;
    declarationPages.clear();
    render();
  }
  if (event.target.id === 'project-filter') {
    selectedProject = event.target.value;
    render();
  }
});
document.addEventListener('submit', (event) => {
  if (event.target.id !== 'declaration-search') return;
  event.preventDefault();
  declarationSearch = new FormData(event.target).get('query');
  declarationPages.clear();
  render();
});
async function requestVisualReview(request) {
  const epoch = sessionEpoch;
  const { sourceRunId, ...body } = request;
  const run = await api(`/runs/${sourceRunId}/reviews`, 'POST', body);
  if (epoch !== sessionEpoch || signingOut) return;
  reviewDrafts.delete(reviewDraftKey(sourceRunId, body.captureId, body.sha256));
  document.activeElement?.blur();
  selectedRun = run.id;
  section = 'runs';
  state.runs = [run, ...state.runs.filter((item) => item.id !== run.id)];
  render();
  try {
    await refresh();
  } catch (error) {
    notice(error.message);
  }
}
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.dataset.campaignForm) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const campaign = await api(`/projects/${form.dataset.project}/campaigns`, 'POST', {
      discoveryRunId: form.dataset.discovery,
      inventoryRowIds: [...(workflowSelections.get(form.dataset.discovery) ?? [])],
    });
    selectedCampaign = campaign.id;
    section = 'campaigns';
    await refresh();
  } catch (error) {
    notice(error.message);
    button.disabled = false;
  }
});
document.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  try {
    if (button.dataset.openCampaign) {
      selectedCampaign = button.dataset.openCampaign;
      section = 'campaigns';
      await refresh();
    }
    if (button.dataset.cancelCampaign) {
      button.disabled = true;
      await api(`/campaigns/${button.dataset.cancelCampaign}/cancel`, 'POST', {});
      await refresh();
    }
    if (button.dataset.workflowPage || button.dataset.campaignPage) {
      const pages = button.dataset.workflowPage ? workflowPages : campaignPages;
      const id = button.dataset.workflowPage ?? button.dataset.campaignPage;
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
      section = button.dataset.nav ?? button.dataset.go;
      await refresh();
    }
    if (button.hasAttribute('data-add')) editProject();
    if (button.dataset.edit) editProject(button.dataset.edit);
    if (button.dataset.start) {
      button.disabled = true;
      const run = await api(`/projects/${button.dataset.project}/runs`, 'POST', {
        mode: button.dataset.start,
      });
      selectedRun = run.id;
      section = 'runs';
      await refresh();
    }
    if (button.dataset.openRun) {
      selectedRun = button.dataset.openRun;
      section = 'runs';
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
    notice(error.message);
  } finally {
    button.disabled = false;
  }
});
void refresh().catch(() => {});
setInterval(() => {
  if (!$('#app').hidden && !$('#project-dialog').open)
    void refresh().catch((error) => notice(error.message));
}, 2500);

async function refreshModels(id) {
  const epoch = sessionEpoch;
  try {
    const result = await api(`/model-connections/${encodeURIComponent(id)}/refresh`, 'POST', {});
    if (epoch !== sessionEpoch || signingOut) return;
    state.modelConnections = result.modelConnections;
    updateModelCatalogs(state.modelConnections);
    if (section === 'providers') render();
  } catch (error) {
    notice(error.message);
  }
}

setInterval(() => {
  if (document.hidden || $('#app').hidden) return;
  const selected = new Set(
    [...document.querySelectorAll('[data-model-connection]')]
      .map((select) => select.value)
      .filter(Boolean),
  );
  for (const id of selected) void refreshModels(id);
}, 5 * 60_000);
