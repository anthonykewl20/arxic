import { time } from './display';
import { useState, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import type { modelConnections } from '../model-connections';

export type ModelConnection = ReturnType<typeof modelConnections>[number];
export type ModelChoice = { modelConnection: string; model: string };
export type RefreshModels = (id: string) => Promise<void>;
let catalog: ModelConnection[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
/** Publish provider metadata without replacing user-entered model/form state. */
export function updateModelCatalogs(connections: ModelConnection[]) {
  catalog = connections;
  for (const listener of listeners) listener();
}
function modelHelp(connection?: ModelConnection) {
  if (!connection) return 'This provider is no longer configured. Choose an available connection.';
  if (!connection.modelSelection)
    return 'This legacy agent chooses its own model. The operator must configure model forwarding to use this ID.';
  const status = connection.catalog;
  const fetched = status.fetchedAt ? ` Last fetched ${time(status.fetchedAt)}.` : '';
  if (status.status === 'error')
    return `${status.error ?? 'Model discovery failed'}.${fetched}${status.error?.toLowerCase().includes('custom') ? '' : ' Custom IDs remain available.'}`;
  if (status.status === 'refreshing') return `Refreshing models from the provider.${fetched}`;
  return `${status.status === 'ready' ? 'Models supplied by the provider.' : 'Refresh to discover provider models.'}${fetched} You can also enter a custom ID.`;
}
export function ModelControls({
  value,
  onChange,
  onRefresh,
  prefix = '',
  listId,
}: {
  value: ModelChoice;
  onChange: (value: ModelChoice) => void;
  onRefresh: RefreshModels;
  prefix?: string;
  listId: string;
}) {
  const connections = useSyncExternalStore(subscribe, () => catalog);
  const connection = connections.find((item) => item.id === value.modelConnection);
  const [pending, setPending] = useState(0);
  const refresh = async (id: string) => {
    if (!id) return;
    setPending((count) => count + 1);
    try {
      await onRefresh(id);
    } finally {
      setPending((count) => count - 1);
    }
  };
  const providerLabel = prefix ? 'Model provider' : 'Review provider';
  const modelLabel = prefix ? 'Model name' : 'Review model';
  return (
    <div data-model-controls>
      <label>
        {providerLabel}
        <select
          aria-label={providerLabel}
          name={`${prefix}modelConnection`}
          data-model-connection
          value={value.modelConnection}
          onChange={(event) => {
            const id = event.target.value;
            onChange({ modelConnection: id, model: '' });
            void refresh(id);
          }}
        >
          {connections.map((item) => (
            <option value={item.id} key={item.id}>
              {item.label} ·{' '}
              {item.transport === 'host-cli'
                ? 'Coding agent'
                : item.transport === 'openclaw'
                  ? 'Gateway'
                  : 'Compatible API'}
            </option>
          ))}
          {!connection && <option value={value.modelConnection}>Unavailable provider</option>}
        </select>
      </label>
      <label>
        {modelLabel}
        <Input
          name={`${prefix}model`}
          data-model-id
          list={listId}
          maxLength={120}
          required
          autoComplete="off"
          placeholder="Enter a model ID supported by this provider"
          value={value.model}
          onChange={(event) => onChange({ ...value, model: event.target.value })}
        />
      </label>
      <datalist id={listId}>
        {(connection?.models ?? []).map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <small data-model-help>{modelHelp(connection)}</small>
      <Button
        type="button"
        variant="outline"
        className="secondary"
        data-model-refresh
        disabled={!value.modelConnection || pending > 0}
        onClick={() => void refresh(value.modelConnection)}
      >
        <RefreshCw size={14} aria-hidden="true" />
        Refresh models
      </Button>
    </div>
  );
}
function ProjectModelControls({
  initial,
  onRefresh,
}: {
  initial: ModelChoice;
  onRefresh: RefreshModels;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ModelControls
      value={value}
      onChange={setValue}
      onRefresh={onRefresh}
      prefix="exec_"
      listId="models-project"
    />
  );
}
const roots = new WeakMap<Element, { root: Root; revision: number }>();
export function mountProjectModelControls(
  element: Element,
  initial: ModelChoice,
  onRefresh: RefreshModels,
) {
  let entry = roots.get(element);
  if (!entry) {
    entry = { root: createRoot(element), revision: 0 };
    roots.set(element, entry);
  }
  entry.revision++;
  const current = entry;
  flushSync(() =>
    current.root.render(
      <ProjectModelControls key={current.revision} initial={initial} onRefresh={onRefresh} />,
    ),
  );
}

export function unmountProjectModelControls(element: Element) {
  roots.get(element)?.root.unmount();
  roots.delete(element);
}
