import * as React from 'react';
import { X } from 'lucide-react';
import { Button } from './button';
import { Stepper } from './stepper';

/** Header for a native <dialog>: title, subtitle, optional stepper and a close control. */
export function DialogHeading({
  title,
  subtitle,
  steps,
  onClose,
  closeId,
  closeLabel = 'Close',
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  steps?: { total: number; current: number };
  onClose: () => void;
  closeId?: string;
  closeLabel?: string;
}) {
  return (
    <div className="dialog-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <small>{subtitle}</small>}
      </div>
      {steps && <Stepper total={steps.total} current={steps.current} />}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        id={closeId}
        aria-label={closeLabel}
        onClick={onClose}
      >
        <X />
      </Button>
    </div>
  );
}
export function DialogBody(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div className="dialog-body" {...props} />;
}
export function DialogFooter(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div className="dialog-footer" {...props} />;
}
