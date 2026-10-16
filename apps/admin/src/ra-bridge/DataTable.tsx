import { type MouseEvent, type ReactNode } from 'react';
import { LinkBase, useCreatePath, useListContext, useNavigate, useTranslate, type RaRecord } from 'ra-core';
import {
  Button,
  Checkbox,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  VisuallyHidden,
  type LucideIcon,
} from '@bridge-ds/react';
import { SearchX } from 'lucide-react';
import { cx } from './cx';
import { ListPagination } from './ListPagination';
import styles from './list.module.css';

export interface Column<R extends RaRecord = RaRecord> {
  /** Record field used for sorting and the default cell value. */
  source: string;
  label: string;
  /** Allow sorting on this column (server-side through ra-core). Default false. */
  sortable?: boolean;
  /** Right-aligned tabular figures. */
  numeric?: boolean;
  /** Custom cell content. */
  render?: (record: R) => ReactNode;
  /** Render the cell as the row's link (keyboard path to the edit page). */
  link?: boolean;
  /** Hide the column below this breakpoint to keep phones readable. */
  hideBelow?: 'sm' | 'md' | 'lg';
}

export interface DataTableProps<R extends RaRecord = RaRecord> {
  columns: Column<R>[];
  /** Accessible name of the table region. */
  label: string;
  /** Where a row leads. Default `edit`. `false` for read-only rows. */
  rowClick?: 'edit' | 'show' | false | ((record: R) => string);
  /** Buttons shown when rows are selected. Selection checkboxes appear only when this is set. */
  bulkActions?: ReactNode;
  /** Empty collection (no filters active). */
  empty?: { icon?: LucideIcon; title: string; description?: string; actions?: ReactNode };
  /** Hide the pagination footer, for short embedded lists. */
  hidePagination?: boolean;
  /** Extra class per row (status tint, for example). */
  rowClassName?: (record: R) => string | undefined;
  stickyHeader?: boolean;
  /** Phone layout: below 640px the table is replaced by a list of these rows (no selection). */
  renderMobile?: (record: R) => ReactNode;
}

/**
 * ra-core list rendered with the Bridge Table: server-side sort, row selection with bulk actions,
 * skeleton loading, empty and no-results states, and pagination. Reads everything from ListContext.
 */
