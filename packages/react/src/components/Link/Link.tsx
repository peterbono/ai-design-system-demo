import { forwardRef, type AnchorHTMLAttributes, type ReactElement } from 'react';
import { useRender } from '@base-ui/react/use-render';
import { mergeProps } from '@base-ui/react/merge-props';
import { ExternalLink } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Icon } from '../Icon';
import { VisuallyHidden } from '../VisuallyHidden';
import styles from './Link.module.css';

export type LinkVariant = 'inline' | 'standalone' | 'subtle';

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** `inline` sits in running text (always underlined); `standalone` stands alone (underline on hover); `subtle` inherits the text color. Default `inline`. */
  variant?: LinkVariant;
  /** Opens in a new tab: adds target, rel, an icon and "(opens in a new tab)" for screen readers. */
  external?: boolean;
  /** Render a router link instead of `<a>`: `render={<RouterLink to="/tokens" />}`. */
  render?: ReactElement;
}

/** Navigates to another page or URL. If it performs an action on this screen, use a Button. */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { variant = 'inline', external = false, className, children, render, ...rest },
  ref,
) {
  const content = (
    <>
      {children}
      {external && (
        <>
          <Icon icon={ExternalLink} size="xs" className={styles.externalIcon} />
          <VisuallyHidden> (opens in a new tab)</VisuallyHidden>
        </>
      )}
    </>
  );
  return useRender({
    defaultTagName: 'a',
    render,
    ref,
    props: mergeProps<'a'>(
      {
        className: cx(styles.link, styles[variant], className),
        ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
        children: content,
      },
      rest,
    ),
  });
});
