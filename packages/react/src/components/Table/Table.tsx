import {
  forwardRef,
  useCallback,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Icon } from '../Icon';
import styles from './Table.module.css';

export type SortDirection = 'ascending' | 'descending' | 'none';

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Visible caption above the table. Also names the scroll region. */
  caption?: ReactNode;
  /** Accessible name when there is no visible caption, for example "Tokens changed in this pull request". */
  'aria-label'?: string;
  /** Keep the header row visible while the table scrolls inside its container. */
  stickyHeader?: boolean;
  /** Max height of the scroll container (CSS length from a token, for example var(--size-120)). Enables vertical scroll. */
  maxHeight?: string;
  /** Hairlines between columns as well as rows. Default `false`. */
  gridLines?: boolean;
}

/**
 * Semantic data table inside a focusable, labelled scroll region: on narrow screens it scrolls sideways
 * instead of squashing columns. Row height and cell padding follow the density tokens.
 */
export const Table = forwardRef<HTMLTableElement, TableProps>(function Table(
  { caption, stickyHeader = false, maxHeight, gridLines = false, className, children, 'aria-label': ariaLabel, ...rest },
  ref,
) {
  const regionLabel = ariaLabel ?? (typeof caption === 'string' ? caption : undefined);
  return (
    <div
      className={cx(styles.scroller, stickyHeader && styles.sticky)}
      role="region"
      aria-label={regionLabel}
      tabIndex={0}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table ref={ref} className={cx(styles.table, gridLines && styles.gridLines, className)} aria-label={caption ? undefined : ariaLabel} {...rest}>
        {caption != null && <caption className={styles.caption}>{caption}</caption>}
        {children}
      </table>
    </div>
  );
});

export const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(function TableHeader(
  { className, ...rest },
  ref,
) {
  return <thead ref={ref} className={cx(styles.thead, className)} {...rest} />;
});

export const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(function TableBody(
  { className, ...rest },
  ref,
) {
  return <tbody ref={ref} className={cx(styles.tbody, className)} {...rest} />;
});

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Selected row (selectable rows pattern): sets aria-selected and the selected fill. Pair with a Checkbox in the first cell. */
  selected?: boolean;
}

export const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(function TableRow({ selected, className, ...rest }, ref) {
  return (
    <tr
      ref={ref}
      className={cx(styles.row, className)}
      aria-selected={selected === undefined ? undefined : selected}
      data-selected={selected || undefined}
      {...rest}
    />
  );
});

export interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** Current sort of this column. Set it (even to `none`) to make the column sortable. */
  sortDirection?: SortDirection;
  /** Called when the sort button is pressed. */
  onSort?: () => void;
  /** Right-align numeric columns so digits line up. */
  numeric?: boolean;
}

export const TableHead = forwardRef<HTMLTableCellElement, TableHeadProps>(function TableHead(
  { sortDirection, onSort, numeric = false, scope = 'col', className, children, ...rest },
  ref,
) {
  const sortable = sortDirection !== undefined;
  const icon = sortDirection === 'ascending' ? ArrowUp : sortDirection === 'descending' ? ArrowDown : ChevronsUpDown;
  return (
    <th
      ref={ref}
      scope={scope}
      aria-sort={sortable && sortDirection !== 'none' ? sortDirection : undefined}
      className={cx(styles.head, numeric && styles.numeric, sortable && styles.sortable, className)}
      {...rest}
    >
      {sortable ? (
        <button type="button" className={styles.sortButton} onClick={onSort} data-sorted={sortDirection !== 'none' || undefined}>
          <span>{children}</span>
          <Icon icon={icon} size="xs" className={styles.sortIcon} />
        </button>
      ) : (
        children
      )}
    </th>
  );
});

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  /** Right-align and use tabular figures. */
  numeric?: boolean;
  /** Narrow cell holding a selection Checkbox. */
  select?: boolean;
}

export const TableCell = forwardRef<HTMLTableCellElement, TableCellProps>(function TableCell(
  { numeric = false, select = false, className, ...rest },
  ref,
) {
  return <td ref={ref} className={cx(styles.cell, numeric && styles.numeric, select && styles.select, className)} {...rest} />;
});

export interface TableEmptyProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Number of columns to span. */
  colSpan: number;
  children: ReactNode;
}

/** A full-width row for empty results. Put an EmptyState or one sentence with the next step inside. */
export const TableEmpty = forwardRef<HTMLTableRowElement, TableEmptyProps>(function TableEmpty({ colSpan, className, children, ...rest }, ref) {
  return (
    <tr ref={ref} className={cx(styles.emptyRow, className)} {...rest}>
      <td colSpan={colSpan} className={styles.empty}>
        {children}
      </td>
    </tr>
  );
});

/**
 * Sort state for a table: `headProps(key)` returns the props for a sortable TableHead. Each press cycles
 * ascending, descending, then back to unsorted.
 */
export function useTableSort<K extends string>(initial?: { key: K; direction: Exclude<SortDirection, 'none'> }) {
  const [sort, setSort] = useState<{ key: K; direction: Exclude<SortDirection, 'none'> } | null>(initial ?? null);
  const headProps = useCallback(
    (key: K): Pick<TableHeadProps, 'sortDirection' | 'onSort'> => ({
      sortDirection: sort?.key === key ? sort.direction : 'none',
      onSort: () =>
        setSort((prev) => {
          if (prev?.key !== key) return { key, direction: 'ascending' };
          if (prev.direction === 'ascending') return { key, direction: 'descending' };
          return null;
        }),
    }),
    [sort],
  );
  return { sort, setSort, headProps };
}
