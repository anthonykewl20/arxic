import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RefreshCw, Search, ArrowUpRight, Plug, Check, AlertCircle, Terminal } from 'lucide-react';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Input } from './components/ui/input';
import './styles.css';
import './workspace.css';

type Connection = {
  id: string;
  label: string;
  transport: string;
  billing?: string;
  models: string[];
  catalog?: { status: string; fetchedAt: string | null; error: string | null };
};
type Setup = {
  id: string;
  name: string;
  method: string;
  command?: string;
  url: string;
  detail: string;
};
type Props = {
  connections: Connection[];
  setup: Setup[];
  onRefresh: (id: string) => Promise<void>;
};
function ProviderPanel({ connections, setup, onRefresh }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(new Set<string>());
  const [error, setError] = useState('');
  const available = connections
    .filter((item) => item.id)
    .concat(connections.filter((item) => !item.id && item.catalog?.status !== 'unavailable'));
  const active = available.find((item) => item.id === selected) ?? available[0];
  const guide = setup.find((item) => item.id === active?.id);
  const refresh = async (id: string) => {
    setPending((old) => new Set(old).add(id));
    setError('');
    try {
      await onRefresh(id);
    } catch {
      setError('Could not refresh models. Check your session and connection.');
    } finally {
      setPending((old) => {
        const next = new Set(old);
        next.delete(id);
        return next;
      });
    }
  };
  return (
    <section className="provider-workbench" aria-label="Provider connections">
      <div className="provider-summary">
        <div className="provider-summary-icon">
          <Plug size={21} />
        </div>
        <div>
          <h2>Your models. Your accounts.</h2>
          <p>Connect the tools you already use. Model choices come from each provider.</p>
        </div>
        <Badge variant="outline">{available.length} connections</Badge>
      </div>
      <div className="provider-layout">
        <nav className="provider-list" aria-label="Model providers">
          <div className="provider-list-label">CONNECTIONS</div>
          {available.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`provider-row ${active?.id === item.id ? 'is-selected' : ''}`}
              aria-pressed={active?.id === item.id}
              onClick={() => {
                setSelected(item.id);
                setQuery('');
                if (item.catalog?.status === 'unfetched') void refresh(item.id);
              }}
            >
              <span className="provider-avatar">{item.label.slice(0, 1)}</span>
              <span className="provider-row-copy">
                <strong>{item.label}</strong>
                <small>
                  {item.billing === 'subscription'
                    ? 'Subscription account'
                    : item.transport === 'host-cli'
                      ? 'Connected coding agent'
                      : 'API connection'}
                </small>
              </span>
              {item.catalog?.status === 'ready' ? (
                <Check size={14} className="provider-ready" />
              ) : item.catalog?.status === 'error' ? (
                <AlertCircle size={14} />
              ) : null}
            </button>
          ))}
        </nav>
        {active ? (
          <div className="provider-detail">
            <div className="provider-detail-heading">
              <div>
                <p className="provider-kicker">MODEL CONNECTION</p>
                <h2>{active.label}</h2>
              </div>
              <Badge variant="secondary">
                {active.billing === 'subscription'
                  ? 'Subscription'
                  : active.billing === 'api'
                    ? 'API billing'
                    : 'Managed externally'}
              </Badge>
            </div>
            {guide && (
              <div className="provider-setup">
                <h3>{guide.method}</h3>
                <p>{guide.detail}</p>
                {guide.command && (
                  <div className="provider-command">
                    <Terminal size={15} />
                    <code>{guide.command}</code>
                  </div>
                )}
                <a href={guide.url} target="_blank" rel="noreferrer">
                  Connection guide <ArrowUpRight size={14} />
                </a>
              </div>
            )}
            <div className="provider-model-heading">
              <div>
                <h3>
                  Available models <span>{active.models.length}</span>
                </h3>
                <p>
                  {active.catalog?.fetchedAt
                    ? `Last fetched ${new Date(active.catalog.fetchedAt).toLocaleString()}`
                    : 'No catalog fetched yet'}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={pending.has(active.id) || active.catalog?.status === 'refreshing'}
                onClick={() => void refresh(active.id)}
              >
                <RefreshCw className={pending.has(active.id) ? 'animate-spin' : ''} />
                {pending.has(active.id) ? 'Refreshing' : 'Refresh models'}
              </Button>
            </div>
            {(error || active.catalog?.error) && (
              <div className="provider-error" role="alert">
                <AlertCircle size={16} />
                <span>
                  {error || active.catalog?.error}
                  {active.catalog?.fetchedAt ? ' The last successful catalog is shown below.' : ''}
                </span>
              </div>
            )}
            <div className="provider-search">
              <Search size={16} />
              <Input
                aria-label="Search provider models"
                placeholder="Search model IDs…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="provider-model-list">
              {active.models
                .filter((id) => id.toLowerCase().includes(query.toLowerCase()))
                .map((id) => (
                  <div className="provider-model-row" key={id}>
                    <code>{id}</code>
                    <Badge variant="outline">Provider catalog</Badge>
                  </div>
                ))}
              {active.models.length === 0 && (
                <div className="provider-empty">
                  <Plug size={24} />
                  <h3>
                    {active.catalog?.error
                      ? 'Connection needs attention'
                      : 'Discover this provider’s models'}
                  </h3>
                  <p>
                    Refresh the catalog after connecting your account on this server. Custom model
                    IDs are available in project and review settings.
                  </p>
                </div>
              )}
            </div>
            <p className="provider-footnote">
              Catalogs refresh every five minutes while in use. Access and usage limits are
              controlled by your provider; a listed model does not guarantee account entitlement.
            </p>
          </div>
        ) : (
          <div className="provider-empty">No provider connections configured.</div>
        )}
      </div>
    </section>
  );
}
const roots = new WeakMap<Element, Root>();
export function mountProviderPanel(element: Element, props: Props) {
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }
  root.render(<ProviderPanel {...props} />);
}
export function unmountProviderPanel(element: Element) {
  roots.get(element)?.unmount();
  roots.delete(element);
}

export { mountWorkspaceShell } from './workspace-shell';

export { mountWorkspacePanel, unmountWorkspacePanel } from './workspace-panels';

export {
  mountProjectModelControls,
  unmountProjectModelControls,
  updateModelCatalogs,
} from './model-controls';
export { reviewDrafts, reviewDraftKey } from './review-form';
export { clearPendingRequests, beginPendingRequest, campaignRequestKey } from './pending-requests';
