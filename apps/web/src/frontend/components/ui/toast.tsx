import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Tone } from './status-dot';

/**
 * Transient messages. Replaces the in-page notice bar: a message about an
 * action no longer pushes the page down, and several can queue.
 *
 * The store lives outside React so the dashboard's imperative action layer can
 * announce a result from anywhere without holding a component reference. The
 * live region keeps the id `notice` — it is the dashboard's announced-message
 * surface, and journeys read it there.
 */
export type Toast = { id: number; message: string; tone: Tone };

const listeners = new Set<(toasts: Toast[]) => void>();
let toasts: Toast[] = [];
let nextId = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
/** Matches the previous notice lifetime; long enough to read a failure reason. */
const LIFETIME_MS = 10_000;

function publish() {
  for (const listener of listeners) listener(toasts);
}

export function dismissToast(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  toasts = toasts.filter((toast) => toast.id !== id);
  publish();
}

/** Announce a result. Repeating the standing message is a no-op, so a polling failure cannot stack. */
export function toast(message: string, tone: Tone = 'neutral') {
  if (!message) return;
  if (toasts.some((item) => item.message === message)) return;
  const id = nextId++;
  toasts = [...toasts, { id, message, tone }];
  timers.set(
    id,
    setTimeout(() => dismissToast(id), LIFETIME_MS),
  );
  publish();
}

/** Clears every message; used when a session ends so nothing leaks into the next one. */
export function clearToasts() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  toasts = [];
  publish();
}

const toneStyles: Record<Tone, string> = {
  neutral: 'border-[var(--border-strong)]',
  info: 'border-[var(--border-strong)]',
  success: 'border-[var(--success-border)]',
  warning: 'border-[var(--warning-border)]',
  danger: 'border-[var(--danger-border)]',
};

export function Toaster() {
  const [items, setItems] = React.useState<Toast[]>(toasts);
  React.useEffect(() => {
    listeners.add(setItems);
    setItems(toasts);
    return () => {
      listeners.delete(setItems);
    };
  }, []);
  return (
    <div
      id="notice"
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
      hidden={!items.length}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-lg border bg-[var(--surface-raised)] py-2 pl-3 pr-1.5 shadow-[var(--shadow-md)]',
            toneStyles[item.tone],
          )}
        >
          <p className="flex-1 py-0.5 text-[13px] leading-snug text-[var(--foreground-secondary)]">
            {item.message}
          </p>
          <button
            type="button"
            aria-label="Dismiss message"
            className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--foreground-muted)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--primary)]"
            onClick={() => dismissToast(item.id)}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
