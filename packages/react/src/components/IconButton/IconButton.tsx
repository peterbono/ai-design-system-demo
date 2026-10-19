import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Button as BaseButton } from '@base-ui/react/button';
import { cx } from '../../utils/cx';
import { Icon, type LucideIcon } from '../Icon';
import { Spinner } from '../Spinner';
import buttonStyles from '../Button/Button.module.css';
import type { ButtonSize, ButtonVariant } from '../Button';
import styles from './IconButton.module.css';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  /** Lucide icon component. */
  icon: LucideIcon;
  /** Accessible name, required: there is no visible text. Say the action, not the icon ("Delete token", not "Trash"). */
  label: string;
  /** Default `ghost`: icon buttons usually live in toolbars and rows. `inverse` on strong surfaces. */
  variant?: Exclude<ButtonVariant, 'link'>;
  size?: ButtonSize;
  loading?: boolean;
  /** Makes the button a toggle: sets `aria-pressed` and shows the selected look when true. Leave unset otherwise. */
  pressed?: boolean;
}

/** Square, icon-only button. Pair with a Tooltip showing the same label for sighted mouse users. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', size = 'md', loading = false, pressed, disabled, className, type = 'button', ...rest },
  ref,
) {
  return (
    <BaseButton
      ref={ref}
      type={type}
      aria-label={label}
      className={cx(buttonStyles.button, buttonStyles[variant], buttonStyles[size], buttonStyles.iconOnly, pressed !== undefined && buttonStyles.toggle, styles.iconButton, className)}
      disabled={disabled || loading}
      focusableWhenDisabled={loading}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
      data-loading={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === 'lg' ? 'md' : 'sm'} /> : <Icon icon={icon} size={size === 'lg' ? 'md' : 'sm'} />}
    </BaseButton>
  );
});
