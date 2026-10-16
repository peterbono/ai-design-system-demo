import type { ReactNode } from 'react';
import {
  ReferenceInputBase,
  useChoicesContext,
  useInput,
  useTranslate,
  type InputProps,
  type RaRecord,
} from 'ra-core';
import {
  Checkbox,
  Combobox,
  Input,
  NumberField,
  Select,
  Switch,
  Textarea,
  type ComboboxOption,
  type SelectOption,
} from '@demo-ds/react';

/**
 * Bridge form controls bound to ra-core with useInput: value, change, blur, validation and the
 * required marker come from react-hook-form through ra-core. Errors show after touch or submit.
 */

interface BaseProps extends Pick<InputProps, 'source' | 'validate' | 'defaultValue' | 'format' | 'parse'> {
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}

function useError(state: ReturnType<typeof useInput>) {
  const translate = useTranslate();
  const { fieldState, formState } = state;
  if (!fieldState.invalid || !(fieldState.isTouched || formState.isSubmitted)) return undefined;
  const err = fieldState.error?.message as unknown;
  if (!err) return translate('ra.validation.required', { _: 'Required' });
  if (typeof err === 'string') return translate(err, { _: err });
  const obj = err as { message?: string; args?: Record<string, unknown> };
  return obj.message ? translate(obj.message, { _: obj.message, ...obj.args }) : undefined;
}

export interface TextInputProps extends BaseProps {
  type?: 'text' | 'email' | 'url' | 'tel' | 'password';
  placeholder?: string;
  autoComplete?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
}

export function TextInput({ label, hint, type = 'text', placeholder, autoComplete, prefix, suffix, disabled, readOnly, className, ...props }: TextInputProps) {
  const state = useInput(props);
  const { field, isRequired, id } = state;
  return (
    <Input
      id={id}
      label={label}
      hint={hint}
      error={useError(state)}
      type={type}
      required={isRequired}
      placeholder={placeholder}
      autoComplete={autoComplete}
      prefix={prefix}
      suffix={suffix}
      disabled={disabled}
      readOnly={readOnly}
      className={className}
      name={field.name}
      value={field.value ?? ''}
      onChange={field.onChange}
      onBlur={field.onBlur}
      ref={field.ref}
    />
  );
}

export function TextareaInput({ label, hint, rows = 4, disabled, readOnly, className, ...props }: BaseProps & { rows?: number }) {
  const state = useInput(props);
  const { field, isRequired, id } = state;
  return (
    <Textarea
      id={id}
      label={label}
      hint={hint}
      error={useError(state)}
      rows={rows}
      autosize
      required={isRequired}
      disabled={disabled}
      readOnly={readOnly}
      className={className}
      name={field.name}
      value={field.value ?? ''}
      onChange={field.onChange}
      onBlur={field.onBlur}
      ref={field.ref}
    />
  );
}

export function NumberInput({
  label,
  hint,
  min,
  max,
  step,
  format: numberFormat,
  suffix,
  disabled,
  readOnly,
  className,
  ...props
}: Omit<BaseProps, 'format'> & { min?: number; max?: number; step?: number; format?: Intl.NumberFormatOptions; suffix?: ReactNode }) {
  const state = useInput(props);
  const { field, isRequired, id } = state;
  return (
    <NumberField
      id={id}
      label={label}
      hint={hint}
      error={useError(state)}
      min={min}
      max={max}
      step={step}
      format={numberFormat}
      suffix={suffix}
      required={isRequired}
      disabled={disabled}
      readOnly={readOnly}
      className={className}
      name={field.name}
      value={field.value ?? null}
      onValueChange={(v) => {
        field.onChange(v);
      }}
      ref={field.ref}
    />
  );
}

export interface Choice {
  id: string | number;
  name: string;
  description?: string;
}

const toOptions = (choices: Choice[]): SelectOption[] => choices.map((c) => ({ value: String(c.id), label: c.name, description: c.description }));

export function SelectInput({ label, hint, choices, placeholder, disabled, className, ...props }: BaseProps & { choices: Choice[]; placeholder?: string }) {
  const state = useInput(props);
  const { field, isRequired } = state;
  const byString = new Map(choices.map((c) => [String(c.id), c.id]));
  return (
    <Select
      label={label}
      hint={hint}
      error={useError(state)}
      required={isRequired}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      options={toOptions(choices)}
      value={field.value == null ? null : String(field.value)}
      onValueChange={(v) => {
        field.onChange(v == null ? null : byString.get(v) ?? v);
        field.onBlur();
      }}
    />
  );
}

