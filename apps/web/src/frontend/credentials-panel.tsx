import { useEffect, useState } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import {
  credentialRequest as request,
  credentialStatus as statusLabels,
  type Credential,
  type CredentialInventory as Inventory,
} from './credentials';
import {
  Button,
  DataTable,
  EmptyState,
  Input,
  Label,
  Note,
  Section,
  StatusDot,
  toast,
  confirmAction,
  type Column,
} from './components';

/**
 * The sign-in identities visual runs use to reach authorized pages.
 *
 * Write-only by construction: a value can be replaced or removed but never read
 * back, and the server sends only reference names and whether each resolves. A
 * project declares WHICH reference it signs in with, and can now set the value
 * from its own settings dialog; this screen is the whole workspace at once —
 * every reference anything uses, including ones no project claims any more.
 */
export function CredentialsPanel() {
  const [inventory, setInventory] = useState<Inventory>();
  const [error, setError] = useState('');
  const [editing, setEditing] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    request('GET')
      .then((data) => live && setInventory(data))
      .catch((failure) => live && setError((failure as Error).message));
    return () => {
      live = false;
    };
  }, []);

  async function apply(action: () => Promise<Inventory>, message: string) {
    setBusy(true);
    setError('');
    try {
      setInventory(await action());
      setEditing('');
      setValue('');
      toast(message, 'success');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const columns: ReadonlyArray<Column<Credential>> = [
    {
      key: 'ref',
      header: 'Reference',
      width: '32%',
      cell: (item) => <code className="text-[12px] text-[var(--foreground)]">{item.ref}</code>,
    },
    {
      key: 'uses',
      header: 'Used by',
      width: '34%',
      truncate: true,
      cell: (item) => <span title={item.uses.join('\n')}>{item.uses.join(', ')}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (item) => (
        <StatusDot tone={statusLabels[item.status].tone}>
          {statusLabels[item.status].label}
        </StatusDot>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      bare: true,
      cell: (item) => (
        <span className="flex justify-end gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              setEditing(editing === item.ref ? '' : item.ref);
              setValue('');
            }}
          >
            {item.status === 'missing' ? 'Set value' : 'Replace'}
          </Button>
          {item.status === 'vault' && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${item.ref}`}
              disabled={busy}
              onClick={async () => {
                if (
                  await confirmAction({
                    title: `Remove ${item.ref}?`,
                    body: 'Runs that sign in with this reference will report the credential as missing until you set it again.',
                    confirmLabel: 'Remove credential',
                    destructive: true,
                  })
                )
                  await apply(() => request('DELETE', { ref: item.ref }), 'Credential removed.');
              }}
            >
              <Trash2 />
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <Section
      title="Sign-in credentials"
      meta={inventory ? `${inventory.credentials.length} referenced` : undefined}
    >
      {error && (
        <p role="alert" className="text-[13px] text-[var(--danger)]">
          {error}
        </p>
      )}
      <DataTable
        caption="Sign-in credentials referenced by this workspace"
        columns={columns}
        rows={inventory?.credentials ?? []}
        rowKey={(item) => item.ref}
        loading={!inventory && !error}
        empty={
          <EmptyState icon={KeyRound} title="No credentials referenced yet">
            A project that signs in declares an <code>ARXIC_SECRET_</code> reference for its email
            and password in project settings. Those references appear here for you to fill in.
          </EmptyState>
        }
      />
      {editing && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void apply(
              () => request('POST', { ref: editing, value }),
              `Credential saved for ${editing}.`,
            );
          }}
        >
          <Label className="min-w-[280px] flex-1">
            Value for {editing}
            <Input
              type="password"
              autoComplete="off"
              value={value}
              required
              maxLength={5000}
              onChange={(event) => setValue(event.target.value)}
            />
            <small>Stored encrypted on this server. It is never shown again.</small>
          </Label>
          <Button type="submit" size="sm" disabled={busy || !value}>
            Save credential
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setEditing('');
              setValue('');
            }}
          >
            Cancel
          </Button>
        </form>
      )}
      {inventory && inventory.orphaned.length > 0 && (
        <Note>
          Stored but no longer referenced by any project or campaign:{' '}
          {inventory.orphaned.map((ref) => (
            <code key={ref}>{ref} </code>
          ))}
          Provider keys from Models &amp; accounts also appear here.
        </Note>
      )}
      <Note>
        Values are encrypted at rest with AES-256-GCM and are only ever handed to a run&rsquo;s
        launch environment — they never reach this browser, a run record, the action timeline or a
        screenshot. That protects a copied database file, not this host: anyone who can read this
        server&rsquo;s memory or its key can still recover them.{' '}
        {inventory?.keySource === 'environment'
          ? 'The encryption key comes from ARXIC_VAULT_KEY in the server environment.'
          : `No ARXIC_VAULT_KEY is set, so the key is kept beside the database${inventory?.keyPath ? ` at ${inventory.keyPath}` : ''}. Set ARXIC_VAULT_KEY to hold it yourself.`}{' '}
        A reference also set in the server environment takes precedence over the value stored here.
      </Note>
    </Section>
  );
}
