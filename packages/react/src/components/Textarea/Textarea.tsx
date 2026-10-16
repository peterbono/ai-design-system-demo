import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ChangeEvent, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Input as BaseInput } from '@base-ui/react/input';
import { cx } from '../../utils/cx';
import { Field, useFieldContext } from '../Field';
import styles from './Textarea.module.css';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Visible label. When set, the Textarea wraps itself in a Field. Leave unset inside a Field. */
  label?: string;
  /** Helper text under the label. */
  hint?: ReactNode;
  /** Error message. Marks the textarea invalid and announces the message. */
  error?: ReactNode;
  /** Minimum visible lines. Default 3. */
  rows?: number;
  /** Grow with the content up to this many lines, then scroll. Default 12. */
  maxRows?: number;
  /** Grow with the content. Default true. When false the user can resize vertically. */
  autosize?: boolean;
  /** Show "used / maxLength" under the field. Needs maxLength. */
  showCount?: boolean;
  /** Visually hide the Field label. Only with `label`. */
  hideLabel?: boolean;
  /** Called with the new string value on every change. */
  onValueChange?: (value: string) => void;
}

/** Multi-line text that grows with its content. Base UI Field control rendered as a textarea. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, rows = 3, maxRows = 12, autosize = true, showCount = false, hideLabel, className, required, onValueChange, onChange, style, ...rest },
  ref,
) {
  const field = useFieldContext();
  const innerRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);
  const initial = String(rest.value ?? rest.defaultValue ?? '');
  const [length, setLength] = useState(initial.length);

  const resize = useCallback(() => {
    const el = innerRef.current;
    if (!el || !autosize) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [autosize]);

  useEffect(() => {
    resize();
  }, [resize, rest.value]);

  const counter = showCount && rest.maxLength ? `${length} / ${rest.maxLength}` : null;
  const control = (
    <div className={cx(styles.wrapper, className)}>
      <BaseInput
        render={<textarea ref={innerRef} rows={rows} />}
        className={cx(styles.textarea, autosize ? styles.autosize : styles.resizable)}
        style={{ ['--_min-rows' as string]: rows, ['--_max-rows' as string]: maxRows, ...style }}
        required={required ?? (field.required || undefined)}
        onChange={((event: ChangeEvent<HTMLTextAreaElement>) => {
          setLength(event.target.value.length);
          resize();
          onChange?.(event);
          onValueChange?.(event.target.value);
        }) as never}
        {...(rest as Record<string, unknown>)}
      />
      {counter && (
        <span className={styles.count} aria-hidden="true">
          {counter}
        </span>
      )}
    </div>
  );
  if (label === undefined) return control;
  return (
    <Field label={label} description={hint} error={error} required={required} disabled={rest.disabled} name={rest.name} hideLabel={hideLabel}>
      {control}
    </Field>
  );
});
