import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
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

/**
 * A column width. A string is a CSS length from the tokens (`var(--size-40)`) or a percentage of the table (`'30%'`);
 * a number between 0 and 1 is a fraction of the table width (`0.3` is 30%).
 */
export type TableColumnWidth = string | number;

/** How the table reads in a narrow container (a phone): `scroll` sideways (default) or `stack` each row as a card. */
export type TableNarrowLayout = 'scroll' | 'stack';

const TableContext = createContext<{ stack: boolean }>({ stack: false });

const widthValue = (w: TableColumnWidth | undefined) =>
  w === undefined ? undefined : typeof w === 'number' ? `${Math.round(w * 10000) / 100}%` : w;

/** Width custom properties for a head or cell (the CSS module applies them, and drops them when rows stack). */
function widthStyle(width: TableColumnWidth | undefined, minWidth: string | undefined, style: CSSProperties | undefined): CSSProperties | undefined {
  if (width === undefined && minWidth === undefined) return style;
  const vars: Record<string, string> = {};
  if (width !== undefined) vars['--_col-width'] = widthValue(width)!;
  if (minWidth !== undefined) vars['--_col-min-width'] = minWidth;
  return { ...(vars as CSSProperties), ...style };
}

interface ColumnWidthProps {
  /** Column width: a CSS length from the tokens, a percentage, or a fraction of the table (0.3). Set it on the header cell. */
  width?: TableColumnWidth;
  /** The column never gets narrower than this (a CSS length from the tokens). On a narrow screen the table scrolls instead. */
  minWidth?: string;
}

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
  /**
   * `auto` (default) sizes columns from their content and the widths you set. `fixed` follows the widths of the header
   * cells exactly and truncates nothing on its own: long words wrap. Use `fixed` when rows should not shift as data loads.
   */
  layout?: 'auto' | 'fixed';
  /**
   * In a container narrower than about 480px: `scroll` keeps the columns and scrolls sideways (default); `stack` shows
   * each row as a card, every value under its column name. Column names come from the header row, or from `label` on a cell.
   */
  narrowLayout?: TableNarrowLayout;
}

/**
 * Semantic data table inside a focusable, labelled scroll region: on narrow screens it scrolls sideways
 * instead of squashing columns. Row height and cell padding follow the density tokens.
 */
export const Table = forwardRef<HTMLTableElement, TableProps>(function Table(
  { caption, stickyHeader = false, maxHeight, gridLines = false, layout = 'auto', narrowLayout = 'scroll', className, children, 'aria-label': ariaLabel, ...rest },
  ref,
) {
  const regionLabel = ariaLabel ?? (typeof caption === 'string' ? caption : undefined);
  const stack = narrowLayout === 'stack';
  const scroller = useRef<HTMLDivElement>(null);
  // Stacked rows name each value with its column: copy the header text to cells that have no label of their own.
  useEffect(() => {
    const root = scroller.current;
    if (!stack || !root) return;
    const fill = () => {
      const heads = [...root.querySelectorAll<HTMLTableCellElement>('thead tr:last-child th')].map((th) => th.textContent?.trim() ?? '');
      root.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((tr) => {
        let col = 0;
        for (const cell of Array.from(tr.cells)) {
          const head = heads[col];
          if (!cell.hasAttribute('data-label') && head) cell.setAttribute('data-label', head);
          col += cell.colSpan || 1;
        }
      });
    };
    fill();
    const observer = new MutationObserver(fill);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [stack]);
  return (
    <div
      ref={scroller}
      className={cx(styles.scroller, stickyHeader && styles.sticky, stack && styles.stack)}
      role="region"
      aria-label={regionLabel}
      tabIndex={0}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table
        ref={ref}
        className={cx(styles.table, gridLines && styles.gridLines, layout === 'fixed' && styles.fixed, className)}
        aria-label={caption ? undefined : ariaLabel}
        role={stack ? 'table' : undefined}
        {...rest}
      >
        {caption != null && <caption className={styles.caption}>{caption}</caption>}
        <TableContext.Provider value={{ stack }}>{children}</TableContext.Provider>
      </table>
    </div>
  );
});

export const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(function TableHeader(
  { className, ...rest },
  ref,
) {
  const { stack } = useContext(TableContext);
  return <thead ref={ref} className={cx(styles.thead, className)} role={stack ? 'rowgroup' : undefined} {...rest} />;
});

export const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(function TableBody(
  { className, ...rest },
  ref,
) {
  const { stack } = useContext(TableContext);
  return <tbody ref={ref} className={cx(styles.tbody, className)} role={stack ? 'rowgroup' : undefined} {...rest} />;
});

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Selected row (selectable rows pattern): sets aria-selected and the selected fill. Pair with a Checkbox in the first cell. */
  selected?: boolean;
}

