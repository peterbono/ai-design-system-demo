import { forwardRef, useEffect, useId, useRef, type FormHTMLAttributes, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { Form as BaseForm } from '@base-ui/react/form';
import { CircleAlert } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Icon } from '../Icon';
import styles from './Form.module.css';

export type FormErrors = Record<string, string | string[]>;
export type FormValidationMode = 'onSubmit' | 'onBlur' | 'onChange';

export interface FormProps extends Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> {
  /**
   * Errors returned by the server after submit, keyed by field name. Each one shows under its Field and,
   * with `errorSummary`, in a list at the top. A field's error clears when its value changes.
   */
  errors?: FormErrors;
  /** Called with the form values (keyed by name) when the form is valid and submitted. */
  onFormSubmit?: (values: Record<string, unknown>) => void;
  /** When fields validate. Default `onSubmit`, then live once a field has been shown as invalid. */
  validationMode?: FormValidationMode;
  /** Show a summary of `errors` above the fields, with links that move focus to each field. Default true. */
  errorSummary?: boolean;
  /** Heading of the summary. Default "Fix {n} fields to continue". */
  errorSummaryTitle?: (count: number) => ReactNode;
  children?: ReactNode;
}

const defaultTitle = (n: number) => (n === 1 ? 'Fix 1 field to continue' : `Fix ${n} fields to continue`);

function focusField(form: HTMLFormElement | null, name: string) {
  if (!form) return;
  const target = form.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`);
  if (!target) return;
  const focusable =
    target instanceof HTMLInputElement && target.type === 'hidden'
      ? target.parentElement?.querySelector<HTMLElement>('[role="checkbox"], [role="switch"], [role="radio"], [role="combobox"], [role="slider"], input:not([type="hidden"]), button, textarea')
      : target;
  focusable?.focus();
}

/**
 * A form with consolidated validation (Base UI Form). Client checks run on submit; server errors passed in
 * `errors` land on the matching Field and in an error summary that takes focus.
 */
export const Form = forwardRef<HTMLFormElement, FormProps>(function Form(
  { errors, onFormSubmit, validationMode = 'onSubmit', errorSummary = true, errorSummaryTitle = defaultTitle, className, children, ...rest },
  ref,
) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const entries = Object.entries(errors ?? {}).flatMap(([name, msg]) => (Array.isArray(msg) ? msg : [msg]).map((m) => [name, m] as const));

  // Move focus to the summary when a new set of server errors arrives, so keyboard and screen reader users land on it.
  useEffect(() => {
    if (errorSummary && entries.length) summaryRef.current?.focus();
  }, [errors]);

  const setRefs = (el: HTMLFormElement | null) => {
    formRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  return (
    <BaseForm
      ref={setRefs}
      className={cx(styles.form, className)}
      errors={errors}
      validationMode={validationMode}
      onFormSubmit={onFormSubmit ? (values: Record<string, unknown>) => onFormSubmit(values) : undefined}
      noValidate
      {...rest}
    >
      {errorSummary && entries.length > 0 && (
        <div ref={summaryRef} className={styles.summary} role="alert" tabIndex={-1} aria-labelledby={titleId}>
          <Icon icon={CircleAlert} size="md" className={styles.summaryIcon} />
          <div className={styles.summaryBody}>
            <p id={titleId} className={styles.summaryTitle}>
              {errorSummaryTitle(entries.length)}
            </p>
            <ul className={styles.summaryList}>
              {entries.map(([name, message]) => (
                <li key={`${name}-${message}`}>
                  <a
                    className={styles.summaryLink}
                    href={`#${name}`}
                    onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                      event.preventDefault();
                      focusField(formRef.current, name);
                    }}
                  >
                    {message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {children}
    </BaseForm>
  );
});

export interface FormActionsProps extends HTMLAttributes<HTMLDivElement> {
  /** Default `end`: primary action last, at the right edge. */
  align?: 'start' | 'end' | 'between';
}

/** Footer row for the form's buttons. Primary action last. */
export function FormActions({ align = 'end', className, ...rest }: FormActionsProps) {
  return <div className={cx(styles.actions, styles[`align-${align}`], className)} {...rest} />;
}
