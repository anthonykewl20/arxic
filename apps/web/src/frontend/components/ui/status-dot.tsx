import * as React from 'react';
import { cn } from '../../lib/utils';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
/** Compact status: coloured dot plus text. Use for run states, connection health, schedules. */
export function StatusDot({
  tone = 'neutral',
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span className={cn('status-dot', className)} data-tone={tone} {...props}>
      {children}
    </span>
  );
}
export const toneOf = (value: string): Tone =>
  ['verified', 'unchanged', 'completed', 'active', 'ready'].includes(value)
    ? 'success'
    : ['changed', 'contradicted', 'error'].includes(value)
      ? 'warning'
      : ['blocked', 'cancelled', 'unstable'].includes(value)
        ? 'danger'
        : ['hypothesized', 'queued', 'running', 'refreshing'].includes(value)
          ? 'info'
          : 'neutral';
