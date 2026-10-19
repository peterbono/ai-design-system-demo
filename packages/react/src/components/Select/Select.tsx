import { forwardRef, Fragment, useMemo, type ButtonHTMLAttributes, type ReactNode, type RefObject } from 'react';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { cx } from '../../utils/cx';
import { useScopeAttributes } from '../../theme';
import { Field, useFieldContext } from '../Field';
import { Icon } from '../Icon';
import styles from './Select.module.css';

export type SelectSize = 'sm' | 'md' | 'lg';

export interface SelectOption {
  /** Submitted value. */
  value: string;
  /** Visible text, also used for typeahead. */
  label: string;
  /** Optional second line under the label. */
  description?: string;
  disabled?: boolean;
  /** Group heading. Consecutive options with the same group are rendered under one label. */
  group?: string;
  /**
   * A Badge (or Tag) after the label: a count, a status. Shown on the item and, when this option is selected, in the
   * trigger. Its text is part of what assistive tech reads for the option, so keep it short ("In review", "3").
   */
  badge?: ReactNode;
}

export interface SelectProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'defaultValue' | 'onChange' | 'prefix' | 'children'> {
  /** The choices. Keep them under about ten; use Combobox for long or searchable lists. */
  options: SelectOption[];
  /** Text shown when nothing is selected. Describe the choice, not the action: "No theme". */
  placeholder?: string;
  /** Selected value (controlled). `null` means nothing selected. */
  value?: string | null;
  /** Initially selected value (uncontrolled). */
  defaultValue?: string | null;
  /** Called with the new value when the user picks an option. */
  onValueChange?: (value: string | null) => void;
  /** Visible label. When set, the Select wraps itself in a Field. Leave unset inside a Field. */
  label?: string;
  /** Help under the label (Field description). Only with `label`. */
  hint?: ReactNode;
  /** Error message. Marks the select invalid and announces the message. Only with `label`. */
  error?: ReactNode;
  /** Visually hide the Field label (it stays the accessible name). */
  hideLabel?: boolean;
  required?: boolean;
  /** Name for form submission (a hidden input carries the value). */
  name?: string;
  /** Height follows the density tokens. Default `md`. */
  size?: SelectSize;
  /** Content before the value, usually an Icon. */
  prefix?: ReactNode;
  /** Popup open state (controlled). */
  open?: boolean;
  /** Open on first render (uncontrolled). */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Where the popup is rendered. Default: the end of the body, above every layer including a Dialog or Drawer, so
   * the list is never covered. Pass an element (or a ref) to keep it inside a container, for example a shadow root.
   */
  portalContainer?: HTMLElement | ShadowRoot | RefObject<HTMLElement | ShadowRoot | null> | null;
}

interface OptionGroup {
  group: string | undefined;
  options: SelectOption[];
}

function groupOptions(options: SelectOption[]): OptionGroup[] {
  const groups: OptionGroup[] = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last && last.group === option.group) last.options.push(option);
    else groups.push({ group: option.group, options: [option] });
  }
  return groups;
}

/** Picks one value from a short list in a popup. Base UI Select, styled like Input, wired to Field. */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    options,
    placeholder = 'Select an option',
    value,
    defaultValue,
    onValueChange,
    label,
    hint,
    error,
    hideLabel,
    required,
    disabled,
    name,
    size = 'md',
    prefix,
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
  const items = useMemo(() => options.map((o) => ({ value: o.value, label: o.label })), [options]);
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const hasBadges = options.some((o) => o.badge != null);
  const groups = useMemo(() => groupOptions(options), [options]);

  const select = (
    <BaseSelect.Root
      items={items}
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange ? (next) => onValueChange((next as string | null) ?? null) : undefined}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}
      required={required ?? (field.required || undefined)}
      disabled={disabled}
      name={name}
    >
      <BaseSelect.Trigger
        ref={ref}
        className={cx(styles.trigger, styles[size], className)}
        aria-invalid={field.invalid || (error ? true : undefined)}
        {...rest}
      >
        {prefix != null && <span className={styles.affix}>{prefix}</span>}
        {hasBadges ? (
          <BaseSelect.Value className={cx(styles.value, styles.valueWithBadge)} placeholder={placeholder}>
            {(v: string | null) => {
              const o = v == null ? undefined : byValue.get(v);
              if (!o) return v == null ? placeholder : v;
              return (
                <>
                  <span className={styles.valueText}>{o.label}</span>
                  {o.badge != null && <span className={styles.badge}>{o.badge}</span>}
                </>
              );
            }}
          </BaseSelect.Value>
        ) : (
          <BaseSelect.Value className={styles.value} placeholder={placeholder} />
        )}
        <BaseSelect.Icon className={styles.chevron}>
          <Icon icon={ChevronDown} size="sm" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal container={portalContainer ?? undefined}>
        <BaseSelect.Positioner className={styles.positioner} sideOffset={4} alignItemWithTrigger={false} {...scope}>
          <BaseSelect.Popup className={styles.popup}>
            <BaseSelect.List className={styles.list}>
              {groups.map((g, gi) => {
                const rendered = g.options.map((o) => (
                  <BaseSelect.Item key={o.value} value={o.value} label={o.label} disabled={o.disabled} className={styles.item}>
                    <span className={styles.itemBody}>
                      <BaseSelect.ItemText className={styles.itemText}>{o.label}</BaseSelect.ItemText>
                      {o.description && <span className={styles.itemDescription}>{o.description}</span>}
                    </span>
                    {o.badge != null && <span className={styles.badge}>{o.badge}</span>}
                    <BaseSelect.ItemIndicator keepMounted={hasBadges} className={cx(styles.indicator, hasBadges && styles.indicatorSlot)}>
                      <Icon icon={Check} size="sm" />
                    </BaseSelect.ItemIndicator>
                  </BaseSelect.Item>
                ));
                return (
                  <Fragment key={g.group ?? `ungrouped-${gi}`}>
                    {gi > 0 && <BaseSelect.Separator className={styles.separator} />}
                    {g.group ? (
                      <BaseSelect.Group className={styles.group}>
                        <BaseSelect.GroupLabel className={styles.groupLabel}>{g.group}</BaseSelect.GroupLabel>
                        {rendered}
                      </BaseSelect.Group>
                    ) : (
                      rendered
                    )}
                  </Fragment>
                );
              })}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );

  if (label === undefined) return select;
  return (
    <Field label={label} description={hint} error={error} required={required} disabled={disabled} hideLabel={hideLabel}>
      {select}
    </Field>
  );
});
