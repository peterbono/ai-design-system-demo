import { forwardRef, useState, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Icon } from '../Icon';
import { Link } from '../Link';
import styles from './Breadcrumb.module.css';

export interface BreadcrumbItemData {
  /** Visible label. Long labels are truncated with an ellipsis and keep the full text in a tooltip. */
  label: ReactNode;
  /** Destination. Omit on the last item: it is the current page. */
  href?: string;
  /** Render a router link instead of `<a>`, for example `<RouterLink to="/tokens" />`. */
  render?: ReactElement;
}

export interface BreadcrumbProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** Path from the top of the hierarchy to the current page. The last item is marked as the current page. */
  items: BreadcrumbItemData[];
  /** Accessible name of the navigation landmark. Default "Breadcrumb". */
  'aria-label'?: string;
  /**
   * Collapse long paths: keep the first item and the last `maxItems - 1`, hide the middle behind a "Show path" button.
   * Default: no collapsing.
   */
  maxItems?: number;
}

/** Shows where the current page sits in the hierarchy and links to each ancestor. */
export const Breadcrumb = forwardRef<HTMLElement, BreadcrumbProps>(function Breadcrumb(
  { items, maxItems, 'aria-label': ariaLabel = 'Breadcrumb', className, ...rest },
  ref,
) {
  const [expanded, setExpanded] = useState(false);
  const collapse = !expanded && maxItems !== undefined && maxItems >= 2 && items.length > maxItems;
  const hiddenCount = collapse ? items.length - maxItems : 0;
  const visible: (BreadcrumbItemData | 'ellipsis')[] = collapse
    ? [items[0]!, 'ellipsis', ...items.slice(items.length - (maxItems - 1))]
    : items;

  return (
    <nav ref={ref} aria-label={ariaLabel} className={cx(styles.breadcrumb, className)} {...rest}>
      <ol className={styles.list}>
        {visible.map((item, i) => {
          const isLast = i === visible.length - 1;
          return (
            <li key={item === 'ellipsis' ? 'ellipsis' : i} className={styles.item}>
              {item === 'ellipsis' ? (
                <button type="button" className={styles.ellipsis} onClick={() => setExpanded(true)} aria-label={`Show ${hiddenCount} more ${hiddenCount === 1 ? 'level' : 'levels'}`}>
                  <Icon icon={MoreHorizontal} size="sm" />
                </button>
              ) : isLast || !item.href ? (
                <span className={styles.current} aria-current={isLast ? 'page' : undefined} title={typeof item.label === 'string' ? item.label : undefined}>
                  {item.label}
                </span>
              ) : (
                <Link
                  variant="subtle"
                  href={item.href}
                  render={item.render}
                  className={styles.link}
                  title={typeof item.label === 'string' ? item.label : undefined}
                >
                  {item.label}
                </Link>
              )}
              {!isLast && <Icon icon={ChevronRight} size="xs" className={styles.separator} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
});
