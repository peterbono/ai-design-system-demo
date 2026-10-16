import { forwardRef, useState, type HTMLAttributes } from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { IconButton } from '../IconButton';
import styles from './Pagination.module.css';

export type PaginationVariant = 'full' | 'compact';
export type PaginationSize = 'sm' | 'md';

export interface PaginationProps extends Omit<HTMLAttributes<HTMLElement>, 'onChange'> {
  /** Total number of pages. */
  pageCount: number;
  /** Current page, 1-based (controlled). */
  page?: number;
  /** First page shown when uncontrolled. Default 1. */
  defaultPage?: number;
  /** Called with the requested page, 1-based. */
  onPageChange?: (page: number) => void;
  /** Pages shown on each side of the current one before an ellipsis. Default 1. */
  siblingCount?: number;
  /** `full` lists page numbers; `compact` shows "Page 3 of 12" between previous and next (narrow spaces). Default `full`. */
  variant?: PaginationVariant;
  /** Button height from the density tokens. Default `md`. */
  size?: PaginationSize;
  /** Accessible name of the navigation landmark. Default "Pagination". */
  'aria-label'?: string;
}

type Item = number | 'start-ellipsis' | 'end-ellipsis';

/** Page numbers with ellipses, first and last pages always visible. */
export function getPageItems(page: number, pageCount: number, siblingCount = 1): Item[] {
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  if (pageCount <= siblingCount * 2 + 5) return range(1, pageCount);
  const left = Math.max(page - siblingCount, 1);
  const right = Math.min(page + siblingCount, pageCount);
  const showLeft = left > 2;
  const showRight = right < pageCount - 1;
  const edge = 3 + siblingCount * 2;
  if (!showLeft) return [...range(1, edge), 'end-ellipsis', pageCount];
  if (!showRight) return [1, 'start-ellipsis', ...range(pageCount - edge + 1, pageCount)];
  return [1, 'start-ellipsis', ...range(left, right), 'end-ellipsis', pageCount];
}

/** Moves through a long list split into pages: tokens, review history, audit logs. */
export const Pagination = forwardRef<HTMLElement, PaginationProps>(function Pagination(
  { pageCount, page: pageProp, defaultPage = 1, onPageChange, siblingCount = 1, variant = 'full', size = 'md', 'aria-label': ariaLabel = 'Pagination', className, ...rest },
  ref,
) {
  const [internal, setInternal] = useState(defaultPage);
  const count = Math.max(1, pageCount);
  const page = Math.min(Math.max(pageProp ?? internal, 1), count);
  const go = (next: number) => {
    const clamped = Math.min(Math.max(next, 1), count);
    if (clamped === page) return;
    if (pageProp === undefined) setInternal(clamped);
    onPageChange?.(clamped);
  };
  const atStart = page <= 1;
  const atEnd = page >= count;

  return (
    <nav ref={ref} aria-label={ariaLabel} className={cx(styles.pagination, styles[size], className)} {...rest}>
      {variant === 'compact' ? (
        <div className={styles.compact}>
          <IconButton icon={ChevronLeft} label="Previous page" variant="ghost" size={size} disabled={atStart} onClick={() => go(page - 1)} />
          <span className={styles.status} aria-live="polite">
            Page <span className={styles.number}>{page}</span> of <span className={styles.number}>{count}</span>
          </span>
          <IconButton icon={ChevronRight} label="Next page" variant="ghost" size={size} disabled={atEnd} onClick={() => go(page + 1)} />
        </div>
      ) : (
        <ul className={styles.list}>
          <li>
            <Button variant="ghost" size={size} iconStart={ChevronLeft} disabled={atStart} onClick={() => go(page - 1)} aria-label="Previous page">
              Previous
            </Button>
          </li>
          {getPageItems(page, count, siblingCount).map((item) =>
            typeof item === 'number' ? (
              <li key={item}>
                <button
                  type="button"
                  className={cx(styles.page, item === page && styles.current)}
                  aria-current={item === page ? 'page' : undefined}
                  aria-label={`Page ${item}`}
                  onClick={() => go(item)}
                >
                  {item}
                </button>
              </li>
            ) : (
              <li key={item} className={styles.ellipsis}>
                <Icon icon={MoreHorizontal} size="sm" />
              </li>
            ),
          )}
          <li>
            <Button variant="ghost" size={size} iconEnd={ChevronRight} disabled={atEnd} onClick={() => go(page + 1)} aria-label="Next page">
              Next
            </Button>
          </li>
        </ul>
      )}
    </nav>
  );
});
