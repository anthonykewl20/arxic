const $ = (selector) => document.querySelector(selector);
import { escape, pill, time } from './html.js';
import { workflowSelection, campaignScreen } from './campaigns.js';
const titles = {
  overview: 'Workspace overview',
  intents: 'Intent inventory',
  runs: 'Test runs',
  campaigns: 'Workflow campaigns',
  schedules: 'Schedules',
  admin: 'Administration',
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
  $('#app').hidden = false;
  $('#login').hidden = true;
  $('#version').textContent = state.versionLabel;
  if (state.queueError) notice(state.queueError);
  if (!$('#project-dialog').open && !document.activeElement?.closest('#declaration-search'))
    render();
}
function project(id) {
  return state.projects.find((item) => item.id === id);
}
function runTable(runs) {
  if (!runs.length)
    return `<div class="empty"><h2>No runs yet</h2><p class="muted">Start with source discovery. Add a test origin for visual comparison or an Arxic configuration for AI E2E.</p></div>`;
  return `<div class="panel"><table class="table"><thead><tr><th>PROJECT / RUN</th><th>TYPE</th><th>STATUS</th><th>STARTED</th><th></th></tr></thead><tbody>${runs.map((run) => `<tr><td>${escape(run.project.name)}<small>${escape(run.id.slice(0, 8))}</small></td><td>${escape(run.mode)}</td><td>${pill(run.state)} ${run.result ? pill(run.result.outcome) : ''}</td><td>${escape(time(run.createdAt))}</td><td><button class="text-button" data-open-run="${run.id}">View result →</button></td></tr>`).join('')}</tbody></table></div>`;
}
function overview() {
  const changed = state.runs.filter((run) =>
    run.result?.captures?.some((capture) => capture.status === 'changed'),
  ).length;
  const stats = [
    ['Connected projects', state.projects.length, 'Folders on this instance'],
    [
      'Active runs',
      state.runs.filter((run) => ['queued', 'running'].includes(run.state)).length,
      'Durable, serialized queue',
    ],
    ['Runs with visual changes', changed, 'In the latest 200 runs'],
    [
      'Active schedules',
      state.projects.filter((item) => item.cron && !item.paused).length,
      'UTC · server must be running',
    ],
  ];
  return `<div class="stats">${stats.map(([title, value, caption]) => `<div class="stat"><span class="stat-label">${title}</span><strong>${value}</strong><small>${caption}</small></div>`).join('')}</div><div class="section-heading"><h2>Your projects</h2><small>${state.projects.length} connected</small></div>${state.projects.length ? `<div class="project-grid">${state.projects.map((item) => `<article class="card"><div class="card-top"><div class="project-icon" aria-hidden="true">⌘</div><button class="text-button" data-edit="${item.id}">Settings ↗</button></div><h3>${escape(item.name)}</h3><p class="folder">${escape(item.folder)}</p><div class="card-info"><span>${item.origin ? escape(item.origin) : 'Source discovery only'}</span><span>${item.cron && !item.paused ? 'Scheduled' : 'On demand'}</span></div><div class="card-actions"><button class="primary" data-start="discovery" data-project="${item.id}">Discover intents</button><button class="secondary" data-start="visual" data-project="${item.id}">Visual test</button><button class="secondary" data-start="agent" data-project="${item.id}">AI E2E</button></div></article>`).join('')}</div>` : `<div class="empty"><h2>Connect your first frontend</h2><p class="muted">Point Arxic at a project folder to inventory source evidence. Then connect a running test app to inspect visual changes and replay behavior.</p><button class="primary" data-add>Add project</button></div>`}<div class="scope-note"><strong>Coverage with context.</strong> Discovered surfaces are hypotheses until runtime evidence supports them. A matching screenshot does not prove business correctness. Blocked and unsupported areas stay visible.</div><div class="section-heading"><h2>Recent activity</h2><button class="text-button" data-go="runs">All test runs →</button></div>${runTable(state.runs.slice(0, 6))}`;
}
function projectSelect() {
  return `<select id="project-filter" aria-label="Filter by project"><option value="">All projects</option>${state.projects.map((item) => `<option value="${item.id}" ${selectedProject === item.id ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}</select>`;
}
function frontendInventory(run) {
  const inventory = run?.result?.frontend;
  if (!inventory) return '';
  const matches = inventory.rows.filter(
    (row) =>
      (!declarationKind || row.kind === declarationKind) &&
      `${row.label} ${row.source.path}`.toLowerCase().includes(declarationSearch.toLowerCase()),
  );
  const page = Math.min(
    declarationPages.get(run.id) ?? 0,
    Math.max(0, Math.ceil(matches.length / 100) - 1),
  );
  declarationPages.set(run.id, page);
  return `<section class="frontend-inventory"><div class="section-heading"><h2>Frontend declarations</h2><small>${inventory.rows.length} hypotheses · ${inventory.coverage.analyzedFiles}/${inventory.coverage.enumeratedFiles} files analyzed</small></div>
  <div class="scope-note">Source declarations describe possible behavior. Runtime coverage is still missing for: ${inventory.coverage.unobservedDimensions.map(escape).join(', ')}. Git-ignored files are outside this scan. Source revision: <code>${escape(inventory.revision.commit)}</code>${inventory.revision.dirty ? ' · Uncommitted files excluded' : ''}.</div>
  <div class="panel"><table class="table" data-frontend-rows><thead><tr><th>KIND</th><th>DECLARATION</th><th>SOURCE EVIDENCE</th></tr></thead><tbody>${
    matches
      .slice(page * 100, (page + 1) * 100)
      .map(
        (row) =>
          `<tr><td data-label="KIND">${escape(row.kind)}<small>${escape(row.basis)} · hypothesized</small></td><td data-label="DECLARATION">${escape(row.label)}</td><td data-label="SOURCE EVIDENCE">${escape(row.source.path)}:${row.source.startLine}–${row.source.endLine}<small title="${escape(row.source.blobSha256)}">SHA-256 ${escape(row.source.blobSha256.slice(0, 12))}</small></td></tr>`,
      )
      .join('') || '<tr><td colspan="3">No declarations match these filters.</td></tr>'
  }</tbody></table></div>
  <div class="toolbar"><button class="secondary" data-declaration-page="${run.id}" data-direction="-1" ${page === 0 ? 'disabled' : ''}>Previous declarations</button><small>${matches.length ? page * 100 + 1 : 0}–${Math.min((page + 1) * 100, matches.length)} of ${matches.length}</small><button class="secondary" data-declaration-page="${run.id}" data-direction="1" ${(page + 1) * 100 >= matches.length ? 'disabled' : ''}>Next declarations</button><a href="/api/runs/${run.id}" target="_blank" rel="noopener">Complete inventory JSON</a></div>
  <details data-detail-key="${run.id}-gaps"><summary>Coverage gaps</summary><p>${inventory.gaps.length} file gaps. First 100 shown; the complete JSON preserves every gap and per-file row count. Scan limits: ${inventory.coverage.fileLimit} eligible files, ${inventory.coverage.rowLimit} declarations.</p><ul>${inventory.gaps
    .slice(0, 100)
    .map((gap) => `<li>${escape(gap.path)} · ${escape(gap.reason)}</li>`)
    .join('')}</ul></details></section>`;
}
function inventories() {
  const latest = state.projects
    .filter((item) => !selectedProject || item.id === selectedProject)
    .map((item) => ({
      item,
      run: state.runs.find(
        (run) => run.projectId === item.id && (run.result?.inventory || run.result?.ledger),
      ),
      discovery: state.runs.find((run) => run.projectId === item.id && run.result?.frontend),
    }));
  return `<div class="toolbar">${projectSelect()}<select id="declaration-kind" aria-label="Declaration kind"><option value="">All declarations</option>${['component', 'control', 'condition', 'state', 'action', 'requirement', 'test', 'configuration', 'feature-flag'].map((kind) => `<option ${kind === declarationKind ? 'selected' : ''}>${kind}</option>`).join('')}</select><form id="declaration-search"><input aria-label="Search declarations" name="query" value="${escape(declarationSearch)}" placeholder="Declaration or source file" maxlength="200" /><button class="secondary">Search</button></form></div><div class="scope-note">Source discovery inventories routes and frontend declarations with explicit gaps; it does not recover every business rule. AI E2E adds evidence-grounded proposals and replay outcomes. Unseen personas, states, flags, and pages remain uncovered.</div>${
    latest
      .map(({ item, run, discovery }) => {
        if (!run)
          return `<div class="empty"><h2>${escape(item.name)}</h2><p class="muted">No inventory yet.</p><button class="primary" data-start="discovery" data-project="${item.id}">Discover intents</button></div>`;
        const rows = run.result.ledger?.rows ?? run.result.inventory?.rows ?? [];
        return `<div class="section-heading"><h2>${escape(item.name)}</h2><small>${rows.length} known surfaces · ${escape(run.mode)} · ${escape(time(run.createdAt))}</small></div><div class="panel"><table class="table"><thead><tr><th>SURFACE</th><th>DOMAIN / INTENT</th><th>DISPOSITION</th><th>EVIDENCE / GAP</th></tr></thead><tbody>${rows
          .map(
            (row) =>
              `<tr><td>${escape(row.method ?? row.surface?.method)} ${escape(row.path ?? row.surface?.path)}</td><td>${escape(row.domain)}${(row.intents ?? []).map((intent) => `<small>${escape(intent.intent)} · ${escape(intent.truthState)}</small>`).join('')}</td><td>${pill(row.truthState ?? 'hypothesized')}<small>${escape(row.disposition)}</small></td><td>${escape(row.reason ?? '')}${(
                row.sourceRefs ?? []
              )
                .slice(0, 3)
                .map((ref) => `<small>${escape(ref.path)}:${escape(ref.startLine)}</small>`)
                .join(
                  '',
                )}${row.intents?.length === 0 ? '<small>No intent proposal for this surface.</small>' : ''}</td></tr>`,
          )
          .join(
            '',
          )}</tbody></table></div>${workflowSelection(item, discovery, workflowSelections, workflowPages)}${frontendInventory(discovery)}`;
      })
      .join('') || '<div class="empty"><h2>No connected projects</h2></div>'
  }`;
}
function runDetail(run) {
  const result = run.result;
  const figure = (label, runId, file) =>
    `<figure><figcaption>${label}</figcaption>${file ? `<a href="/api/runs/${runId}/artifacts/${escape(file)}" target="_blank" rel="noopener"><img alt="${label}" src="/api/runs/${runId}/artifacts/${escape(file)}" /></a>` : '<div class="placeholder">Awaiting a reviewed baseline</div>'}</figure>`;
  return `<section class="run-detail"><div class="section-heading"><div><h2>${escape(run.project.name)} / ${escape(run.mode)}</h2><small>${escape(run.id)}</small></div>${['running', 'queued'].includes(run.state) ? `<button class="danger" data-cancel="${run.id}">Cancel run</button>` : `<button class="secondary" data-start="${run.mode}" data-project="${run.projectId}">Run again</button>`}</div><div class="panel"><div class="result-summary">${pill(run.state)} ${result ? pill(result.outcome) : ''}<p>${escape(result?.summary ?? 'The job is queued or running. Results update automatically.')}</p></div>${result?.findings?.length ? `<div class="findings"><h3>Observed frontend findings</h3><ul>${result.findings.map((item) => `<li>${escape(item.path)} · ${escape(item.kind)}: ${item.count}</li>`).join('')}</ul></div>` : ''}${result?.engineRun || result?.diagnostics ? `<details><summary>Engine diagnostics and evidence</summary><pre>${escape(JSON.stringify({ diagnostics: result.diagnostics, run: result.engineRun }, null, 2))}</pre></details>` : ''}</div>${(
    result?.captures ?? []
  )
    .map((capture) => {
      const approved = state.baselines.some(
        (item) => item.run_id === run.id && item.capture_id === capture.id,
      );
      return `<article class="capture"><div class="capture-head"><div><h3>${escape(capture.path)} <span class="muted">${capture.viewport.width} × ${capture.viewport.height}</span></h3><small>${pill(capture.status)} ${capture.changedPixels === undefined ? '' : `${capture.changedPixels.toLocaleString()} changed pixels · ${(capture.ratio * 100).toFixed(3)}%`}</small></div>${approved ? pill('approved baseline') : run.state === 'completed' && capture.status !== 'unstable' ? `<button class="secondary" data-approve="${capture.id}" data-run="${run.id}">Approve as baseline</button>` : ''}</div><div class="compare">${figure('Approved baseline', capture.baselineRunId, capture.baselineFile)}${figure('Current capture', run.id, capture.file)}${figure('Pixel difference', run.id, capture.diffFile)}</div></article>`;
    })
    .join(
      '',
    )}${!['queued', 'running'].includes(run.state) ? `<p class="section-heading"><button class="danger" data-delete-run="${run.id}">Delete run and artifacts</button></p>` : ''}${result?.captures?.length ? `<div class="scope-note">Inputs are masked. Review all remaining pixels before sharing. Baseline approval records your visual decision; it does not assign a verified business outcome. Captures cover configured viewports and paths only. <a href="/api/runs/${run.id}/artifacts/timeline.json">Action timeline</a> · <a href="/api/runs/${run.id}/artifacts/timeline.sanitization.json">Sanitization provenance</a></div>` : ''}</section>`;
}
function runs() {
  const chosen = state.runs.find((item) => item.id === selectedRun);
  return `<div class="toolbar">${projectSelect()}<small>Latest 200 runs. All results persist on this instance.</small></div>${runTable(state.runs.filter((item) => !selectedProject || item.projectId === selectedProject))}${chosen ? runDetail(chosen) : ''}`;
}
function schedules() {
  return `<div class="scope-note">Schedules use UTC and require this server to remain running. Missed slots are coalesced into one run after restart. Jobs run one at a time; no catch-up burst.</div>${state.projects.map((item) => `<article class="card"><div class="card-top"><div><h3>${escape(item.name)}</h3><p class="muted">${escape(item.cron || 'No schedule configured')} · ${escape(item.scheduleMode)}</p><small>Next due: ${item.paused ? 'Paused' : escape(time(item.nextRunAt))}</small></div><div>${pill(item.paused || !item.cron ? 'paused' : 'active')} <button class="secondary" data-edit="${item.id}">Configure</button></div></div></article>`).join('') || '<div class="empty"><h2>Add a project to schedule tests</h2></div>'}`;
}
function administration() {
  return `<div class="project-grid"><section class="card"><p class="eyebrow">ACCESS & EXECUTION</p><h2>Single administrator</h2><p class="muted">Session-based access. Eight-hour sessions. Token rotation requires a server restart. Run jobs execute on this host with the operator’s installed engines and agent credentials.</p><div class="scope-note">Only mount trusted project folders. This instance is not a multi-tenant sandbox.</div></section><section class="card"><p class="eyebrow">ALLOWED PROJECT ROOTS</p><h2>Server workspace</h2>${state.roots.map((root) => `<p class="folder">${escape(root)}</p>`).join('')}<p class="muted">Folders are resolved on the server, including symlinks. Change the root allow-list in server configuration.</p></section></div><div class="section-heading"><h2>Administrator activity</h2><small>Latest 100 events</small></div><div class="card"><ul class="audit-list">${state.audit.map((item) => `<li><span>${escape(item.action)}<small class="folder"> ${escape(item.subject)}</small></span><small>${escape(time(item.at))}</small></li>`).join('') || '<li>No activity recorded.</li>'}</ul></div>`;
}
function render() {
  const openDetails = new Set(
    [...document.querySelectorAll('[data-detail-key][open]')].map(
      (element) => element.dataset.detailKey,
    ),
  );
  $('#page-title').textContent = titles[section];
  $('#breadcrumb').textContent = titles[section];
  $('#page-description').textContent = {
    overview: 'Manage projects, uncover gaps, and review what changed.',
    intents: 'Source evidence, AI proposals, and the coverage still missing.',
    runs: 'Inspect outcomes, compare captures, and review evidence.',
    campaigns: 'Follow selected workflows and keep uncovered surfaces visible.',
    schedules: 'Keep testing with recurring, controlled runs.',
    admin: 'Manage instance access, execution scope, and review activity.',
  }[section];
  document
    .querySelectorAll('[data-nav]')
    .forEach((button) => button.classList.toggle('active', button.dataset.nav === section));
  $('#content').innerHTML = {
    overview,
    intents: inventories,
    campaigns: () =>
      campaignScreen(state.campaigns ?? [], selectedCampaign, selectedProject, campaignPages),
    runs,
    schedules,
    admin: administration,
  }[section]();
  document.querySelectorAll('[data-detail-key]').forEach((element) => {
    element.open = openDetails.has(element.dataset.detailKey);
  });
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
