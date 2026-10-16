import { createContext, forwardRef, useContext, type ReactNode } from 'react';
import { Accordion as BaseAccordion } from '@base-ui/react/accordion';
import { ChevronDown } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Icon } from '../Icon';
import styles from './Accordion.module.css';

export type AccordionHeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface AccordionProps {
  /** Allow several panels open at once. Default `false`. */
  multiple?: boolean;
  /** Values of the items open by default (uncontrolled). */
  defaultValue?: string[];
  /** Values of the open items (controlled). */
  value?: string[];
  onValueChange?: (value: string[]) => void;
  /** Heading level of every item trigger, to fit the page outline. Default `3`. */
  headingLevel?: AccordionHeadingLevel;
  /** `contained` draws an outer border (inside a page); `flush` only separates items (inside a card). Default `contained`. */
  appearance?: 'contained' | 'flush';
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

const LevelContext = createContext<AccordionHeadingLevel>(3);

/** Stacked sections that expand one at a time or several at once (Base UI Accordion). */
export const Accordion = forwardRef<HTMLDivElement, AccordionProps>(function Accordion(
  { multiple = false, defaultValue, value, onValueChange, headingLevel = 3, appearance = 'contained', disabled, className, children },
  ref,
) {
  return (
    <LevelContext.Provider value={headingLevel}>
      <BaseAccordion.Root
        ref={ref}
        multiple={multiple}
        defaultValue={defaultValue}
        value={value}
        onValueChange={onValueChange ? (v) => onValueChange(v as string[]) : undefined}
        disabled={disabled}
        className={cx(styles.accordion, styles[appearance], className)}
      >
        {children}
      </BaseAccordion.Root>
    </LevelContext.Provider>
  );
});

export interface AccordionItemProps {
  /** Unique value, used by defaultValue and value. */
  value: string;
  /** Trigger text: a short, scannable heading. */
  title: ReactNode;
  /** Secondary text on the trigger row, like a count or a status. */
  meta?: ReactNode;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export const AccordionItem = forwardRef<HTMLDivElement, AccordionItemProps>(function AccordionItem(
  { value, title, meta, disabled, className, children },
  ref,
) {
  const level = useContext(LevelContext);
  const Heading = `h${level}` as const;
  return (
    <BaseAccordion.Item ref={ref} value={value} disabled={disabled} className={cx(styles.item, className)}>
      <BaseAccordion.Header className={styles.header} render={<Heading />}>
        <BaseAccordion.Trigger className={styles.trigger}>
          <span className={styles.title}>{title}</span>
          {meta != null && <span className={styles.meta}>{meta}</span>}
          <Icon icon={ChevronDown} size="sm" className={styles.chevron} />
        </BaseAccordion.Trigger>
      </BaseAccordion.Header>
      <BaseAccordion.Panel className={styles.panel}>
        <div className={styles.content}>{children}</div>
      </BaseAccordion.Panel>
    </BaseAccordion.Item>
  );
});
