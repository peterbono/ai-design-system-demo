import { forwardRef, useId, type AnchorHTMLAttributes, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { useRender } from '@base-ui/react/use-render';
import { mergeProps } from '@base-ui/react/merge-props';
import { ChevronDown } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Icon, type LucideIcon } from '../Icon';
import styles from './SidebarNav.module.css';

export interface SidebarNavProps extends HTMLAttributes<HTMLElement> {
  /** Accessible name of the navigation landmark, for example "Library". Required when the page has other nav landmarks. */
  'aria-label'?: string;
  children?: ReactNode;
}

/** App side navigation: a nav landmark holding sections of links. Place it in the app shell's left rail. */
export const SidebarNav = forwardRef<HTMLElement, SidebarNavProps>(function SidebarNav({ className, children, ...rest }, ref) {
  return (
    <nav ref={ref} className={cx(styles.sidebar, className)} {...rest}>
      {children}
    </nav>
  );
});

export interface SidebarNavSectionProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Section heading. Omit for the first, untitled group. */
  title?: ReactNode;
  /** Let users fold the section. The title becomes a button with aria-expanded. */
  collapsible?: boolean;
  /** Initial open state of a collapsible section. Default true. */
  defaultOpen?: boolean;
  /** Controlled open state of a collapsible section. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** SidebarNavItem elements. */
  children?: ReactNode;
}

/** A titled group of links. Collapsible sections use Base UI Collapsible. */
export const SidebarNavSection = forwardRef<HTMLDivElement, SidebarNavSectionProps>(function SidebarNavSection(
  { title, collapsible = false, defaultOpen = true, open, onOpenChange, className, children, ...rest },
  ref,
) {
  const titleId = useId();
  const list = (
    <ul className={styles.list} aria-labelledby={title ? titleId : undefined}>
      {children}
    </ul>
  );
  if (collapsible && title) {
    return (
      <Collapsible.Root
        ref={ref}
        defaultOpen={defaultOpen}
        open={open}
        onOpenChange={onOpenChange ? (o: boolean) => onOpenChange(o) : undefined}
        className={cx(styles.section, className)}
        {...rest}
      >
        <Collapsible.Trigger className={cx(styles.title, styles.trigger)} id={titleId}>
          <span>{title}</span>
          <Icon icon={ChevronDown} size="xs" className={styles.chevron} />
        </Collapsible.Trigger>
        <Collapsible.Panel className={styles.panel}>{list}</Collapsible.Panel>
      </Collapsible.Root>
    );
  }
  return (
    <div ref={ref} className={cx(styles.section, className)} {...rest}>
      {title && (
        <div className={styles.title} id={titleId}>
          {title}
        </div>
      )}
      {list}
    </div>
  );
});

export interface SidebarNavItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Lucide icon before the label. Use icons on every item of a section or on none. */
  icon?: LucideIcon;
  /** The page this item points to is the current page: sets aria-current and shows the signal mark. */
  active?: boolean;
  /** Count of items needing attention, like open reviews. */
  count?: number;
  /** Render a router link instead of `<a>`: `render={<RouterLink to="/tokens" />}`. */
  render?: ReactElement;
}

/** One navigation link inside a SidebarNavSection. */
export const SidebarNavItem = forwardRef<HTMLAnchorElement, SidebarNavItemProps>(function SidebarNavItem(
  { icon, active = false, count, render, className, children, ...rest },
  ref,
) {
  const link = useRender({
    defaultTagName: 'a',
    render,
    ref,
    props: mergeProps<'a'>(
      {
        className: cx(styles.item, active && styles.active, className),
        'aria-current': active ? 'page' : undefined,
        children: (
          <>
            <span className={styles.indicator} aria-hidden="true" />
            {icon && <Icon icon={icon} size="sm" className={styles.icon} />}
            <span className={styles.label}>{children}</span>
            {count !== undefined && <span className={styles.count}>{count}</span>}
          </>
        ),
      },
      rest,
    ),
  });
  return <li className={styles.listItem}>{link}</li>;
});
