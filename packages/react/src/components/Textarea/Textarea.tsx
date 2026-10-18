import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Input as BaseInput } from '@base-ui/react/input';
import { cx } from '../../utils/cx';
import { Field, useFieldContext } from '../Field';
import styles from './Textarea.module.css';

/** `field` is the boxed form control; `inline` reads like the text around it and shows it is editable on hover and focus. */
export type TextareaAppearance = 'field' | 'inline';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Visible label. When set, the Textarea wraps itself in a Field. Leave unset inside a Field. */
  label?: string;
  /** Helper text under the label. */
  hint?: ReactNode;
  /** Error message. Marks the textarea invalid and announces the message. */
  error?: ReactNode;
  /**
   * `field` (default) is the boxed form control. `inline` edits existing text in place: no border, no resize handle,
   * the surrounding font, size and line height, and a height that always fits the content (`rows`, `maxRows` and
   * `autosize` are ignored). Never use `inline` in a form.
   */
  appearance?: TextareaAppearance;
  /** Minimum visible lines. Default 3. Ignored by `appearance="inline"`, which always fits its content. */
  rows?: number;
  /** Grow with the content up to this many lines, then scroll. Default 12. Ignored by `appearance="inline"`. */
  maxRows?: number;
  /** Grow with the content. Default true. When false the user can resize vertically. Ignored by `appearance="inline"`. */
  autosize?: boolean;
  /** Show "used / maxLength" under the field. Needs maxLength. */
  showCount?: boolean;
  /** Visually hide the Field label. Only with `label`. */
  hideLabel?: boolean;
  /** Called with the new string value on every change. */
  onValueChange?: (value: string) => void;
}

/** True where CSS sizes the textarea to its content (`field-sizing: content`), so no measuring is needed. */
const cssSizing = () => typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');

/** Measures before paint in the browser, and stays silent during server rendering. */
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Multi-line text that grows with its content. Base UI Field control rendered as a textarea. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, appearance = 'field', rows = 3, maxRows = 12, autosize = true, showCount = false, hideLabel, className, required, onValueChange, onChange, style, ...rest },
  ref,
) {
  const field = useFieldContext();
  const inline = appearance === 'inline';
  const innerRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);
  const initial = String(rest.value ?? rest.defaultValue ?? '');
  const [length, setLength] = useState(initial.length);

  const resize = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    if (inline) {
      // CSS sizes the inline field where field-sizing is supported. Elsewhere measure it before paint, keeping the
      // page still: collapsing the height for a moment would otherwise scroll the caret into view.
      if (cssSizing()) return;
      const y = window.scrollY;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
      if (window.scrollY !== y) window.scrollTo({ top: y });
      return;
    }
    if (!autosize) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [autosize, inline]);

  useBeforePaint(() => {
    resize();
  }, [resize, rest.value]);

  // Inline text rewraps when its column changes width: measure again (fallback path only).
  useEffect(() => {
    const el = innerRef.current;
    if (!inline || !el || cssSizing() || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => resize());
    ro.observe(el.parentElement ?? el);
    return () => ro.disconnect();
  }, [inline, resize]);

  const counter = showCount && rest.maxLength ? `${length} / ${rest.maxLength}` : null;
  const control = (
    <div className={cx(styles.wrapper, inline && styles.inlineWrapper, className)}>
      <BaseInput
        render={<textarea ref={innerRef} rows={inline ? 1 : rows} />}
        className={cx(styles.textarea, inline ? styles.inline : autosize ? styles.autosize : styles.resizable)}
        style={inline ? style : { ['--_min-rows' as string]: rows, ['--_max-rows' as string]: maxRows, ...style }}
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
