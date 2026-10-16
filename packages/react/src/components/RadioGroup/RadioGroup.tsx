import { forwardRef, useId, type ReactNode } from 'react';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import { Radio as BaseRadio } from '@base-ui/react/radio';
import { CircleAlert } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Icon } from '../Icon';
import styles from './RadioGroup.module.css';

export type RadioGroupOrientation = 'vertical' | 'horizontal';

export interface RadioGroupProps {
  /** Group label, rendered as the fieldset legend. Ask the question the options answer. */
  label: ReactNode;
  /** Help under the legend. */
  description?: ReactNode;
  /** Error message for the group. Marks it invalid and is linked with aria-describedby. */
  error?: ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Default `vertical`. Use `horizontal` only for two or three short options. */
  orientation?: RadioGroupOrientation;
  name?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  /** Visually hide the legend (it stays the accessible name). */
  hideLabel?: boolean;
  /** Radio items. */
  children: ReactNode;
  className?: string;
}

/** One choice among a few visible options. Base UI RadioGroup in a fieldset; arrow keys move the selection. */
export const RadioGroup = forwardRef<HTMLFieldSetElement, RadioGroupProps>(function RadioGroup(
  { label, description, error, orientation = 'vertical', hideLabel = false, disabled, className, children, onValueChange, ...rest },
  ref,
) {
  const uid = useId();
  const legendId = `${uid}-legend`;
  const descriptionId = description ? `${uid}-description` : undefined;
  const invalid = error != null && error !== false && error !== '';
  const errorId = invalid ? `${uid}-error` : undefined;
  return (
    <fieldset ref={ref} className={cx(styles.fieldset, className)} disabled={disabled} data-invalid={invalid || undefined}>
      <legend id={legendId} className={cx(styles.legend, hideLabel && styles.hiddenLegend)}>
        {label}
        {rest.required && (
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
      <BaseRadioGroup
        className={cx(styles.group, styles[orientation])}
        aria-labelledby={legendId}
        aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
        aria-invalid={invalid || undefined}
        aria-orientation={orientation}
        disabled={disabled}
        onValueChange={onValueChange ? (v: unknown) => onValueChange(v as string) : undefined}
        {...rest}
      >
        {children}
      </BaseRadioGroup>
      {invalid && (
        <p id={errorId} className={styles.error}>
          <Icon icon={CircleAlert} size="xs" className={styles.errorIcon} />
          <span>{error}</span>
        </p>
      )}
    </fieldset>
  );
});

export interface RadioProps {
  /** Value selected when this option is chosen. */
  value: string;
  /** Visible option label. */
  label: ReactNode;
  /** Secondary text under the label. */
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** One option of a RadioGroup. */
export const Radio = forwardRef<HTMLSpanElement, RadioProps>(function Radio({ value, label, description, disabled, className }, ref) {
  const uid = useId();
  const labelId = `${uid}-label`;
  const descriptionId = description ? `${uid}-description` : undefined;
  return (
    <label className={cx(styles.item, className)} data-pseudo-root="">
      <BaseRadio.Root ref={ref} value={value} disabled={disabled} className={styles.radio} aria-labelledby={labelId} aria-describedby={descriptionId}>
        <BaseRadio.Indicator className={styles.dot} keepMounted />
      </BaseRadio.Root>
      <span className={styles.text}>
        <span id={labelId}>{label}</span>
        {description && (
          <span id={descriptionId} className={styles.itemDescription}>
            {description}
          </span>
        )}
      </span>
    </label>
  );
});