export function BooleanInput({ label, hint, disabled, className, ...props }: BaseProps) {
  const { field } = useInput({ ...props, type: 'checkbox' });
  return (
    <Switch
      label={label}
      description={hint}
      disabled={disabled}
      className={className}
      checked={Boolean(field.value)}
      onCheckedChange={(checked) => {
        field.onChange(checked);
        field.onBlur();
      }}
    />
  );
}

export function CheckboxInput({ label, hint, disabled, className, ...props }: BaseProps) {
  const { field } = useInput({ ...props, type: 'checkbox' });
  return (
    <Checkbox
      label={label}
      description={hint}
      disabled={disabled}
      className={className}
      checked={Boolean(field.value)}
      onCheckedChange={(checked) => {
        field.onChange(checked);
        field.onBlur();
      }}
    />
  );
}

export function DateInput({ label, hint, disabled, className, ...props }: BaseProps) {
  const state = useInput({
    format: (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : v instanceof Date ? v.toISOString().slice(0, 10) : ''),
    ...props,
  });
  const { field, isRequired, id } = state;
  return (
    <Input
      id={id}
      label={label}
      hint={hint}
      error={useError(state)}
      type="date"
      required={isRequired}
      disabled={disabled}
      className={className}
      name={field.name}
      value={field.value ?? ''}
      onChange={field.onChange}
      onBlur={field.onBlur}
      ref={field.ref}
    />
  );
}

/** Multiple choice from a known list, as a Combobox with chips. */
export function MultiChoiceInput({ label, hint, choices, placeholder, disabled, ...props }: BaseProps & { choices: Choice[]; placeholder?: string }) {
  const state = useInput({ defaultValue: [], ...props });
  const { field, isRequired } = state;
  const value: string[] = Array.isArray(field.value) ? field.value.map(String) : [];
  return (
    <Combobox
      label={label}
      hint={hint}
      error={useError(state)}
      required={isRequired}
      disabled={disabled}
      placeholder={placeholder}
      multiple
      options={choices.map((c) => ({ value: String(c.id), label: c.name }))}
      value={value}
      onValueChange={(v) => {
        field.onChange(Array.isArray(v) ? v : v == null ? [] : [v]);
        field.onBlur();
      }}
    />
  );
}

/**
 * Pick a related record (ra-core ReferenceInputBase) with a searchable Combobox. Typing sends the
 * query to the data provider as the `q` filter.
 */
export function ReferenceInput<R extends RaRecord = RaRecord>({
  source,
  reference,
  label,
  hint,
  optionText,
  validate,
  perPage = 25,
  sortField = 'id',
}: {
  source: string;
  reference: string;
  label: string;
  hint?: ReactNode;
  optionText: (record: R) => string;
  validate?: InputProps['validate'];
  perPage?: number;
  sortField?: string;
}) {
  return (
    <ReferenceInputBase source={source} reference={reference} perPage={perPage} sort={{ field: sortField, order: 'ASC' }}>
      <ReferenceCombobox<R> source={source} label={label} hint={hint} optionText={optionText} validate={validate} />
    </ReferenceInputBase>
  );
}

function ReferenceCombobox<R extends RaRecord>({
  source,
  label,
  hint,
  optionText,
  validate,
}: {
  source: string;
  label: string;
  hint?: ReactNode;
  optionText: (record: R) => string;
  validate?: InputProps['validate'];
}) {
  const translate = useTranslate();
  const { allChoices, isPending, setFilters, filterValues } = useChoicesContext<R>();
  const state = useInput({ source, validate });
  const { field, isRequired } = state;
  const options: ComboboxOption[] = (allChoices ?? []).map((r) => ({ value: String(r.id), label: optionText(r) }));
  const byString = new Map((allChoices ?? []).map((r) => [String(r.id), r.id]));
  return (
    <Combobox
      label={label}
      hint={hint}
      error={useError(state)}
      required={isRequired}
      options={options}
      filter={null}
      loading={isPending}
      emptyMessage={translate('bridge.form.no_match', { _: 'No match. Try another name.' })}
      value={field.value == null ? null : String(field.value)}
      onInputValueChange={(q) => setFilters({ ...filterValues, q }, undefined, true)}
      onValueChange={(v) => {
        const one = Array.isArray(v) ? v[0] : v;
        field.onChange(one == null ? null : byString.get(one) ?? one);
        field.onBlur();
      }}
    />
  );
}
