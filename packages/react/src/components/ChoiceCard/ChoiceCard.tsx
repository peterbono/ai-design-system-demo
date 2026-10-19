import { forwardRef, useId, type ReactNode } from 'react';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import { Radio as BaseRadio } from '@base-ui/react/radio';
import { CircleAlert } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Icon } from '../Icon';
import radioStyles from '../RadioGroup/RadioGroup.module.css';
import styles from './ChoiceCard.module.css';

export interface ChoiceCardGroupProps {
  /** The question the cards answer, rendered as the fieldset legend: "Which value should this change keep?" */
  label: ReactNode;
  /** Help under the legend. */
  description?: ReactNode;
  /** Error message for the group. Marks it invalid and is linked with aria-describedby. */
  error?: ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /**
   * `horizontal` (default) puts the cards side by side in equal columns and stacks them when they no longer fit;
   * `vertical` always stacks them.
   */
  orientation?: 'horizontal' | 'vertical';
  name?: string;
  disabled?: boolean;
  required?: boolean;
  /** Visually hide the legend (it stays the accessible name), when the row around it already asks the question. */
  hideLabel?: boolean;
  /** ChoiceCard elements, two to four. */
  children: ReactNode;
  className?: string;
}

/**
 * One choice among two to four options that each need a title and a description, shown as cards: "Keep mine" or
 * "Use the library's", a starting brand, a corner style. A Base UI RadioGroup in a fieldset: Tab enters the group on
 * the selected card, arrow keys move the selection.
 */
export const ChoiceCardGroup = forwardRef<HTMLFieldSetElement, ChoiceCardGroupProps>(function ChoiceCardGroup(
  { label, description, error, orientation = 'horizontal', hideLabel = false, disabled, className, children, onValueChange, ...rest },
  ref,
) {
  const uid = useId();
  const legendId = `${uid}-legend`;
  const descriptionId = description ? `${uid}-description` : undefined;
  const invalid = error != null && error !== false && error !== '';
  const errorId = invalid ? `${uid}-error` : undefined;
  return (
    <fieldset ref={ref} className={cx(radioStyles.fieldset, className)} disabled={disabled} data-invalid={invalid || undefined}>
      <legend id={legendId} className={cx(radioStyles.legend, hideLabel && radioStyles.hiddenLegend)}>
        {label}
        {rest.required && (
          <span className={radioStyles.required} aria-hidden="true">
            *
          </span>
        )}
      </legend>
      {description && (
        <p id={descriptionId} className={radioStyles.description}>
          {description}
        </p>
      )}
      <BaseRadioGroup
        className={cx(styles.group, styles[orientation])}
        aria-labelledby={legendId}
        aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onValueChange={onValueChange ? (v: unknown) => onValueChange(v as string) : undefined}
        {...rest}
      >
        {children}
      </BaseRadioGroup>
      {invalid && (
        <p id={errorId} className={radioStyles.error}>
          <Icon icon={CircleAlert} size="xs" className={radioStyles.errorIcon} />
          <span>{error}</span>
        </p>
      )}
    </fieldset>
  );
});

export interface ChoiceCardProps {
  /** Value selected when this card is chosen. */
  value: string;
  /** The option, as a verb or a short name: "Keep mine", "Use the library's". */
  title: ReactNode;
  /** What choosing it means, or the value it keeps (a TokenValue). One or two lines. */
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** One card of a ChoiceCardGroup: the whole card is the click target, the radio shows the choice. */
export const ChoiceCard = forwardRef<HTMLSpanElement, ChoiceCardProps>(function ChoiceCard({ value, title, description, disabled, className }, ref) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const descriptionId = description ? `${uid}-description` : undefined;
  return (
    <label className={cx(styles.card, className)} data-pseudo-root="">
      <BaseRadio.Root ref={ref} value={value} disabled={disabled} className={radioStyles.radio} aria-labelledby={titleId} aria-describedby={descriptionId}>
        <BaseRadio.Indicator className={radioStyles.dot} keepMounted />
      </BaseRadio.Root>
      <span className={styles.text}>
        <span id={titleId} className={styles.title}>
          {title}
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
