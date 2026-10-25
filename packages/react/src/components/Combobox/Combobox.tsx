import { forwardRef, useMemo, useRef, type InputHTMLAttributes, type ReactNode, type RefObject } from 'react';
import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { Check, ChevronDown, X } from 'lucide-react';
import { cx } from '../../utils/cx';
import { useScopeAttributes } from '../../theme';
import { Field, useFieldContext } from '../Field';
import { Icon } from '../Icon';
import { Spinner } from '../Spinner';
import styles from './Combobox.module.css';

export type ComboboxSize = 'sm' | 'md' | 'lg';

export interface ComboboxOption {
  /** Submitted value, unique in the list. */
  value: string;
  /** Visible text, used for filtering and in the input after selection. */
  label: string;
  /** Optional second line, for example an email under a reviewer name. */
  description?: string;
  disabled?: boolean;
  /** Group heading. Options with the same group render under one label. */
  group?: string;
}

type ComboboxValue = string | string[] | null;

export interface ComboboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'size' | 'prefix' | 'children'> {
  /** The options to filter. For async search, pass the latest results and set `filter={null}`. */
  options: ComboboxOption[];
  /** Pick several values, shown as removable chips. */
  multiple?: boolean;
  /** Selected value (controlled): a string, an array with `multiple`, or null. */
  value?: ComboboxValue;
  /** Initially selected value (uncontrolled). */
  defaultValue?: ComboboxValue;
  /** Called with the new value (string, string[] with `multiple`, or null). */
  onValueChange?: (value: ComboboxValue) => void;
  /** Text in the input (controlled). Use it to drive an async search. */
  inputValue?: string;
  defaultInputValue?: string;
  /** Called on every keystroke with the query. */
  onInputValueChange?: (inputValue: string) => void;
  /** Custom matcher, or `null` to show `options` as given (already filtered by a server). Default: case and accent insensitive "contains". */
  filter?: ((option: ComboboxOption, query: string) => boolean) | null;
  /** Results are loading: shows a spinner row, sets aria-busy and announces `loadingMessage`. */
  loading?: boolean;
  /** Announced and shown while loading. Default "Loading results". */
  loadingMessage?: string;
  /** Shown when no option matches. Say what to try next. */
  emptyMessage?: ReactNode;
  /** Visible label. When set, the Combobox wraps itself in a Field. Leave unset inside a Field. */
  label?: string;
  /** Help under the label (Field description). Only with `label`. */
  hint?: ReactNode;
  /** Error message. Only with `label`. */
  error?: ReactNode;
  hideLabel?: boolean;
  /** Height follows the density tokens. Default `md`. */
  size?: ComboboxSize;
  /** Content before the query, usually a search Icon. */
  prefix?: ReactNode;
  /** Popup open state (controlled). */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Where the popup is rendered. Default: the end of the body, above every layer including a Dialog or Drawer, so
   * the list is never covered. Pass an element (or a ref) to keep it inside a container, for example a shadow root.
   */
  portalContainer?: HTMLElement | ShadowRoot | RefObject<HTMLElement | ShadowRoot | null> | null;
}

interface OptionGroup {
  label: string;
  items: ComboboxOption[];
}

const optionLabel = (o: ComboboxOption) => o.label;
const sameOption = (a: ComboboxOption, b: ComboboxOption) => a.value === b.value;

/**
 * Text input that filters a list of options and selects one or several of them. Base UI Combobox, wired to Field.
 * Async friendly: control `inputValue`, fetch, pass the results as `options` with `filter={null}` and `loading`.
 */
