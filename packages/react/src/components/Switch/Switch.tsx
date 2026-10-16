import { forwardRef, useId, type ReactNode } from 'react';
import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { cx } from '../../utils/cx';
import styles from './Switch.module.css';

export type SwitchSize = 'sm' | 'md';
export type SwitchLabelPlacement = 'end' | 'start';

export interface SwitchProps {
  /** Visible label. Name the setting, not the state: "Email notifications", not "On". */
  label: ReactNode;
  /** Secondary text under the label, linked with aria-describedby. */
  description?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** `end` puts the label after the switch; `start` puts it first and pushes the switch to the row end (settings lists). Default `end`. */
  labelPlacement?: SwitchLabelPlacement;
  /** Default `md` (36 by 20). `sm` (28 by 16) for dense tables. */
  size?: SwitchSize;
  name?: string;
  value?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
}

/** Turns a setting on or off with immediate effect. Wraps the Base UI Switch (role switch). */
export const Switch = forwardRef<HTMLSpanElement, SwitchProps>(function Switch(
  { label, description, labelPlacement = 'end', size = 'md', className, ...rest },
  ref,
) {
  const uid = useId();
  const labelId = `${uid}-label`;
  const descriptionId = description ? `${uid}-description` : undefined;
  return (
    <label className={cx(styles.item, styles[labelPlacement], styles[size], className)} data-pseudo-root="">
      <BaseSwitch.Root ref={ref} className={styles.track} aria-labelledby={labelId} aria-describedby={descriptionId} {...rest}>
        <BaseSwitch.Thumb className={styles.thumb} />
      </BaseSwitch.Root>
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
