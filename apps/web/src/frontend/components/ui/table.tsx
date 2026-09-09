import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * The one table in the product. Every tabular surface composes these parts or
 * the column-driven `DataTable` below; no screen writes its own grid.
 *
 * Two rules the primitive owns so no caller repeats them:
 *  - the scroll container, not the document, absorbs a wide table (the
 *    dashboard audit fails on any horizontal document overflow);
 *  - numeric and identifier cells get tabular figures so columns align.
 */
export function TableScroll({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'w-full overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]',
        className,
      )}
      {...props}
    />
  );
}

export const Table = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <table
    ref={ref}
    className={cn('w-full border-collapse text-left text-[13px]', className)}
    {...props}
  />
));
Table.displayName = 'Table';

export const TableHead = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn('[&_th]:border-b [&_th]:border-[var(--border)]', className)}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn(
      '[&_tr:not(:last-child)_td]:border-b [&_td]:border-[var(--border-subtle)]',
      className,
    )}
    {...props}
  />
));
TableBody.displayName = 'TableBody';

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn('transition-colors duration-[var(--duration-fast)]', className)}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

/** Column header. Sentence case, muted, never all-caps. */
export const TableHeader = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }
>(({ className, numeric, ...props }, ref) => (
  <th
    ref={ref}
    scope="col"
    className={cn(
      'h-9 px-3 align-middle text-[12px] font-medium text-[var(--foreground-muted)] whitespace-nowrap',
      numeric && 'text-right',
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = 'TableHeader';

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }
>(({ className, numeric, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'px-3 py-2 align-middle text-[var(--foreground-secondary)]',
      numeric && 'text-right tabular-nums',
      className,
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

export type Column<T> = {
  /** Stable identity; also the responsive stacked-row label key. */
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Right-aligned tabular figures for counts, sizes and durations. */
  numeric?: boolean;
  /** A CSS table width — a percentage or a fixed track, e.g. '34%' or '120px'. */
  width?: string;
  /**
   * Clip overflowing text to one ellipsised line instead of wrapping. Needs the
   * `max-width: 0` idiom below: on a full-width table the browser distributes
   * the declared percentages, and the zero max-width lets the cell actually clip.
   */
  truncate?: boolean;
  /** Kept out of the stacked layout's label column (actions, checkboxes). */
  bare?: boolean;
};

/**
 * Column-driven table with the empty and loading states built in, so a screen
 * declares its columns and never its markup. Below 720px each row stacks and
 * every cell recovers its header as a label.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  loading,
  rowProps,
  className,
}: {
  columns: ReadonlyArray<Column<T>>;
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  /** Accessible name for the table. Rendered visually hidden. */
  caption: string;
  empty?: React.ReactNode;
  loading?: boolean;
  rowProps?: (row: T) => React.HTMLAttributes<HTMLTableRowElement>;
  className?: string;
}) {
  if (loading)
    return (
      <TableScroll className={className}>
        <p className="px-3 py-6 text-[13px] text-[var(--foreground-muted)]" role="status">
          Loading…
        </p>
      </TableScroll>
    );
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <TableScroll className={className}>
      <Table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableHeader
                key={column.key}
                numeric={column.numeric}
                style={column.width ? { width: column.width } : undefined}
              >
                {column.header}
              </TableHeader>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={rowKey(row, index)} {...rowProps?.(row)}>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  numeric={column.numeric}
                  className={
                    column.truncate
                      ? // Only while the table is a table. Below the stacking
                        // breakpoint the row has no column track to clip
                        // against, and a zero max-width would empty the cell.
                        'min-[761px]:max-w-0 min-[761px]:[&_*]:min-w-0 min-[761px]:[&_*]:truncate'
                      : undefined
                  }
                  data-label={column.bare ? undefined : String(column.header)}
                >
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScroll>
  );
}