export function DataTable<R extends RaRecord = RaRecord>({
  columns,
  label,
  rowClick = 'edit',
  bulkActions,
  empty,
  hidePagination = false,
  rowClassName,
  stickyHeader = false,
  renderMobile,
}: DataTableProps<R>) {
  const list = useListContext<R>();
  const { data, isPending, sort, setSort, selectedIds, onSelect, onToggleItem, onUnselectItems, resource, filterValues, setFilters, perPage, total } = list;
  const translate = useTranslate();
  const createPath = useCreatePath();
  const navigate = useNavigate();
  const selectable = bulkActions != null;
  const colCount = columns.length + (selectable ? 1 : 0);

  const pathFor = (record: R): string | null => {
    if (rowClick === false) return null;
    if (typeof rowClick === 'function') return rowClick(record);
    return createPath({ resource, id: record.id, type: rowClick });
  };

  const sortProps = (col: Column<R>) => {
    if (!col.sortable) return {};
    const active = sort.field === col.source;
    return {
      sortDirection: active ? (sort.order === 'ASC' ? 'ascending' : 'descending') : 'none',
      onSort: () => setSort({ field: col.source, order: active && sort.order === 'ASC' ? 'DESC' : 'ASC' }),
    } as const;
  };

  const ids = data?.map((r) => r.id) ?? [];
  const selectedOnPage = ids.filter((id) => selectedIds.includes(id));
  const allOnPage = ids.length > 0 && selectedOnPage.length === ids.length;
  const someOnPage = selectedOnPage.length > 0 && !allOnPage;

  const onRowClick = (record: R) => (event: MouseEvent<HTMLTableRowElement>) => {
    const path = pathFor(record);
    if (!path) return;
    const target = event.target as HTMLElement;
    if (target.closest('a, button, input, label, [role="checkbox"], [role="menuitem"]')) return;
    if (window.getSelection()?.toString()) return;
    navigate(path);
  };

  const hasFilters = Object.keys(filterValues ?? {}).some((k) => !isDefaultFilter(k));

  const cellClass = (col: Column<R>) => (col.hideBelow ? styles[`hide-${col.hideBelow}`] : undefined);

  return (
    <div className={styles.dataTable}>
      {selectable && selectedIds.length > 0 && (
        <div className={cx(styles.bulkBar, renderMobile && styles.desktopOnlyFlex)} role="region" aria-label={translate('bridge.list.bulk_region', { _: 'Bulk actions' })}>
          <span className={styles.bulkCount} aria-live="polite">
            {translate('bridge.list.selected', { smart_count: selectedIds.length, _: '%{smart_count} selected' })}
          </span>
          <div className={styles.bulkActions}>{bulkActions}</div>
          <Button variant="ghost" size="sm" onClick={() => onUnselectItems()}>
            {translate('bridge.list.clear_selection', { _: 'Clear selection' })}
          </Button>
        </div>
      )}
      {renderMobile && !isPending && data && data.length > 0 && (
        <ul className={styles.mobileList} aria-label={label}>
          {data.map((record) => {
            const path = pathFor(record);
            return (
              <li key={record.id}>
                {path ? (
                  <LinkBase to={path} className={styles.mobileRow}>
                    {renderMobile(record)}
                  </LinkBase>
                ) : (
                  <div className={styles.mobileRow}>{renderMobile(record)}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className={cx(renderMobile && data && data.length > 0 && styles.desktopOnly)}>
      <Table aria-label={label} stickyHeader={stickyHeader} aria-busy={isPending || undefined}>
        <TableHeader>
          <TableRow>
            {selectable && (
              <TableHead className={styles.selectHead}>
                <Checkbox
                  label={<VisuallyHidden>{translate('bridge.list.select_page', { _: 'Select all rows on this page' })}</VisuallyHidden>}
                  checked={allOnPage}
                  indeterminate={someOnPage}
                  disabled={ids.length === 0}
                  onCheckedChange={(checked) =>
                    onSelect(checked ? Array.from(new Set([...selectedIds, ...ids])) : selectedIds.filter((id) => !ids.includes(id)))
                  }
                />
              </TableHead>
            )}
            {columns.map((col) => (
              <TableHead key={col.source + col.label} numeric={col.numeric} className={cellClass(col)} {...sortProps(col)}>
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            Array.from({ length: Math.min(perPage, 8) }, (_, i) => (
              <TableRow key={`skeleton-${i}`}>
                {selectable && (
                  <TableCell select>
                    <Skeleton variant="rect" width="var(--size-4)" height="var(--size-4)" />
                  </TableCell>
                )}
                {columns.map((col) => (
                  <TableCell key={col.source + col.label} numeric={col.numeric} className={cellClass(col)}>
                    <Skeleton width={col.numeric ? 'var(--size-16)' : i % 2 ? 'var(--size-20)' : 'var(--size-16)'} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : data && data.length > 0 ? (
            data.map((record) => {
              const path = pathFor(record);
              const selected = selectable ? selectedIds.includes(record.id) : undefined;
              return (
                <TableRow
                  key={record.id}
                  selected={selected}
                  onClick={path ? onRowClick(record) : undefined}
                  className={cx(path && styles.clickable, rowClassName?.(record))}
                >
                  {selectable && (
                    <TableCell select>
                      <Checkbox
                        label={<VisuallyHidden>{translate('bridge.list.select_row', { _: 'Select row' })}</VisuallyHidden>}
                        checked={selected}
                        onCheckedChange={() => onToggleItem(record.id)}
                      />
                    </TableCell>
                  )}
                  {columns.map((col) => {
                    const content = col.render ? col.render(record) : String((record as Record<string, unknown>)[col.source] ?? '');
                    return (
                      <TableCell key={col.source + col.label} numeric={col.numeric} className={cellClass(col)}>
                        {col.link && path ? (
                          <LinkBase to={path} className={styles.rowLink}>
                            {content}
                          </LinkBase>
                        ) : (
                          content
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })
          ) : (
            <TableEmpty colSpan={colCount}>
              {hasFilters ? (
                <EmptyState
                  size="sm"
                  icon={SearchX}
                  title={translate('bridge.list.no_results', { _: 'No results match these filters' })}
                  description={translate('bridge.list.no_results_hint', { _: 'Try another search, or clear the filters to see everything.' })}
                  actions={
                    <Button variant="secondary" size="sm" onClick={() => setFilters(keepDefaultFilters(filterValues), {})}>
                      {translate('bridge.list.clear_filters', { _: 'Clear filters' })}
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  size="sm"
                  icon={empty?.icon}
                  title={empty?.title ?? translate('bridge.list.empty', { _: 'Nothing here yet' })}
                  description={empty?.description}
                  actions={empty?.actions}
                />
              )}
            </TableEmpty>
          )}
        </TableBody>
      </Table>
      </div>
      {!hidePagination && (total ?? 0) > 0 && <ListPagination />}
    </div>
  );
}

/** Filters that structure the view (status tabs) rather than narrow it: kept when clearing. */
const STRUCTURAL = new Set(['status']);
function isDefaultFilter(key: string) {
  return STRUCTURAL.has(key);
}
function keepDefaultFilters(values: Record<string, unknown> = {}) {
  return Object.fromEntries(Object.entries(values).filter(([k]) => isDefaultFilter(k)));
}
