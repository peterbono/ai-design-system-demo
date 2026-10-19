import { forwardRef, isValidElement, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Check, ChevronRight } from 'lucide-react';
import { cx } from '../../utils/cx';
import { useScopeAttributes } from '../../theme';
import { Icon, type LucideIcon } from '../Icon';
import styles from './Menu.module.css';

export type MenuSide = 'top' | 'bottom' | 'left' | 'right' | 'inline-start' | 'inline-end';
export type MenuAlign = 'start' | 'center' | 'end';

export interface MenuProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Wrap focus from the last item to the first. Default true. */
  loopFocus?: boolean;
  /** MenuTrigger and MenuContent. */
  children?: ReactNode;
}

/**
 * A list of actions or options behind a trigger. Base UI Menu: arrow keys, typeahead, Home and End,
 * submenus with ArrowRight, Escape closes and returns focus.
 */
export function Menu({ open, defaultOpen, onOpenChange, loopFocus = true, children }: MenuProps) {
  return (
    <BaseMenu.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange ? (next: boolean) => onOpenChange(next) : undefined}
      loopFocus={loopFocus}
    >
      {children}
    </BaseMenu.Root>
  );
}

/** Opens the menu. Compose with our Button or IconButton: `<MenuTrigger render={<IconButton icon={MoreHorizontal} label="More actions" />} />`. */
export const MenuTrigger = BaseMenu.Trigger;

interface PopupProps extends HTMLAttributes<HTMLDivElement> {
  side?: MenuSide;
  align?: MenuAlign;
  sideOffset?: number;
  alignOffset?: number;
  children?: ReactNode;
}

const MenuPopup = forwardRef<HTMLDivElement, PopupProps>(function MenuPopup({ side, align, sideOffset, alignOffset, className, children, ...rest }, ref) {
  const scope = useScopeAttributes();
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        className={styles.positioner}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={8}
        {...scope}
      >
        <BaseMenu.Popup ref={ref} className={cx(styles.popup, className)} {...rest}>
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
});

export interface MenuContentProps extends HTMLAttributes<HTMLDivElement> {
  /** Default `bottom`. */
  side?: MenuSide;
  /** Default `start`: the menu lines up with the trigger's leading edge. */
  align?: MenuAlign;
  children?: ReactNode;
}

/** The floating list: MenuItem, MenuCheckboxItem, MenuRadioGroup, MenuGroup, MenuSeparator, MenuSubmenu. */
export const MenuContent = forwardRef<HTMLDivElement, MenuContentProps>(function MenuContent(
  { side = 'bottom', align = 'start', children, ...rest },
  ref,
) {
  return (
    <MenuPopup ref={ref} side={side} align={align} sideOffset={4} {...rest}>
      {children}
    </MenuPopup>
  );
});

export type MenuItemTone = 'default' | 'danger';

interface ItemDecor {
  /**
   * Icon before the label: a Lucide icon, or an element such as `<Icon icon={Figma} />` or a brand mark. Muted, and
   * hidden from assistive tech. When one item has an icon, every item keeps the slot so labels line up.
   */
  icon?: LucideIcon | ReactElement;
  /** Keyboard shortcut hint, shown muted at the end: "E", "Cmd+D". Purely visual; bind the shortcut yourself. */
  shortcut?: string;
}

export interface MenuItemProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onClick'>, ItemDecor {
  /** `danger` for destructive items. Put them last, after a separator. */
  tone?: MenuItemTone;
  disabled?: boolean;
  /** Fires on click, Enter and Space. */
  onClick?: () => void;
  /** Close the menu after activation. Default true. */
  closeOnClick?: boolean;
  /** Typeahead text when the children are not plain text. */
  label?: string;
}

function ItemContent({ icon, shortcut, children, end }: ItemDecor & { children: ReactNode; end?: ReactNode }) {
  return (
    <>
      <span className={styles.leading} aria-hidden="true">
        {icon && (isValidElement(icon) ? icon : <Icon icon={icon as LucideIcon} size="sm" />)}
      </span>
      <span className={styles.label}>{children}</span>
      {shortcut && (
        <kbd className={styles.shortcut} aria-hidden="true">
          {shortcut}
        </kbd>
      )}
      {end}
    </>
  );
}

/** An action. */
export const MenuItem = forwardRef<HTMLDivElement, MenuItemProps>(function MenuItem(
  { icon, shortcut, tone = 'default', disabled, onClick, closeOnClick = true, label, className, children, ...rest },
  ref,
) {
  return (
    <BaseMenu.Item
      ref={ref}
      disabled={disabled}
      onClick={onClick ? () => onClick() : undefined}
      closeOnClick={closeOnClick}
      label={label}
      className={cx(styles.item, tone === 'danger' && styles.danger, className)}
      {...rest}
    >
      <ItemContent icon={icon} shortcut={shortcut}>
        {children}
      </ItemContent>
    </BaseMenu.Item>
  );
});

