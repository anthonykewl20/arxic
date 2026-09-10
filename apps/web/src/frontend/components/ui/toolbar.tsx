import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';
import { Input } from './input';
import { Select } from './select';

/** The filter strip above a collection. Wraps on narrow viewports; never scrolls the page sideways. */
export function Toolbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('toolbar flex flex-wrap items-center gap-2', className)} {...props} />;
}

/**
 * Search that submits on Enter and can be cleared in one click. Uncontrolled by
 * design: the dashboard re-renders on a 2.5s poll, and a controlled value would
 * fight the operator's typing.
 */
export function SearchField({
  id,
  label,
  placeholder,
  defaultValue = '',
  onSearch,
  className,
}: {
  id: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  onSearch: (value: string) => void;
  className?: string;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <form
      id={id}
      className={cn('search-form relative flex min-w-[200px] flex-1 items-center', className)}
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(input.current?.value.trim() ?? '');
        input.current?.blur();
      }}
    >
      <Search
        size={14}
        aria-hidden
        className="pointer-events-none absolute left-2.5 text-[var(--foreground-muted)]"
      />
      <Input
        ref={input}
        aria-label={label}
        name="query"
        defaultValue={defaultValue}
        placeholder={placeholder}
        maxLength={200}
        className="pl-8"
      />
      {defaultValue && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Clear ${label.toLowerCase()}`}
          className="absolute right-0.5 h-7 w-7"
          onClick={() => {
            if (input.current) input.current.value = '';
            onSearch('');
          }}
        >
          <X />
        </Button>
      )}
      <button type="submit" className="sr-only">
        Search
      </button>
    </form>
  );
}

/** Labelled `<select>` filter. The label is the accessible name; no visible caption. */
export function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id?: string;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      id={id}
      aria-label={label}
      value={value}
      className="w-auto min-w-[132px]"
      onChange={(event) => {
        event.stopPropagation();
        onChange(event.currentTarget.value);
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}

/**
 * Range readout plus previous/next. One implementation for every paged
 * collection, so the position wording never drifts between screens.
 */
export function Pagination({
  offset,
  count,
  total,
  unit,
  onPage,
  className,
}: {
  offset: number;
  /** Rows on the current page. */
  count: number;
  total: number;
  /** Plural noun for the readout, e.g. "runs". */
  unit: string;
  onPage: (direction: -1 | 1) => void;
  className?: string;
}) {
  const limit = count || 1;
  return (
    <div
      className={cn('pagination flex flex-wrap items-center justify-between gap-2', className)}
      role="navigation"
      aria-label={`${unit} pages`}
    >
      <small className="text-[12px] tabular-nums text-[var(--foreground-muted)]" role="status">
        {total ? `${offset + 1}–${Math.min(offset + count, total)} of ${total}` : '0'} {unit}
      </small>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={!offset} onClick={() => onPage(-1)}>
          Previous {unit}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={offset + limit >= total}
          onClick={() => onPage(1)}
        >
          Next {unit}
        </Button>
      </div>
    </div>
  );
}
