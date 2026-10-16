import { forwardRef, useId, type ReactNode } from 'react';
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Check, Minus } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Icon } from '../Icon';
import styles from './Checkbox.module.css';

export interface CheckboxProps {
  /** Visible label next to the box. Clicking it toggles the checkbox. */
  label: ReactNode;
  /** Secondary text under the label, linked with aria-describedby. */
  description?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Mixed state, for a parent that controls a partly checked group. Announced as "mixed". */
  indeterminate?: boolean;
  /** Inside a CheckboxGroup with allValues: this checkbox selects or clears the whole group. */
  parent?: boolean;
  /** Value submitted with the form, and the item id inside a CheckboxGroup. */
  value?: string;
  name?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  /** Marks the checkbox invalid (red edge). Pair it with an error message on the group or form. */
  invalid?: boolean;
  id?: string;
  className?: string;
}

/** A single on or off choice with a visible label. Wraps the Base UI Checkbox. */
export const Checkbox = forwardRef<HTMLSpanElement, CheckboxProps>(function Checkbox(
  { label, description, indeterminate, invalid = false, className, id, ...rest },
  ref,
) {
  const uid = useId();
  const labelId = `${uid}-label`;
  const descriptionId = description ? `${uid}-description` : undefined;
  return (
    <label className={cx(styles.item, className)} data-pseudo-root="" data-parent={rest.parent || undefined}>
      <BaseCheckbox.Root
        ref={ref}
        id={id}
        className={styles.box}
        indeterminate={indeterminate}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        <BaseCheckbox.Indicator className={styles.indicator} keepMounted>
          <Icon icon={Check} size="xs" className={cx(styles.glyph, styles.checkGlyph)} />
          <Icon icon={Minus} size="xs" className={cx(styles.glyph, styles.mixedGlyph)} />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      <span className={styles.text}>
        <span id={labelId} className={styles.label}>
          {label}
        </span>
        {description && (
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        )}
      </span>
    </label>
  );
});
