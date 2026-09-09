import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Everything reachable from one keystroke. Opens on Ctrl+K / ⌘K, filters
 * sections, projects, runs and actions together, and runs the highlighted entry
 * on Enter — so any destination costs one shortcut and a few characters instead
 * of a traversal through the sidebar and a list.
 *
 * Combobox semantics over a native <dialog>: the input keeps focus and owns the
 * arrow keys, while `aria-activedescendant` moves the assistive-technology
 * cursor through the options.
 */
export type Command = {
  id: string;
  label: string;
  /** Heading this entry files under, e.g. "Projects". */
  group: string;
  /** Quiet right-hand detail: a project name, a run type, a shortcut. */
  hint?: string;
  /** Extra text matched by the filter but never displayed. */
  keywords?: string;
  icon?: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  run: () => void;
};

export function matchCommands(commands: readonly Command[], query: string): Command[] {
  const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (!terms.length) return [...commands];
  return commands.filter((command) => {
    const haystack =
      `${command.label} ${command.group} ${command.hint ?? ''} ${command.keywords ?? ''}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function CommandPalette({
  commands,
  open,
  onClose,
}: {
  commands: readonly Command[];
  open: boolean;
  onClose: () => void;
}) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const matches = React.useMemo(() => matchCommands(commands, query), [commands, query]);

  React.useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setQuery('');
      setActive(0);
      element.showModal();
      input.current?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  React.useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, query]);

  const choose = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  // Group headings are rendered once per run of same-group entries, so the list
  // stays flat for the keyboard while reading as sections.
  let previousGroup = '';
  return (
    <dialog
      ref={dialog}
      id="command-palette"
      aria-label="Command palette"
      className="command-palette"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="flex w-full flex-col overflow-hidden">
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls="command-palette-list"
          aria-activedescendant={matches[active] ? `command-${matches[active].id}` : undefined}
          aria-label="Search for a page, project, run or action"
          placeholder="Search for a page, project, run or action…"
          autoComplete="off"
          value={query}
          className="h-11 w-full border-b border-[var(--border)] bg-transparent px-4 text-[14px] text-[var(--foreground)] outline-none placeholder:text-[var(--foreground-muted)]"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => (matches.length ? (index + 1) % matches.length : 0));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) =>
                matches.length ? (index - 1 + matches.length) % matches.length : 0,
              );
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(matches[active]);
            }
          }}
        />
        <div
          ref={list}
          id="command-palette-list"
          role="listbox"
          aria-label="Results"
          className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5"
        >
          {matches.length === 0 && (
            <p className="px-2.5 py-6 text-center text-[13px] text-[var(--foreground-muted)]">
              Nothing matches “{query}”.
            </p>
          )}
          {matches.map((command, index) => {
            const Icon = command.icon;
            const heading = command.group !== previousGroup ? command.group : '';
            previousGroup = command.group;
            return (
              <React.Fragment key={command.id}>
                {heading && (
                  <div
                    role="presentation"
                    className="px-2.5 pb-1 pt-2.5 text-[11px] font-medium text-[var(--foreground-muted)]"
                  >
                    {heading}
                  </div>
                )}
                <div
                  id={`command-${command.id}`}
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active}
                  className={cn(
                    'flex min-h-8 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px]',
                    index === active
                      ? 'bg-[var(--surface-hover)] text-[var(--foreground)]'
                      : 'text-[var(--foreground-secondary)]',
                  )}
                  onPointerMove={() => setActive(index)}
                  onClick={() => choose(command)}
                >
                  {Icon && <Icon size={14} aria-hidden />}
                  <span className="flex-1 truncate">{command.label}</span>
                  {command.hint && (
                    <span className="shrink-0 text-[11px] text-[var(--foreground-muted)]">
                      {command.hint}
                    </span>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </dialog>
  );
}
