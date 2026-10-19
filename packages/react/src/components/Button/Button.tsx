import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Button as BaseButton } from '@base-ui/react/button';
import { useRender } from '@base-ui/react/use-render';
import { mergeProps } from '@base-ui/react/merge-props';
import { cx } from '../../utils/cx';
import { Icon, type LucideIcon } from '../Icon';
import { Spinner } from '../Spinner';
import styles from './Button.module.css';

/**
 * `link` looks like a text link but stays a button (an action on this screen, not navigation); `inverse` is the
 * action on a strong surface (Deep Harbor, `color.surface.inverse`).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link' | 'inverse';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual emphasis. Use one primary action per view; danger only for destructive actions. */
  variant?: ButtonVariant;
  /** Height follows the density tokens: sm 32/28, md 40/32, lg 48/40 (comfortable/compact). */
  size?: ButtonSize;
  /** Shows a spinner, keeps the button focusable, ignores clicks and sets aria-busy. */
  loading?: boolean;
  /** Lucide icon before the label. Replaced by the spinner while loading. */
  iconStart?: LucideIcon;
  /** Lucide icon after the label, for example a chevron on a menu trigger. */
  iconEnd?: LucideIcon;
  /** Stretch to the width of the container. */
  fullWidth?: boolean;
  /**
   * Makes the button a toggle: sets `aria-pressed` and shows the selected look when true. Leave unset for a plain
   * button. A script can flip `aria-pressed` on a statically rendered toggle: the look follows the attribute.
   */
  pressed?: boolean;
  /**
   * Render another element with button styling, for example a router link: `render={<a href="/tokens" />}`.
   * The element keeps its own role (a link stays a link), so only use it for navigation.
   */
  render?: ReactElement;
}

/** Non-button element styled as a button (links). Keeps the element's native role. */
interface RenderedProps extends HTMLAttributes<HTMLElement> {
  render: ReactElement;
  children: ReactNode;
}
const Rendered = forwardRef<HTMLElement, RenderedProps>(function Rendered({ render, ...props }, ref) {
  return useRender({ render, ref, props: mergeProps<'a'>(props as HTMLAttributes<HTMLAnchorElement>, {}) });
});

/** Triggers an action on the current screen. Wraps the Base UI Button. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, iconStart, iconEnd, fullWidth = false, pressed, disabled, className, children, type = 'button', render, ...rest },
  ref,
) {
  const classes = cx(styles.button, styles[variant], styles[size], fullWidth && styles.fullWidth, pressed !== undefined && styles.toggle, className);
  const content = (
    <>
      {loading ? <Spinner size="sm" className={styles.icon} /> : iconStart && <Icon icon={iconStart} size="sm" className={styles.icon} />}
      {children != null && <span className={styles.label}>{children}</span>}
      {iconEnd && <Icon icon={iconEnd} size="sm" className={styles.icon} />}
    </>
  );
  if (render) {
    return (
      <Rendered ref={ref as never} render={render} className={classes} {...(rest as HTMLAttributes<HTMLElement>)}>
        {content}
      </Rendered>
    );
  }
  return (
    <BaseButton
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      focusableWhenDisabled={loading}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
      data-loading={loading || undefined}
      {...rest}
    >
      {content}
    </BaseButton>
  );
});
