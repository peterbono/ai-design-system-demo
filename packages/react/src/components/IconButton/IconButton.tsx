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
  /** Default `ghost`: icon buttons usually live in toolbars and rows. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

/** Square, icon-only button. Pair with a Tooltip showing the same label for sighted mouse users. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', size = 'md', loading = false, disabled, className, type = 'button', ...rest },
  ref,
) {
  return (
    <BaseButton
      ref={ref}
      type={type}
      aria-label={label}
      className={cx(buttonStyles.button, buttonStyles[variant], buttonStyles[size], buttonStyles.iconOnly, styles.iconButton, className)}
      disabled={disabled || loading}
      focusableWhenDisabled={loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === 'lg' ? 'md' : 'sm'} /> : <Icon icon={icon} size={size === 'lg' ? 'md' : 'sm'} />}
    </BaseButton>
  );
});