export interface MenuCheckboxItemProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onClick'> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  shortcut?: string;
  /** Default false: toggling keeps the menu open so several options can be set. */
  closeOnClick?: boolean;
}

/** An on/off option. The check mark sits in the leading slot. */
export const MenuCheckboxItem = forwardRef<HTMLDivElement, MenuCheckboxItemProps>(function MenuCheckboxItem(
  { checked, defaultChecked, onCheckedChange, disabled, shortcut, closeOnClick = false, className, children, ...rest },
  ref,
) {
  return (
    <BaseMenu.CheckboxItem
      ref={ref}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={onCheckedChange ? (next: boolean) => onCheckedChange(next) : undefined}
      disabled={disabled}
      closeOnClick={closeOnClick}
      className={cx(styles.item, className)}
      {...rest}
    >
      <span className={styles.leading}>
        <BaseMenu.CheckboxItemIndicator keepMounted className={styles.indicator}>
          <Icon icon={Check} size="sm" />
        </BaseMenu.CheckboxItemIndicator>
      </span>
      <span className={styles.label}>{children}</span>
      {shortcut && (
        <kbd className={styles.shortcut} aria-hidden="true">
          {shortcut}
        </kbd>
      )}
    </BaseMenu.CheckboxItem>
  );
});

export interface MenuRadioGroupProps {
  /** Visible group label, also the accessible name. */
  label?: ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  children?: ReactNode;
}

/** One choice among several, like a theme or a sort order. */
export function MenuRadioGroup({ label, value, defaultValue, onValueChange, disabled, children }: MenuRadioGroupProps) {
  return (
    <BaseMenu.RadioGroup
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange ? (next: unknown) => onValueChange(next as string) : undefined}
      disabled={disabled}
      className={styles.group}
    >
      {label && <BaseMenu.GroupLabel className={styles.groupLabel}>{label}</BaseMenu.GroupLabel>}
      {children}
    </BaseMenu.RadioGroup>
  );
}

export interface MenuRadioItemProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onClick'> {
  value: string;
  disabled?: boolean;
  /** Default false. */
  closeOnClick?: boolean;
}

export const MenuRadioItem = forwardRef<HTMLDivElement, MenuRadioItemProps>(function MenuRadioItem(
  { value, disabled, closeOnClick = false, className, children, ...rest },
  ref,
) {
  return (
    <BaseMenu.RadioItem ref={ref} value={value} disabled={disabled} closeOnClick={closeOnClick} className={cx(styles.item, className)} {...rest}>
      <span className={styles.leading}>
        <BaseMenu.RadioItemIndicator keepMounted className={cx(styles.indicator, styles.radioDot)} />
      </span>
      <span className={styles.label}>{children}</span>
    </BaseMenu.RadioItem>
  );
});

export interface MenuGroupProps {
  /** Visible group label. */
  label?: ReactNode;
  children?: ReactNode;
}

/** Groups related items under an optional label. */
export function MenuGroup({ label, children }: MenuGroupProps) {
  return (
    <BaseMenu.Group className={styles.group}>
      {label && <BaseMenu.GroupLabel className={styles.groupLabel}>{label}</BaseMenu.GroupLabel>}
      {children}
    </BaseMenu.Group>
  );
}

/** A hairline between groups. */
export function MenuSeparator({ className }: { className?: string }) {
  return <BaseMenu.Separator className={cx(styles.separator, className)} />;
}

export interface MenuSubmenuProps extends ItemDecor {
  /** The item that opens the submenu. */
  label: ReactNode;
  disabled?: boolean;
  /** Submenu items. */
  children?: ReactNode;
}

/** A nested menu. Opens with ArrowRight, Enter or hover; ArrowLeft and Escape close it. */
export function MenuSubmenu({ label, icon, disabled, children }: MenuSubmenuProps) {
  return (
    <BaseMenu.SubmenuRoot>
      <BaseMenu.SubmenuTrigger disabled={disabled} className={cx(styles.item, styles.submenuTrigger)}>
        <ItemContent icon={icon} end={<Icon icon={ChevronRight} size="sm" className={styles.chevron} />}>
          {label}
        </ItemContent>
      </BaseMenu.SubmenuTrigger>
      <MenuPopup side="inline-end" align="start" sideOffset={2} alignOffset={-5}>
        {children}
      </MenuPopup>
    </BaseMenu.SubmenuRoot>
  );
}
