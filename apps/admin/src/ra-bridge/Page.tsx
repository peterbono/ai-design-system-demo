import type { HTMLAttributes, ReactNode } from 'react';
import { Breadcrumb, type BreadcrumbItemData } from '@demo-ds/react';
import { cx } from './cx';
import styles from './layout.module.css';

export interface PageProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  /** One line under the title: counts, context, last update. */
  subtitle?: ReactNode;
  breadcrumb?: BreadcrumbItemData[];
  /** Primary actions, end-aligned with the title. */
  actions?: ReactNode;
  /** Optional element before the title, like an Avatar or a thumbnail. */
  media?: ReactNode;
  children?: ReactNode;
}

/**
 * Page frame: breadcrumb, title row with actions, then content. Bridge has no PageHeader component yet
 * (see DS-GAPS.md), so this composes Breadcrumb with type and space tokens.
 */
export function Page({ title, subtitle, breadcrumb, actions, media, className, children, ...rest }: PageProps) {
  return (
    <div className={cx(styles.page, className)} {...rest}>
      <header className={styles.pageHeader}>
        {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} className={styles.breadcrumb} />}
        <div className={styles.titleRow}>
          {media}
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>{title}</h1>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      </header>
      {children}
    </div>
  );
}

/** Section heading inside a page or card. */
export function SectionTitle({ children, actions, as: Tag = 'h2' }: { children: ReactNode; actions?: ReactNode; as?: 'h2' | 'h3' }) {
  return (
    <div className={styles.sectionHeader}>
      <Tag className={styles.sectionTitle}>{children}</Tag>
      {actions}
    </div>
  );
}