export const Combobox = forwardRef<HTMLInputElement, ComboboxProps>(function Combobox(
  {
    options,
    multiple = false,
    value,
    defaultValue,
    onValueChange,
    inputValue,
    defaultInputValue,
    onInputValueChange,
    filter,
    loading = false,
    loadingMessage = 'Loading results',
    emptyMessage = 'No matches. Try another name.',
    label,
    hint,
    error,
    hideLabel,
    required,
    disabled,
    readOnly,
    name,
    size = 'md',
    prefix,
    placeholder,
    open,
    defaultOpen,
    onOpenChange,
    portalContainer,
    className,
    ...rest
  },
  ref,
) {
  const field = useFieldContext();
  const scope = useScopeAttributes();

  // Remember every option seen, so a selected value keeps its label when async results change.
  const known = useRef(new Map<string, ComboboxOption>());
  for (const o of options) known.current.set(o.value, o);
  const toOption = (v: string): ComboboxOption => known.current.get(v) ?? { value: v, label: v };
  const toInternal = (v: ComboboxValue | undefined) => {
    if (v === undefined) return undefined;
    if (v === null) return multiple ? [] : null;
    return Array.isArray(v) ? v.map(toOption) : toOption(v);
  };

  // The listbox carries the field's name too. While it closes it stays in the page for its exit motion, no longer
  // referenced by the input, and an unnamed listbox there is announced as an anonymous list.
  const labelledBy = rest['aria-labelledby'];
  const listName = labelledBy ? undefined : (rest['aria-label'] ?? label);

  const grouped = options.some((o) => o.group);
  const items = useMemo<ComboboxOption[] | OptionGroup[]>(() => {
    if (!grouped) return options;
    const groups: OptionGroup[] = [];
    for (const o of options) {
      const g = groups.find((x) => x.label === (o.group ?? ''));
      if (g) g.items.push(o);
      else groups.push({ label: o.group ?? '', items: [o] });
    }
    return groups;
  }, [options, grouped]);

  const renderItem = (o: ComboboxOption) => (
    <BaseCombobox.Item key={o.value} value={o} disabled={o.disabled} className={styles.item}>
      <span className={styles.itemBody}>
        <span className={styles.itemText}>{o.label}</span>
        {o.description && <span className={styles.itemDescription}>{o.description}</span>}
      </span>
      <BaseCombobox.ItemIndicator className={styles.indicator}>
        <Icon icon={Check} size="sm" />
      </BaseCombobox.ItemIndicator>
    </BaseCombobox.Item>
  );

  const input = (extraPlaceholder?: string) => (
    <BaseCombobox.Input
      ref={ref}
      className={styles.input}
      placeholder={extraPlaceholder ?? placeholder}
      required={required ?? (field.required || undefined)}
      aria-invalid={field.invalid || (error ? true : undefined)}
      {...rest}
    />
  );

  const combobox = (
    <BaseCombobox.Root
      items={items}
      multiple={multiple as never}
      value={toInternal(value) as never}
      defaultValue={toInternal(defaultValue) as never}
      onValueChange={
        onValueChange
          ? (next: unknown) => {
              if (Array.isArray(next)) onValueChange((next as ComboboxOption[]).map((o) => o.value));
              else onValueChange(next ? (next as ComboboxOption).value : null);
            }
          : undefined
      }
      inputValue={inputValue}
      defaultInputValue={defaultInputValue}
      onInputValueChange={onInputValueChange ? (next: string) => onInputValueChange(next) : undefined}
      filter={filter === null ? null : filter ? (item: unknown, query: string) => filter(item as ComboboxOption, query) : undefined}
      itemToStringLabel={optionLabel}
      itemToStringValue={(o: ComboboxOption) => o.value}
      isItemEqualToValue={sameOption}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange ? (next: boolean) => onOpenChange(next) : undefined}
      disabled={disabled}
      readOnly={readOnly}
      required={required ?? (field.required || undefined)}
      name={name}
    >
      <BaseCombobox.InputGroup className={cx(styles.control, styles[size], multiple && styles.multiple, className)} data-pseudo-root="">
        {prefix != null && <span className={styles.affix}>{prefix}</span>}
        {multiple ? (
          <BaseCombobox.Value>
            {(selected: ComboboxOption[]) => (
              <BaseCombobox.Chips className={styles.chips} aria-label={selected.length > 0 ? 'Selected options' : undefined}>
                {selected.map((o) => (
                  <BaseCombobox.Chip key={o.value} className={styles.chip} aria-label={o.label}>
                    <span className={styles.chipText} title={o.label}>{o.label}</span>
                    <BaseCombobox.ChipRemove className={styles.chipRemove} aria-label={`Remove ${o.label}`}>
                      <Icon icon={X} size="xs" />
                    </BaseCombobox.ChipRemove>
                  </BaseCombobox.Chip>
                ))}
                {input(selected.length > 0 ? '' : undefined)}
              </BaseCombobox.Chips>
            )}
          </BaseCombobox.Value>
        ) : (
          input()
        )}
        {!multiple && !disabled && (
          <BaseCombobox.Clear className={styles.iconAction} aria-label="Clear selection">
            <Icon icon={X} size="sm" />
          </BaseCombobox.Clear>
        )}
        <BaseCombobox.Trigger className={cx(styles.iconAction, styles.trigger)} aria-label="Show options">
          <Icon icon={ChevronDown} size="sm" />
        </BaseCombobox.Trigger>
      </BaseCombobox.InputGroup>
      <BaseCombobox.Portal container={portalContainer ?? undefined}>
        <BaseCombobox.Positioner className={styles.positioner} sideOffset={4} {...scope}>
          <BaseCombobox.Popup className={styles.popup} aria-busy={loading || undefined}>
            <BaseCombobox.Status className={styles.status}>
              {loading ? (
                <>
                  <Spinner size="sm" tone="signal" />
                  <span>{loadingMessage}</span>
                </>
              ) : null}
            </BaseCombobox.Status>
            {!loading && <BaseCombobox.Empty className={styles.empty}>{emptyMessage}</BaseCombobox.Empty>}
            <BaseCombobox.List className={styles.list} aria-labelledby={labelledBy} aria-label={listName}>
              {grouped
                ? (group: OptionGroup) => (
                    <BaseCombobox.Group key={group.label} items={group.items} className={styles.group}>
                      <BaseCombobox.GroupLabel className={styles.groupLabel}>{group.label}</BaseCombobox.GroupLabel>
                      <BaseCombobox.Collection>{renderItem}</BaseCombobox.Collection>
                    </BaseCombobox.Group>
                  )
                : renderItem}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );

  if (label === undefined) return combobox;
  return (
    <Field label={label} description={hint} error={error} required={required} disabled={disabled} hideLabel={hideLabel}>
      {combobox}
    </Field>
  );
});
