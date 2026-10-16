import { forwardRef, type ReactNode } from 'react';
import { NumberField as BaseNumberField } from '@base-ui/react/number-field';
import { Minus, Plus } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Field, useFieldContext } from '../Field';
import { Icon } from '../Icon';
import styles from './NumberField.module.css';

export type NumberFieldSize = 'sm' | 'md' | 'lg';

export interface NumberFieldProps {
  /** Visible label. When set, the NumberField wraps itself in a Field. Leave unset inside a Field. */
  label?: string;
  hint?: ReactNode;
  error?: ReactNode;
  value?: number | null;
  defaultValue?: number;
  onValueChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Amount for the buttons and arrow keys. Shift+arrow uses largeStep. Default 1. */
  step?: number;
  largeStep?: number;
  /** Intl number format, for example `{ style: 'unit', unit: 'pixel' }` or `{ maximumFractionDigits: 2 }`. */
  format?: Intl.NumberFormatOptions;
  /** Unit or symbol shown after the value inside the box, for example "px". */
  suffix?: ReactNode;
  /** Hide the increment and decrement buttons (keyboard and wheel still work). */
  hideSteppers?: boolean;
  size?: NumberFieldSize;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  hideLabel?: boolean;
  id?: string;
  className?: string;
}

/** Numeric input with steppers, arrow keys, min, max and locale formatting. Wraps the Base UI NumberField. */
export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  { label, hint, error, suffix, hideSteppers = false, size = 'md', hideLabel, placeholder, required, className, id, ...rest },
  ref,
) {
  const field = useFieldContext();
  const control = (
    <BaseNumberField.Root className={cx(styles.root, styles[size], className)} id={id} required={required ?? (field.required || undefined)} {...rest}>
      <BaseNumberField.Group className={styles.group} data-pseudo-root="">
        {!hideSteppers && (
          <BaseNumberField.Decrement className={styles.stepper} aria-label="Decrease">
            <Icon icon={Minus} size="sm" />
          </BaseNumberField.Decrement>
        )}
        <BaseNumberField.Input ref={ref} className={styles.input} placeholder={placeholder} />
        {suffix != null && <span className={styles.suffix}>{suffix}</span>}
        {!hideSteppers && (
          <BaseNumberField.Increment className={styles.stepper} aria-label="Increase">
            <Icon icon={Plus} size="sm" />
          </BaseNumberField.Increment>
        )}
      </BaseNumberField.Group>
    </BaseNumberField.Root>
  );
  if (label === undefined) return control;
  return (
    <Field label={label} description={hint} error={error} required={required} disabled={rest.disabled} name={rest.name} hideLabel={hideLabel}>
      {control}
    </Field>
  );
});
