import * as React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';

export type MenuItem = {
  label: React.ReactNode;
  onSelect: () => void;
  icon?: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  /** Renders the item in the danger tone. Destructive items still confirm before acting. */
  destructive?: boolean;
  disabled?: boolean;
};

/**
 * Overflow menu for row and card actions. Exists so a row offers one visible
 * action instead of three competing buttons.
 *
 * Built on a native button plus a positioned list rather than a headless
 * dependency: the roving-focus, Escape and click-outside behaviour below is the
 * whole contract, and the product ships no other menu shape.
 */
export function Menu({
  label,
  items,
  trigger,
  align = 'end',
}: {
  /** Accessible name for the trigger, e.g. "Actions for Acme Storefront". */
  label: string;
  items: readonly MenuItem[];
  trigger?: React.ReactNode;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const container = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  React.useEffect(() => {
    if (!open) return;
    itemRefs.current[active]?.focus();
  }, [open, active]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  const enabled = items.filter((item) => !item.disabled);
  const step = (delta: number) => {
    if (!enabled.length) return;
    let next = active;
    for (let i = 0; i < items.length; i++) {
      next = (next + delta + items.length) % items.length;
      if (!items[next]?.disabled) break;
    }
    setActive(next);
  };

  return (
    <div className="relative inline-flex" ref={container}>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setActive(items.findIndex((item) => !item.disabled));
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          setActive(
            event.key === 'ArrowDown'
              ? items.findIndex((item) => !item.disabled)
              : items.length - 1 - [...items].reverse().findIndex((item) => !item.disabled),
          );
          setOpen(true);
        }}
      >
        {trigger ?? <MoreHorizontal />}
      </Button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            'absolute top-full z-30 mt-1 min-w-[184px] rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-1 shadow-[var(--shadow-md)]',
            align === 'end' ? 'right-0' : 'left-0',
          )}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              step(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              step(-1);
            } else if (event.key === 'Tab') {
              close(false);
            }
          }}
        >
          {items.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={index}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                tabIndex={index === active ? 0 : -1}
                className={cn(
                  'flex w-full min-h-8 items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors duration-[var(--duration-fast)]',
                  'hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--primary)]',
                  'disabled:pointer-events-none disabled:opacity-50',
                  item.destructive ? 'text-[var(--danger)]' : 'text-[var(--foreground-secondary)]',
                )}
                onFocus={() => setActive(index)}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
              >
                {Icon && <Icon size={14} aria-hidden />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
