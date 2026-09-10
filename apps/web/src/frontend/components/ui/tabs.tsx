import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Tabs for sibling views of one subject. Used where a screen previously stacked
 * every section onto a single scroll: the operator picks the section instead of
 * scrolling past the others.
 *
 * Manual activation (Enter/Space, not arrow focus) so moving through tabs with
 * the keyboard never triggers a data fetch the operator did not ask for.
 */
export type TabItem = { id: string; label: React.ReactNode; count?: number };

export function Tabs({
  items,
  value,
  onValueChange,
  label,
  className,
}: {
  items: readonly TabItem[];
  value: string;
  onValueChange: (id: string) => void;
  /** Accessible name for the tab list. */
  label: string;
  className?: string;
}) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(
    0,
    items.findIndex((item) => item.id === value),
  );
  const move = (delta: number) => {
    const next = (index + delta + items.length) % items.length;
    refs.current[next]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('flex flex-wrap items-center gap-1 border-b border-[var(--border)]', className)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          move(-1);
        } else if (event.key === 'Home') {
          event.preventDefault();
          refs.current[0]?.focus();
        } else if (event.key === 'End') {
          event.preventDefault();
          refs.current[items.length - 1]?.focus();
        }
      }}
    >
      {items.map((item, position) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(node) => {
              refs.current[position] = node;
            }}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`tabpanel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            className={cn(
              'relative -mb-px flex min-h-8 items-center gap-1.5 border-b-2 px-2.5 py-1 text-[13px] transition-colors duration-[var(--duration-fast)]',
              'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--primary)]',
              selected
                ? 'border-[var(--primary)] font-medium text-[var(--foreground)]'
                : 'border-transparent text-[var(--foreground-muted)] hover:text-[var(--foreground)]',
            )}
            onClick={() => onValueChange(item.id)}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="tabular-nums text-[11px] text-[var(--foreground-muted)]">
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  id,
  value,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { id: string; value: string }) {
  if (id !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${id}`}
      aria-labelledby={`tab-${id}`}
      tabIndex={0}
      className={cn('flex flex-col gap-4 focus-visible:outline-none', className)}
      {...props}
    />
  );
}
