import * as React from 'react';
import { Button } from './button';
import { trapDialogTab } from '../../dialog-focus';

/**
 * Confirmation for actions that cannot be undone. Replaces window.confirm so a
 * destructive prompt can name what is being deleted, say what survives, and
 * carry the product's own typography and focus behaviour.
 *
 * Imperative like the browser primitive it replaces — `await confirmAction(...)`
 * — so the dashboard's action layer reads the same as before.
 */
type Request = {
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  resolve: (confirmed: boolean) => void;
};

let request: Request | undefined;
let notify: (() => void) | undefined;

export function confirmAction(options: Omit<Request, 'resolve'>): Promise<boolean> {
  // No host mounted (a bare unit-test DOM): refuse rather than act unconfirmed.
  if (!notify) return Promise.resolve(false);
  return new Promise((resolve) => {
    request = { ...options, resolve };
    notify?.();
  });
}

export function ConfirmHost() {
  const [current, setCurrent] = React.useState<Request | undefined>();
  const dialog = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    notify = () => setCurrent(request);
    return () => {
      notify = undefined;
    };
  }, []);
  React.useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (current && !element.open) element.showModal();
    if (!current && element.open) element.close();
  }, [current]);

  const settle = (confirmed: boolean) => {
    current?.resolve(confirmed);
    request = undefined;
    setCurrent(undefined);
  };

  return (
    <dialog
      ref={dialog}
      id="confirm-dialog"
      aria-labelledby="confirm-dialog-title"
      className="confirm-dialog"
      onKeyDown={(event) => trapDialogTab(event, dialog.current)}
      onCancel={(event) => {
        event.preventDefault();
        settle(false);
      }}
    >
      {current && (
        <div className="flex w-full flex-col gap-3 p-4">
          <h2
            id="confirm-dialog-title"
            className="text-[15px] font-semibold text-[var(--foreground)]"
          >
            {current.title}
          </h2>
          {current.body && (
            <div className="text-[13px] leading-relaxed text-[var(--foreground-muted)]">
              {current.body}
            </div>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => settle(false)}>
              Cancel
            </Button>
            {/* The action being confirmed is the dialog's primary action, so it
                carries a solid fill — the shared `destructive` variant is a
                soft row-level treatment and would read weaker than Cancel.
                --surface as the label keeps it legible in both themes: white on
                deep red in light, near-black on soft red in dark. */}
            <Button
              size="sm"
              autoFocus
              className={
                current.destructive
                  ? 'bg-[var(--danger)] text-[var(--surface)] hover:opacity-90'
                  : undefined
              }
              onClick={() => settle(true)}
            >
              {current.confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
