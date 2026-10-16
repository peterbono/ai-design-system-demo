import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Input as BaseInput } from '@base-ui/react/input';
import { cx } from '../../utils/cx';
import { Field, useFieldContext } from '../Field';
import styles from './Input.module.css';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  /**
   * Visible label. When set, the Input wraps itself in a Field (label, hint, error wired for you).
   * Leave it unset when the Input is already inside a Field.
   */
  label?: string;
  /** Helper text under the label (Field description). */
  hint?: ReactNode;
  /** Error message. Marks the input invalid and announces the message. */
  error?: ReactNode;
  /** Content before the value: an Icon, a currency symbol, a unit. Decorative unless it is text. */
  prefix?: ReactNode;
  /** Content after the value: a unit, a Kbd hint, a clear IconButton. */
  suffix?: ReactNode;
  /** Height follows the density tokens. Default `md`. */
  size?: InputSize;
  /** Visually hide the Field label (still the accessible name). Only with `label`. */
  hideLabel?: boolean;
  /** Called with the new string value on every change. */
  onValueChange?: (value: string) => void;
}

/** Single-line text input with optional prefix and suffix. Base UI Input, wired to the surrounding Field. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, prefix, suffix, size = 'md', hideLabel, className, required, onValueChange, ...rest },
  ref,
) {
  const field = useFieldContext();
  const control = (
    <div className={cx(styles.control, styles[size], className)} data-pseudo-root="">
      {prefix != null && <span className={styles.affix}>{prefix}</span>}
      <BaseInput
        ref={ref}
        className={styles.input}
        required={required ?? (field.required || undefined)}
        onValueChange={onValueChange ? (value: string) => onValueChange(value) : undefined}
        {...rest}
      />
      {suffix != null && <span className={styles.affix}>{suffix}</span>}
    </div>
  );
  if (label === undefined) return control;
  return (
    <Field label={label} description={hint} error={error} required={required} disabled={rest.disabled} name={rest.name} hideLabel={hideLabel}>
      {control}
    </Field>
  );
});
