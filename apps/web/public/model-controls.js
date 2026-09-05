import { escape } from './html.js';

export function modelControls(
  connections,
  selected = '',
  model = '',
  prefix = '',
  key = 'project',
) {
  const catalog = connections ?? [
    { id: '', label: 'Server default', models: [], modelSelection: true },
  ];
  const connection = catalog.find((item) => item.id === selected);
  const list = `models-${key}`;
  return `<div data-model-controls><label>${prefix ? 'Model provider' : 'Review provider'}<select aria-label="${prefix ? 'Model provider' : 'Review provider'}" name="${prefix}modelConnection" data-model-connection>${catalog.map((item) => `<option value="${escape(item.id)}" ${item.id === selected ? 'selected' : ''}>${escape(item.label)} · ${item.transport === 'host-cli' ? 'Coding agent' : 'Compatible API'}</option>`).join('')}${connection ? '' : `<option value="${escape(selected)}" selected>Unavailable provider</option>`}</select></label><label>${prefix ? 'Model name' : 'Review model'}<input name="${prefix}model" data-model-id list="${list}" maxlength="120" required autocomplete="off" placeholder="Enter a model ID supported by this provider" value="${escape(model)}" /></label><datalist id="${list}">${(connection?.models ?? []).map((id) => `<option value="${escape(id)}"></option>`).join('')}</datalist><small data-model-help>${help(connection)}</small><button type="button" class="secondary" data-model-refresh ${selected ? '' : 'disabled'}>Refresh models</button></div>`;
}
function help(connection) {
  if (!connection) return 'This provider is no longer configured. Choose an available connection.';
  if (!connection.modelSelection)
    return 'This legacy agent chooses its own model. The operator must configure model forwarding to use this ID.';
  const status = connection.catalog;
  const fetched = status?.fetchedAt
    ? ` Last fetched ${new Date(status.fetchedAt).toLocaleString()}.`
    : '';
  if (status?.status === 'error') return `${status.error}.${fetched} Custom IDs remain available.`;
  if (status?.status === 'refreshing') return `Refreshing models from the provider.${fetched}`;
  return `${status?.status === 'ready' ? 'Models supplied by the provider.' : 'Refresh to discover provider models.'}${fetched} You can also enter a custom ID.`;
}
export function changeModelConnection(select, connections) {
  const controls = select.closest('[data-model-controls]');
  const connection = connections.find((item) => item.id === select.value);
  controls.querySelector('datalist').innerHTML = (connection?.models ?? [])
    .map((id) => `<option value="${escape(id)}"></option>`)
    .join('');
  controls.querySelector('[data-model-id]').value = '';
  controls.querySelector('[data-model-refresh]').disabled = !select.value;
  controls.querySelector('[data-model-help]').textContent = help(connection);
}

export function updateModelCatalogs(connections) {
  for (const controls of document.querySelectorAll('[data-model-controls]')) {
    const select = controls.querySelector('[data-model-connection]');
    const connection = connections.find((item) => item.id === select.value);
    controls.querySelector('datalist').innerHTML = (connection?.models ?? [])
      .map((id) => `<option value="${escape(id)}"></option>`)
      .join('');
    controls.querySelector('[data-model-help]').textContent = help(connection);
  }
}
