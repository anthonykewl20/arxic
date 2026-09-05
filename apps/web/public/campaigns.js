import { escape } from './html.js';

const pageSize = 50;
function pageOf(rows, id, pages) {
  const page = Math.min(pages.get(id) ?? 0, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  pages.set(id, page);
  return { page, rows: rows.slice(page * pageSize, (page + 1) * pageSize) };
}
function pagination(id, page, total, attribute) {
  return `<div class="toolbar"><button type="button" class="secondary" data-${attribute}="${escape(id)}" data-direction="-1" ${page === 0 ? 'disabled' : ''}>Previous surfaces</button><small>${total ? page * pageSize + 1 : 0}–${Math.min((page + 1) * pageSize, total)} of ${total}</small><button type="button" class="secondary" data-${attribute}="${escape(id)}" data-direction="1" ${(page + 1) * pageSize >= total ? 'disabled' : ''}>Next surfaces</button></div>`;
}
export function workflowSelection(project, discovery, selections, pages) {
  const rows = discovery?.result?.workflowRows;
  if (!rows)
    return '<p class="scope-note">Run source discovery again to enable workflow selection.</p>';
  if (!project.execution)
    return `<section class="workflow-selection card"><h2>Select workflows</h2><p>Save guided AI settings to start a campaign.</p><button class="secondary" data-edit="${project.id}">Configure campaign settings</button></section>`;
  const selected = selections.get(discovery.id) ?? new Set();
  const visible = pageOf(rows, discovery.id, pages);
  return `<section class="workflow-selection card"><h2>Select workflows</h2><p class="muted">Choose up to 20 source surfaces. Each selected surface gets a separate AI execution attempt with two verifier replays. Unsupported routes and unselected surfaces stay in the coverage record.</p><form data-campaign-form="true" data-project="${project.id}" data-discovery="${discovery.id}"><ul class="workflow-choices">${visible.rows.map((row) => `<li>${row.inventoryRowId ? `<label><input type="checkbox" data-workflow-row="true" data-discovery="${discovery.id}" value="${escape(row.inventoryRowId)}" ${selected.has(row.inventoryRowId) ? 'checked' : ''} />Select ${escape(row.method)} ${escape(row.path)}</label>` : `<span>${escape(row.method)} ${escape(row.path)}</span><small>${escape(row.disposition)} · ${escape(row.reason)}</small>`}</li>`).join('')}</ul>${pagination(discovery.id, visible.page, rows.length, 'workflow-page')}<p class="scope-note">${selected.size} selected. Maximum planning estimate: $${(selected.size * project.execution.modelBudgetUsd).toFixed(4)} across these attempts; host-agent billing may be unreported. Runs are serialized and use the saved persona and deployment settings.</p><button type="submit" class="primary" ${selected.size === 0 ? 'disabled' : ''}>Start selected campaign</button></form></section>`;
}
