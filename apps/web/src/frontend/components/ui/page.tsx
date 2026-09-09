import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Page scaffolding. Every screen is a stack of `Section`s; a section owns its
 * heading, its optional right-hand meta, and its spacing. Screens never set
 * their own margins, so vertical rhythm cannot drift between views.
 */
export function Section({
  title,
  meta,
  description,
  actions,
  className,
  children,
  ...props
}: Omit<React.HTMLAttributes<HTMLElement>, 'title'> & {
  title?: React.ReactNode;
  /** Quiet right-aligned count or timestamp. */
  meta?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className={cn('section flex flex-col gap-3', className)} {...props}>
      {(title || meta || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {title && (
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
              {title}
            </h2>
          )}
          <div className="flex items-center gap-2">
            {meta && <span className="text-[12px] text-[var(--foreground-muted)]">{meta}</span>}
            {actions}
          </div>
        </div>
      )}
      {description && (
        <p className="max-w-[var(--measure)] text-[13px] text-[var(--foreground-muted)]">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

/**
 * The invitation shown in place of an absent collection. Always names the next
 * action; an empty screen is never a dead end.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> & {
  icon?: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  title: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'empty flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--border-strong)] px-6 py-10 text-center',
        className,
      )}
      {...props}
    >
      {Icon && (
        <span className="text-[var(--foreground-muted)]">
          <Icon size={20} aria-hidden />
        </span>
      )}
      <h2 className="text-[14px] font-semibold text-[var(--foreground)]">{title}</h2>
      {children && (
        <div className="max-w-[46ch] text-[13px] text-[var(--foreground-muted)]">{children}</div>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/**
 * A standing caveat about what the product does and does not prove. Quiet by
 * design: it must stay readable without competing with the data above it.
 */
export function Note({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'scope-note rounded-md border-l-2 border-[var(--border-strong)] bg-[var(--surface-muted)] px-3 py-2 text-[12px] leading-relaxed text-[var(--foreground-muted)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** A labelled figure. Reads as one number with its meaning, never a bare digit. */
export function Stat({
  label,
  value,
  caption,
  tone,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
  label: React.ReactNode;
  value: React.ReactNode;
  caption?: React.ReactNode;
  /** Draws the figure in the accent colour when the number is the thing to act on. */
  tone?: 'default' | 'attention';
}) {
  return (
    <div className="stat flex flex-col gap-0.5" {...props}>
      <span className="text-[12px] text-[var(--foreground-muted)]">{label}</span>
      <strong
        className={cn(
          'text-[22px] font-semibold tabular-nums tracking-[-0.02em]',
          tone === 'attention' ? 'text-[var(--primary)]' : 'text-[var(--foreground)]',
        )}
      >
        {value}
      </strong>
      {caption && <small className="text-[11px] text-[var(--foreground-muted)]">{caption}</small>}
    </div>
  );
}
