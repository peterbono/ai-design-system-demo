import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { Toggle } from '@base-ui/react/toggle';
import { Check, X } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Icon, type LucideIcon } from '../Icon';
import styles from './Tag.module.css';

export type TagTone = 'neutral' | 'signal';

export interface TagProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The tag text: a filter value, a token group, a component name. */
  children: ReactNode;
  /** `signal` marks a tag that matches the current search or filter. Default `neutral`. */
  tone?: TagTone;
  /** Leading Lucide icon. */
  icon?: LucideIcon;
  /** Makes the tag a toggle (filter chip). Controlled pressed state, announced with aria-pressed. */
  selected?: boolean;
  /** Uncontrolled initial selected state for a toggle tag. */
  defaultSelected?: boolean;
  /** Called when a toggle tag is pressed. Passing it makes the tag interactive. */
  onSelectedChange?: (selected: boolean) => void;
  /** Adds a remove button. Called when it is pressed. */
  onRemove?: () => void;
  /** Accessible name of the remove button, without the verb. Defaults to the tag text when it is a string. */
  removeLabel?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

/** A compact label for a value: static, toggleable (filter chip) or removable (selected values). */
export const Tag = forwardRef<HTMLSpanElement, TagProps>(function Tag(
  { children, tone = 'neutral', icon, selected, defaultSelected, onSelectedChange, onRemove, removeLabel, disabled = false, size = 'md', className, ...rest },
  ref,
) {
  const toggleable = selected !== undefined || defaultSelected !== undefined || onSelectedChange !== undefined;
  const name = removeLabel ?? (typeof children === 'string' ? children : undefined);
  const content = (
    <>
      {icon && <Icon icon={icon} size="xs" className={styles.icon} />}
      <span className={styles.text}>{children}</span>
    </>
  );
  return (
    <span
      ref={ref}
      className={cx(styles.tag, styles[tone], styles[size], toggleable && styles.toggleable, onRemove && styles.removable, className)}
      data-disabled={disabled || undefined}
      {...rest}
    >
      {toggleable ? (
        <Toggle
          className={styles.toggle}
          pressed={selected}
          defaultPressed={defaultSelected}
          onPressedChange={(pressed) => onSelectedChange?.(pressed)}
          disabled={disabled}
        >
          <Icon icon={Check} size="xs" className={styles.check} />
          {content}
        </Toggle>
      ) : (
        <span className={styles.label}>{content}</span>
      )}
      {onRemove && (
        <button
          type="button"
          className={styles.remove}
          onClick={onRemove}
          disabled={disabled}
          aria-label={name ? `Remove ${name}` : 'Remove'}
        >
          <Icon icon={X} size="xs" />
        </button>
      )}
    </span>
  );
});
