import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Field: caption + control inside a real <label>, with any <small> hint rendered
 * beside it so the hint is visible but never part of the control's accessible name.
 */
const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, children, ...props }, ref) => {
    const hints: React.ReactNode[] = [];
    const content: React.ReactNode[] = [];
    for (const child of React.Children.toArray(children))
      if (React.isValidElement(child) && child.type === 'small') hints.push(child);
      else content.push(child);
    return (
      <div className={cn('field', className)}>
        <label ref={ref} {...props}>
          {content}
        </label>
        {hints}
      </div>
    );
  },
);
Label.displayName = 'Label';
export { Label };
