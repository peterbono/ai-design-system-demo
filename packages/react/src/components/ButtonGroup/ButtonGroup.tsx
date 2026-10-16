import { forwardRef, type HTMLAttributes } from 'react';
import { cx } from '../../utils/cx';
import styles from './ButtonGroup.module.css';

export interface ButtonGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** Accessible name for the group, for example "Text alignment". Required when the buttons are related choices. */
  'aria-label'?: string;
  /** `attached` joins the buttons into one segmented control; `spaced` keeps a gap (action bars). Default `spaced`. */
  appearance?: 'spaced' | 'attached';
  orientation?: 'horizontal' | 'vertical';
  /** Align the group's buttons. Default `start`. Use `end` for dialog and form footers. */
  align?: 'start' | 'end' | 'between';
}

/** Groups related buttons and gives them one accessible name. */
export const ButtonGroup = forwardRef<HTMLDivElement, ButtonGroupProps>(function ButtonGroup(
  { appearance = 'spaced', orientation = 'horizontal', align = 'start', className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      role="group"
      className={cx(styles.group, styles[appearance], styles[orientation], styles[`align-${align}`], className)}
      {...rest}
    />
  );
});
