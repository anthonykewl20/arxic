import * as React from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle } from 'lucide-react';
import type { Tone } from './status-dot';

const icons = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};
/** Inline message block with a tone icon. */
export function Callout({
  tone = 'neutral',
  title,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: Tone; title?: React.ReactNode }) {
  const Icon = icons[tone];
  return (
    <div className="callout" data-tone={tone} {...props}>
      <Icon size={16} aria-hidden="true" />
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}
