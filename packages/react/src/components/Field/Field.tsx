import { createContext, forwardRef, useContext, type HTMLAttributes, type ReactNode } from 'react';
import { Field as BaseField } from '@base-ui/react/field';
import { CircleAlert } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Icon } from '../Icon';
import styles from './Field.module.css';

export type FieldValidationMode = 'onSubmit' | 'onBlur' | 'onChange';

export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Visible label. Required: placeholders are not labels. */
  label: ReactNode;
  /** Help shown under the label, before the control: format, constraints, privacy notes. */
  description?: ReactNode;
  /**
   * Error message. When set, the field is invalid and the message is announced through aria-describedby.
   * Leave it unset to show the browser's validation message after a failed submit.
   */
  error?: ReactNode;
  /** Marks the control as required (adds `required` to our controls and a visual marker to the label). */
  required?: boolean;
  disabled?: boolean;
  /** Name used by Form for submit values and server errors. */
  name?: string;
  /** Custom validation. Return an error string (or strings) to mark the field invalid. */
  validate?: (value: unknown) => string | string[] | null | undefined | Promise<string | string[] | null | undefined>;
  /** When validation runs. Default `onSubmit` (inherits Form). */
  validationMode?: FieldValidationMode;
  /** Visually hide the label (it stays the accessible name). Use only when the context labels the field, like a search bar. */
  hideLabel?: boolean;
  /** The control: Input, Textarea, Select, Combobox, NumberField, Slider. */
  children: ReactNode;
}

interface FieldContextValue {
  required: boolean;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue>({ required: false, invalid: false });

/** Read by our form controls to pick up `required` and the invalid state from the surrounding Field. */
export function useFieldContext() {
  return useContext(FieldContext);
}

/**
 * Wires a label, a description and an error to one control (Base UI Field): ids, aria-describedby,
 * aria-invalid and validation are handled for you.
 */
export const Field = forwardRef<HTMLDivElement, FieldProps>(function Field(
  { label, description, error, required = false, disabled, name, validate, validationMode, hideLabel = false, className, children, ...rest },
  ref,
) {
  const invalid = error != null && error !== false && error !== '';
  return (
    <FieldContext.Provider value={{ required, invalid }}>
      <BaseField.Root
        ref={ref}
        name={name}
        disabled={disabled}
        invalid={invalid || undefined}
        validate={validate as never}
        validationMode={validationMode}
        className={cx(styles.field, className)}
        {...rest}
      >
        <BaseField.Label className={cx(styles.label, hideLabel && styles.hiddenLabel)}>
          {label}
          {required && (
            <span className={styles.required} aria-hidden="true">
              *
            </span>
          )}
        </BaseField.Label>
        {description && <BaseField.Description className={styles.description}>{description}</BaseField.Description>}
        {children}
        {invalid ? (
          <BaseField.Error className={styles.error} match>
            <Icon icon={CircleAlert} size="xs" className={styles.errorIcon} />
            <span>{error}</span>
          </BaseField.Error>
        ) : (
          <BaseField.Error className={styles.error} render={(props) => (
            <div {...props}>
              <Icon icon={CircleAlert} size="xs" className={styles.errorIcon} />
              <span>{props.children}</span>
            </div>
          )} />
        )}
      </BaseField.Root>
    </FieldContext.Provider>
  );
});
