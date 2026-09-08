import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ArrowUpRight, Copy, RefreshCw } from 'lucide-react';
import { Button, Callout, DialogBody, DialogFooter, DialogHeading, StatusDot } from './components';
import type { ModelConnection, RefreshModels } from './model-controls';
import { time } from './display';

type Setup = {
  id: string;
  name: string;
  method: string;
  command?: string;
  url: string;
  detail: string;
};
export type AgentWizardProps = {
  connections: ModelConnection[];
  setup: Setup[];
  onRefresh: RefreshModels;
  onClose: () => void;
  onOpenProviders: () => void;
};
type Health = { tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info'; label: string };
export function connectionHealth(item: ModelConnection): Health {
  if (item.secret === 'missing') return { tone: 'warning', label: 'Server secret missing' };
  const status = item.catalog.status;
  if (status === 'ready' && item.models.length) return { tone: 'success', label: 'Connected' };
  if (status === 'ready') return { tone: 'success', label: 'Connected · no catalog' };
  if (status === 'refreshing') return { tone: 'info', label: 'Checking…' };
  if (status === 'error') return { tone: 'danger', label: 'Needs attention' };
  if (status === 'unavailable') return { tone: 'neutral', label: 'Manual model IDs' };
  return { tone: 'neutral', label: 'Not connected' };
}
const kind = (item: ModelConnection) =>
  item.billing === 'subscription'
    ? 'Subscription account'
    : item.transport === 'host-cli'
      ? 'Coding agent on this server'
      : 'API connection';

function AgentWizard({
  connections,
  setup,
  onRefresh,
  onClose,
  onOpenProviders,
}: AgentWizardProps) {
  const candidates = connections.filter((item) => item.id);
  const [selected, setSelected] = useState('');
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [copied, setCopied] = useState(false);
  const active = candidates.find((item) => item.id === selected);
  const guide = setup.find((item) => item.id === selected);
  if (!active)
    return (
      <>
        <DialogHeading
          title="Connect an AI agent"
          subtitle="Step 1 of 2 · Choose the account you already have"
          steps={{ total: 2, current: 1 }}
          onClose={onClose}
          closeId="close-agent-dialog"
        />
        <DialogBody>
          {candidates.length === 0 && (
            <Callout tone="warning" title="No provider connections are configured">
              Set ARXIC_MODEL_CONNECTIONS on the server or leave it unset for the built-in accounts.
            </Callout>
          )}
          <div className="form-stack" role="group" aria-label="AI agent accounts">
            {candidates.map((item) => {
              const health = connectionHealth(item);
              return (
                <button
                  type="button"
                  key={item.id}
                  className="choice choice-row"
                  aria-pressed={false}
                  onClick={() => {
                    setSelected(item.id);
                    setChecked(false);
                  }}
                >
                  <span className="avatar" aria-hidden="true">
                    {item.label.slice(0, 1)}
                  </span>
                  <span className="copy">
                    <strong>{item.label}</strong>
                    <small>
                      {item.secret === 'none' ? kind(item) : `${kind(item)} · server secret`}
                    </small>
                  </span>
                  <StatusDot tone={health.tone}>{health.label}</StatusDot>
                </button>
              );
            })}
          </div>
        </DialogBody>
        <DialogFooter>
          <small>Credentials never pass through the browser.</small>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </>
    );
  const health = connectionHealth(active);
  const check = async () => {
    setChecking(true);
    try {
      await onRefresh(active.id);
      setChecked(true);
    } finally {
      setChecking(false);
    }
  };
  const copy = async () => {
    if (!guide?.command) return;
    try {
      await navigator.clipboard.writeText(guide.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; the command stays visible */
    }
  };
  return (
    <>
      <DialogHeading
        title={`Connect ${guide?.name ?? active.label}`}
        subtitle="Step 2 of 2 · Sign in on the server, then verify"
        steps={{ total: 2, current: 2 }}
        onClose={onClose}
        closeId="close-agent-dialog"
      />
      <DialogBody>
        <div className="steps">
          <div className="step">
            <span className="step-number">1</span>
            <div className="step-body">
              <strong>
                {guide?.command
                  ? 'Run this on the Arxic server as the user that runs Arxic'
                  : active.secret !== 'none'
                    ? 'Connect this provider’s key under Models & accounts, or set its ARXIC_SECRET_ variable in the server environment'
                    : (guide?.method ?? 'Configure the account on the server')}
              </strong>
              {guide?.command && (
                <div className="command">
                  <span className="prompt" aria-hidden="true">
                    $
                  </span>
                  <code>{guide.command}</code>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void copy()}>
                    <Copy /> {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              )}
              {guide && <small>{guide.detail}</small>}
              {guide && (
                <a
                  href={guide.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs inline-flex items-center gap-1"
                >
                  Provider guide <ArrowUpRight size={12} aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
          <div className="step">
            <span className="step-number" data-done={checked}>
              2
            </span>
            <div className="step-body">
              <strong>Verify the connection</strong>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={checking}
                  onClick={() => void check()}
                >
                  <RefreshCw className={checking ? 'animate-spin' : ''} /> Check now
                </Button>
                <StatusDot tone={health.tone}>
                  {health.label}
                  {health.tone === 'success' && active.models.length
                    ? ` · ${active.models.length} models found`
                    : ''}
                </StatusDot>
              </div>
              {active.catalog.error && checked && (
                <Callout tone="danger">{active.catalog.error}</Callout>
              )}
              {active.catalog.fetchedAt && (
                <small>Last checked {time(active.catalog.fetchedAt)}</small>
              )}
            </div>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => setSelected('')}>
          Back
        </Button>
        <small>Models are chosen per project and per review.</small>
        <Button type="button" variant="ghost" onClick={onOpenProviders}>
          Browse models
        </Button>
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
const roots = new WeakMap<Element, Root>();
export function mountAgentWizard(element: Element, props: AgentWizardProps) {
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }
  flushSync(() => root!.render(<AgentWizard {...props} />));
}
export function unmountAgentWizard(element: Element) {
  roots.get(element)?.unmount();
  roots.delete(element);
}
