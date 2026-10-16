import { forwardRef, useId, type ReactNode } from 'react';
import { CheckboxGroup as BaseCheckboxGroup } from '@base-ui/react/checkbox-group';
import { CircleAlert } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Icon } from '../Icon';
import styles from './CheckboxGroup.module.css';

export type CheckboxGroupOrientation = 'vertical' | 'horizontal';

export interface CheckboxGroupProps {
  /** Group label, rendered as the fieldset legend. */
  label: ReactNode;
  /** Help under the legend. */
  description?: ReactNode;
  /** Error for the group, for example "Pick at least one reviewer." Linked with aria-describedby. */
  error?: ReactNode;
  /** Values of the checked items (controlled). */
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  /**
   * Every item value. Required for a parent "Select all" checkbox: add `<Checkbox parent label="All" />`
   * and the group drives its checked and mixed state.
   */
  allValues?: string[];
  /** Default `vertical`. */
  orientation?: CheckboxGroupOrientation;
  disabled?: boolean;
  required?: boolean;
  hideLabel?: boolean;
  /** Checkbox items, each with a `value`. */
  children: ReactNode;
  className?: string;
}

/** Several independent choices under one question. Base UI CheckboxGroup in a fieldset. */
export const CheckboxGroup = forwardRef<HTMLFieldSetElement, CheckboxGroupProps>(function CheckboxGroup(
  { label, description, error, orientation = 'vertical', disabled, required = false, hideLabel = false, className, children, onValueChange, ...rest },
  ref,
) {
  const uid = useId();
  const legendId = `${uid}-legend`;
  const descriptionId = description ? `${uid}-description` : undefined;
  const invalid = error != null && error !== false && error !== '';
  const errorId = invalid ? `${uid}-error` : undefined;
  return (
    <fieldset
      ref={ref}
      className={cx(styles.fieldset, className)}
      disabled={disabled}
      data-invalid={invalid || undefined}
      aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
    >
      <legend id={legendId} className={cx(styles.legend, hideLabel && styles.hiddenLegend)}>
        {label}
        {required && (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        )}
      </legend>
      {description && (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      )}
      <BaseCheckboxGroup
        className={cx(styles.group, styles[orientation])}
        disabled={disabled}
        onValueChange={onValueChange ? (v: string[]) => onValueChange(v) : undefined}
        {...rest}
      >
        {children}
      </BaseCheckboxGroup>
      {invalid && (
        <p id={errorId} className={styles.error}>
          <Icon icon={CircleAlert} size="xs" className={styles.errorIcon} />
          <span>{error}</span>
        </p>
      )}
    </fieldset>
  );
});
