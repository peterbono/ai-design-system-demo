import { useListContext, useTranslate } from 'ra-core';
import { Pagination, Select } from '@demo-ds/react';
import styles from './list.module.css';

const PER_PAGE = [10, 25, 50, 100];

/** Range summary, rows-per-page choice and page navigation for the current ra-core list. */
export function ListPagination({ perPageOptions = PER_PAGE }: { perPageOptions?: number[] }) {
  const { page, perPage, total = 0, setPage, setPerPage, isPending } = useListContext();
  const translate = useTranslate();
  if (isPending) return null;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  return (
    <div className={styles.pagination}>
      <span className={styles.range}>
        {translate('bridge.list.range', { from, to, total, _: '%{from} to %{to} of %{total}' })}
      </span>
      <div className={styles.perPage}>
        <Select
          size="sm"
          label={translate('bridge.list.per_page', { _: 'Rows per page' })}
          hideLabel
          value={String(perPage)}
          options={perPageOptions.map((n) => ({ value: String(n), label: translate('bridge.list.per_page_option', { n, _: '%{n} per page' }) }))}
          onValueChange={(v) => v && setPerPage(Number(v))}
        />
      </div>
      <Pagination
        className={styles.pages}
        size="sm"
        pageCount={pageCount}
        page={page}
        onPageChange={setPage}
        aria-label={translate('bridge.list.pagination', { _: 'Pagination' })}
      />
      <Pagination
        className={styles.pagesCompact}
        size="sm"
        variant="compact"
        pageCount={pageCount}
        page={page}
        onPageChange={setPage}
        aria-label={translate('bridge.list.pagination', { _: 'Pagination' })}
      />
    </div>
  );
}
