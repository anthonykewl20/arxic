import { useCallback, useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button, Input, Label, Note, StatusDot, toast, confirmAction } from './components';
import { credentialRequest, credentialStatus, type CredentialInventory } from './credentials';

/**
 * Sign-in details, set from inside the project that needs them.
 *
 * A project declares WHICH reference it signs in with; until now the value had
 * to be typed on a different screen, so connecting a site behind a login meant
 * leaving the dialog half-finished, going to Settings, and coming back. The
 * vault is the same one — same endpoint, same write-only contract — it is just
 * reachable from where the question is asked.
 *
 * The references are read live from the form fields beside this component, so
 * renaming a reference and filling it in is one continuous action.
 */
export function ProjectCredentials({ refs }: { refs: string[] }) {
  const [inventory, setInventory] = useState<CredentialInventory>();
  const [editing, setEditing] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const wanted = [...new Set(refs.map((ref) => ref.trim()).filter(Boolean))];

  const load = useCallback(async () => {
    try {
      setInventory(await credentialRequest('GET'));
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function apply(action: () => Promise<CredentialInventory>, message: string) {
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

  const statusOf = (ref: string) =>
    inventory?.credentials.find((item) => item.ref === ref)?.status ?? 'missing';

  if (!wanted.length)
    return (
      <p className="muted">
        Name the two references above and you can set their values here without leaving this dialog.
      </p>
    );
  return (
    <div className="form-stack" data-project-credentials>
      {error && (
        <p role="alert" className="text-[13px] text-[var(--danger)]">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {wanted.map((ref) => {
          const status = credentialStatus[statusOf(ref)];
          return (
            <li key={ref} className="flex flex-wrap items-center gap-2">
              <KeyRound size={14} aria-hidden="true" />
              <code className="text-[12px]">{ref}</code>
              <StatusDot tone={status.tone}>{status.label}</StatusDot>
              <span className="ml-auto flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  data-set-secret={ref}
                  onClick={() => {
                    setEditing(editing === ref ? '' : ref);
                    setValue('');
                  }}
                >
                  {statusOf(ref) === 'missing' ? 'Set value' : 'Replace'}
                </Button>
                {statusOf(ref) === 'vault' && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-button"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await confirmAction({
                          title: `Remove ${ref}?`,
                          body: 'Runs that sign in with this reference will report the credential as missing until you set it again.',
                          confirmLabel: 'Remove credential',
                          destructive: true,
                        })
                      )
                        await apply(
                          () => credentialRequest('DELETE', { ref }),
                          'Credential removed.',
                        );
                    }}
                  >
                    Remove
                  </Button>
                )}
              </span>
              {editing === ref && (
                <div className="flex w-full flex-wrap items-end gap-2">
                  <Label className="min-w-[240px] flex-1">
                    Value for {ref}
                    <Input
                      type="password"
                      autoComplete="off"
                      value={value}
                      maxLength={5000}
                      onChange={(event) => setValue(event.target.value)}
                    />
                  </Label>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || !value}
                    onClick={() =>
                      void apply(
                        () => credentialRequest('POST', { ref, value }),
                        `Credential saved for ${ref}.`,
                      )
                    }
                  >
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
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Note>
        Values are encrypted on this server and never shown again — not here, not in a run record,
        not in a screenshot. A reference also set in the server environment wins over the value
        stored here.
      </Note>
    </div>
  );
}
