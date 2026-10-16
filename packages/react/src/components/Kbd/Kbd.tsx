import { forwardRef, Fragment, type HTMLAttributes } from 'react';
import { cx } from '../../utils/cx';
import styles from './Kbd.module.css';

export interface KbdProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** One key ("Esc") or a combination (["Cmd", "K"]) pressed together. */
  keys: string | string[];
  size?: 'sm' | 'md';
}

const NAMES: Record<string, string> = {
  Cmd: 'Command',
  '⌘': 'Command',
  Ctrl: 'Control',
  Alt: 'Option',
  '⌥': 'Option',
  Shift: 'Shift',
  '⇧': 'Shift',
  Esc: 'Escape',
  '↵': 'Enter',
  '↑': 'Up arrow',
  '↓': 'Down arrow',
  '←': 'Left arrow',
  '→': 'Right arrow',
};

/**
 * Keyboard keys, as nested `<kbd>` elements (the HTML pattern for a key combination).
 * Abbreviations get a title with the full key name.
 */
export const Kbd = forwardRef<HTMLElement, KbdProps>(function Kbd({ keys, size = 'md', className, ...rest }, ref) {
  const list = Array.isArray(keys) ? keys : [keys];
  return (
    <kbd ref={ref} className={cx(styles.combo, styles[size], className)} {...rest}>
      {list.map((key, i) => (
        <Fragment key={`${key}-${i}`}>
          {i > 0 && (
            <span className={styles.plus} aria-hidden="true">
              +
            </span>
          )}
          <kbd className={styles.key} title={NAMES[key]}>
            {key}
          </kbd>
        </Fragment>
      ))}
    </kbd>
  );
});
