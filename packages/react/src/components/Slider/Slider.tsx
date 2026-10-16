import { forwardRef, type ReactNode } from 'react';
import { Slider as BaseSlider } from '@base-ui/react/slider';
import { cx } from '../../utils/cx';
import { Field } from '../Field';
import styles from './Slider.module.css';

export interface SliderProps {
  /** Visible label. When set, the Slider wraps itself in a Field. Leave unset inside a Field. */
  label?: string;
  hint?: ReactNode;
  error?: ReactNode;
  /** A number for one thumb, an array of two numbers for a range. */
  value?: number | number[];
  defaultValue?: number | number[];
  /** Fires while dragging. */
  onValueChange?: (value: number | number[]) => void;
  /** Fires once when the user releases the thumb or stops pressing keys. Use it for expensive work. */
  onValueCommitted?: (value: number | number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Step for Page Up, Page Down and Shift+arrow. Default 10. */
  largeStep?: number;
  /** Intl format for the displayed value, for example `{ style: 'percent' }`. */
  format?: Intl.NumberFormatOptions;
  /** Show the formatted value at the end of the track. Default true. */
  showValue?: boolean;
  /** Accessible names of the thumbs when there is no visible label, or to name range ends. */
  thumbLabels?: string[];
  name?: string;
  disabled?: boolean;
  hideLabel?: boolean;
  className?: string;
}

/** Picks a value or a range on a continuous scale where the exact number matters less than the position. */
export const Slider = forwardRef<HTMLDivElement, SliderProps>(function Slider(
  { label, hint, error, showValue = true, thumbLabels, hideLabel, className, ...rest },
  ref,
) {
  const initial = rest.value ?? rest.defaultValue ?? 0;
  const count = Array.isArray(initial) ? initial.length : 1;
  const rangeNames = count > 1 ? ['minimum', 'maximum'] : [];
  const control = (
    <BaseSlider.Root ref={ref} className={cx(styles.root, className)} {...(rest as Record<string, unknown>)}>
      <BaseSlider.Control className={styles.control} data-pseudo-root="">
        <BaseSlider.Track className={styles.track}>
          <BaseSlider.Indicator className={styles.indicator} />
          {Array.from({ length: count }, (_, i) => (
            <BaseSlider.Thumb
              key={i}
              index={count > 1 ? i : undefined}
              className={styles.thumb}
              getAriaLabel={
                thumbLabels?.[i] || (label && count > 1)
                  ? () => thumbLabels?.[i] ?? `${label} ${rangeNames[i] ?? ''}`.trim()
                  : undefined
              }
            />
          ))}
        </BaseSlider.Track>
      </BaseSlider.Control>
      {showValue && (
        <BaseSlider.Value className={styles.value}>
          {(formatted: readonly string[]) => formatted.join(' to ')}
        </BaseSlider.Value>
      )}
    </BaseSlider.Root>
  );
  if (label === undefined) return control;
  return (
    <Field label={label} description={hint} error={error} disabled={rest.disabled} name={rest.name} hideLabel={hideLabel}>
      {control}
    </Field>
  );
});
