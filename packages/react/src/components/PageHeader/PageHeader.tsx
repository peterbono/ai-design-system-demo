import { createElement, forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../../utils/cx';
import styles from './PageHeader.module.css';

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** The page name, as in the navigation: "Spacing", "Install". */
  title: ReactNode;
  /** One or two sentences under the title: what this page is for. Falls back to `children`. */
  lead?: ReactNode;
  /** Small muted line under the lead: freshness, counts, owner. */
  meta?: ReactNode;
  /** One to three page-level actions, usually a primary or secondary Button, or links styled as buttons. */
  actions?: ReactNode;
  /** Heading level of the title. Default 1: one PageHeader per page. */
  headingLevel?: 1 | 2;
  /** Lead content when `lead` is not set (handy from templates that pass content as children). */
  children?: ReactNode;
}

/** The top of a page: title, a one-line lead, optional meta and the page actions. Actions wrap under the text on narrow screens. */
export const PageHeader = forwardRef<HTMLElement, PageHeaderProps>(function PageHeader(
  { title, lead, meta, actions, headingLevel = 1, className, children, ...rest },
  ref,
) {
  const leadContent = lead ?? children;
  return (
    <header ref={ref} className={cx(styles.pageHeader, className)} {...rest}>
      <div className={styles.text}>
        {createElement(`h${headingLevel}`, { className: cx(styles.title, headingLevel === 2 && styles.titleSm) }, title)}
        {leadContent != null && leadContent !== false && <div className={styles.lead}>{leadContent}</div>}
        {meta != null && meta !== false && <div className={styles.meta}>{meta}</div>}
      </div>
      {actions != null && actions !== false && <div className={styles.actions}>{actions}</div>}
    </header>
  );
});
