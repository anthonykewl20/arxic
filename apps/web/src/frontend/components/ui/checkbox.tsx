import * as React from 'react';
import { cn } from '../../lib/utils';

/** Native checkbox with its caption; keyboard and assistive tech behaviour stay browser-native. */
const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<'input'>, 'type'> & { label: React.ReactNode }
>(({ className, label, ...props }, ref) => (
  <label className={cn('checkbox', className)}>
    <input ref={ref} type="checkbox" {...props} />
    <span>{label}</span>
  </label>
));
Checkbox.displayName = 'Checkbox';
export { Checkbox };
