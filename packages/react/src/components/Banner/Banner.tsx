import { forwardRef, useId, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../../utils/cx';
import { Icon, type LucideIcon } from '../Icon';
import styles from './Banner.module.css';

export type BannerAppearance = 'strong' | 'neutral';
export type BannerSticky = 'top' | 'below-header';

export interface BannerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** The mode, in one sentence: "Viewing the library as change #118. Nothing is saved." */
  title: ReactNode;
  /** One more line when the mode needs it: what is different, what is kept. */
  children?: ReactNode;
  /** Leading Lucide icon for the mode, for example Eye for a preview. */
  icon?: LucideIcon;
  /** The way out, and at most one more action, on the same line: Buttons with `variant="secondary"`. */
  actions?: ReactNode;
  /**
   * `strong` (default): Deep Harbor, the one strong color, for a mode the whole page is in. `neutral`: the subtle
   * ground, for a quieter mode such as a scoped editor.
   */
  appearance?: BannerAppearance;
  /** Keep the banner in view while the page scrolls: at the top of the scroll area, or under the app header (`layout.header.height`). */
  sticky?: BannerSticky;
}

/**
 * A page-level mode banner: the page shows something other than usual (a change previewed in the library, an edit
 * mode) and the way back sits on the same line. One per page, at the top of the content. A landmark region named by
 * its title. For messages about the page's content, use Alert.
 */
export const Banner = forwardRef<HTMLDivElement, BannerProps>(function Banner(
  { title, icon, actions, appearance = 'strong', sticky, className, children, ...rest },
  ref,
) {
  const titleId = `${useId()}-title`;
  return (
    <div
      ref={ref}
      role="region"
      aria-labelledby={titleId}
      className={cx(styles.banner, styles[appearance], sticky === 'top' && styles.stickyTop, sticky === 'below-header' && styles.stickyHeader, className)}
      {...rest}
    >
      <div className={styles.lead}>
        {icon && <Icon icon={icon} size="md" className={styles.icon} />}
        <div className={styles.content}>
          <p id={titleId} className={styles.title}>
            {title}
          </p>
          {children != null && children !== false && <div className={styles.description}>{children}</div>}
        </div>
      </div>
      {actions != null && actions !== false && <div className={styles.actions}>{actions}</div>}
    </div>
  );
});
