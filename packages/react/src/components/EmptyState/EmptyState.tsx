import { createElement, forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../../utils/cx';
import { Icon, type LucideIcon } from '../Icon';
import styles from './EmptyState.module.css';

export type EmptyStateSize = 'sm' | 'md' | 'lg';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** A Lucide icon that names the object that is missing (GitPullRequest for pull requests). */
  icon?: LucideIcon;
  /** What is empty, said plainly: "No pull requests yet". */
  title: ReactNode;
  /** Why it is empty and what fills it. One or two sentences. */
  description?: ReactNode;
  /** The next step: usually one primary Button, plus an optional secondary Button or Link. */
  actions?: ReactNode;
  /** `sm` inside a card or table, `md` in a panel, `lg` for a whole page. Default `md`. */
  size?: EmptyStateSize;
  /** Heading level of the title, to fit the page outline. Default 3. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** `center` for pages and panels, `start` inside left-aligned layouts. Default `center`. */
  align?: 'center' | 'start';
}

/** Explains why a view has no content yet and invites the action that fills it. */
export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { icon, title, description, actions, size = 'md', headingLevel = 3, align = 'center', className, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={cx(styles.emptyState, styles[size], styles[align], className)} {...rest}>
      {icon && (
        <span className={styles.media}>
          <Icon icon={icon} size={size === 'sm' ? 'md' : 'lg'} />
        </span>
      )}
      <div className={styles.text}>
        {createElement(`h${headingLevel}`, { className: styles.title }, title)}
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
});
