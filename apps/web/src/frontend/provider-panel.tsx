import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  RefreshCw,
  Search,
  ArrowUpRight,
  Plug,
  Bot,
  Check,
  AlertCircle,
  Terminal,
} from 'lucide-react';
import { Badge, Button, EmptyState, Input, Note } from './components';
import { actions } from './dashboard-actions';

type Connection = {
  id: string;
  label: string;
  transport: string;
  billing?: string;
  models: string[];
  catalog?: { status: string; fetchedAt: string | null; error: string | null };
  secret?: 'configured' | 'missing' | 'none';
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
  onConnectSecret: (id: string, value: string) => Promise<void>;
  onDisconnectSecret: (id: string) => Promise<void>;
};
function ProviderPanel({
  connections,
  setup,
  onRefresh,
  onConnectSecret,
  onDisconnectSecret,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [keyValue, setKeyValue] = useState('');
  const [keyPending, setKeyPending] = useState(false);
  const [keyError, setKeyError] = useState('');
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
        {/* Wraps: at 200% text on a phone the count and the button do not fit
            on one line, and a row that refuses to wrap widens the document. */}
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="outline">{available.length} connections</Badge>
          {/* Connecting an agent used to be a button in the top bar of every
              screen. It is a once-per-workspace setup task, so it lives where
              the models it configures do. */}
          <Button
            id="connect-agent"
            variant="outline"
            size="sm"
            onClick={() => actions().connectAgent()}
          >
            <Bot /> Connect agent
          </Button>
        </span>
      </div>
      <div className="provider-layout">
        <nav className="provider-list" aria-label="Model providers">
          <div className="provider-list-label">Connections</div>
          {available.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`provider-row ${active?.id === item.id ? 'is-selected' : ''}`}
              aria-pressed={active?.id === item.id}
              onClick={() => {
                setSelected(item.id);
                setQuery('');
                setKeyValue('');
                setKeyError('');
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
                <p className="provider-kicker">Model connection</p>
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
            {(active.secret === 'missing' || active.secret === 'configured') && (
              <div className="provider-secret">
                {active.secret === 'missing' ? (
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const value = keyValue.trim();
                      if (!value || keyPending) return;
                      setKeyPending(true);
                      setKeyError('');
                      try {
                        await onConnectSecret(active.id, value);
                        setKeyValue('');
                        await refresh(active.id);
                      } catch (failure) {
                        setKeyError(
                          failure instanceof Error && failure.message
                            ? failure.message
                            : 'Could not save the key on this server.',
                        );
                      } finally {
                        setKeyPending(false);
                      }
                    }}
                  >
                    <label htmlFor="provider-secret-input">API key or token</label>
                    <div className="provider-secret-row">
                      <Input
                        id="provider-secret-input"
                        type="password"
                        autoComplete="off"
                        placeholder="Paste the key from your provider"
                        value={keyValue}
                        onChange={(event) => setKeyValue(event.target.value)}
                      />
                      <Button type="submit" disabled={keyPending || !keyValue.trim()}>
                        {keyPending ? 'Connecting' : 'Connect key'}
                      </Button>
                    </div>
                    {keyError && (
                      <p className="provider-secret-error" role="alert">
                        {keyError}
                      </p>
                    )}
                    <p className="provider-secret-hint">
                      Stored on this server only. The value is never displayed again after saving.
                    </p>
                  </form>
                ) : (
                  <div className="provider-secret-row">
                    <span className="provider-secret-state">
                      <Check size={14} /> Credential connected on this server
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={keyPending}
                      onClick={async () => {
                        setKeyPending(true);
                        setKeyError('');
                        try {
                          await onDisconnectSecret(active.id);
                        } catch (failure) {
                          setKeyError(
                            failure instanceof Error && failure.message
                              ? failure.message
                              : 'Could not remove the key on this server.',
                          );
                        } finally {
                          setKeyPending(false);
                        }
                      }}
                    >
                      {keyPending ? 'Removing' : 'Remove credential'}
                    </Button>
                  </div>
                )}
                {keyError && active.secret === 'configured' && (
                  <p className="provider-secret-error" role="alert">
                    {keyError}
                  </p>
                )}
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
            <div
              className="provider-model-list"
              role="region"
              aria-label="Provider model catalog"
              tabIndex={0}
            >
              {active.models
                .filter((id) => id.toLowerCase().includes(query.toLowerCase()))
                .map((id) => (
                  <div className="provider-model-row" key={id}>
                    <code>{id}</code>
                    <Badge variant="outline">Provider catalog</Badge>
                  </div>
                ))}
              {active.models.length === 0 && (
                <EmptyState
                  icon={Plug}
                  title={
                    active.catalog?.error
                      ? 'Connection needs attention'
                      : 'Discover this provider’s models'
                  }
                >
                  Refresh the catalog after connecting your account on this server. Custom model IDs
                  are available in project and review settings.
                </EmptyState>
              )}
            </div>
            <Note>
              Catalogs refresh every five minutes while in use. Access and usage limits are
              controlled by your provider; a listed model does not guarantee account entitlement.
            </Note>
          </div>
        ) : (
          <EmptyState icon={Plug} title="No provider connections configured">
            Connect a subscription or an API key to discover the models it offers.
          </EmptyState>
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