export const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(function TableRow({ selected, className, ...rest }, ref) {
  const { stack } = useContext(TableContext);
  return (
    <tr
      ref={ref}
      role={stack ? 'row' : undefined}
      className={cx(styles.row, className)}
      aria-selected={selected === undefined ? undefined : selected}
      data-selected={selected || undefined}
      {...rest}
    />
  );
});

export interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement>, ColumnWidthProps {
  /** Current sort of this column. Set it (even to `none`) to make the column sortable. */
  sortDirection?: SortDirection;
  /** Called when the sort button is pressed. */
  onSort?: () => void;
  /** Right-align numeric columns so digits line up. */
  numeric?: boolean;
}

export const TableHead = forwardRef<HTMLTableCellElement, TableHeadProps>(function TableHead(
  { sortDirection, onSort, numeric = false, scope = 'col', width, minWidth, style, className, children, ...rest },
  ref,
) {
  const { stack } = useContext(TableContext);
  const sortable = sortDirection !== undefined;
  const icon = sortDirection === 'ascending' ? ArrowUp : sortDirection === 'descending' ? ArrowDown : ChevronsUpDown;
  return (
    <th
      ref={ref}
      scope={scope}
      aria-sort={sortable && sortDirection !== 'none' ? sortDirection : undefined}
      className={cx(styles.head, numeric && styles.numeric, sortable && styles.sortable, className)}
      style={widthStyle(width, minWidth, style)}
      role={stack ? (scope === 'row' ? 'rowheader' : 'columnheader') : undefined}
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

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement>, ColumnWidthProps {
  /** Right-align and use tabular figures. */
  numeric?: boolean;
  /** Narrow cell holding a selection Checkbox. */
  select?: boolean;
  /**
   * The column name shown before the value when rows stack (`narrowLayout="stack"`). Defaults to the header text;
   * set it for static pages without JavaScript, or `""` to show the value alone (a title cell).
   */
  label?: string;
}

export const TableCell = forwardRef<HTMLTableCellElement, TableCellProps>(function TableCell(
  { numeric = false, select = false, width, minWidth, label, style, className, ...rest },
  ref,
) {
  const { stack } = useContext(TableContext);
  return (
    <td
      ref={ref}
      className={cx(styles.cell, numeric && styles.numeric, select && styles.select, className)}
      style={widthStyle(width, minWidth, style)}
      data-label={label}
      role={stack ? 'cell' : undefined}
      {...rest}
    />
  );
});

export interface TableEmptyProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Number of columns to span. */
  colSpan: number;
  children: ReactNode;
}

/** A full-width row for empty results. Put an EmptyState or one sentence with the next step inside. */
export const TableEmpty = forwardRef<HTMLTableRowElement, TableEmptyProps>(function TableEmpty({ colSpan, className, children, ...rest }, ref) {
  const { stack } = useContext(TableContext);
  return (
    <tr ref={ref} className={cx(styles.emptyRow, className)} role={stack ? 'row' : undefined} {...rest}>
      <td colSpan={colSpan} className={styles.empty} data-label="" role={stack ? 'cell' : undefined}>
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
