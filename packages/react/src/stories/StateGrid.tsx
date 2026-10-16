// Story-only helper: renders one row per variant and one column per state for "All states" stories.
// Hover, focus-visible and active are forced with storybook-addon-pseudo-states classes.
import { useEffect, useRef, type ReactNode } from 'react';
import styles from './StateGrid.module.css';

export type PseudoState = 'hover' | 'focus-visible' | 'active';

export interface StateColumn {
  label: string;
  /** Forces a CSS pseudo-class on every element in the cell. */
  pseudo?: PseudoState;
}

export interface StateGridProps<Row> {
  columns: StateColumn[];
  rows: { label: string; value: Row }[];
  render: (row: Row, column: StateColumn, index: number) => ReactNode;
}

const PSEUDO_CLASSES: Record<PseudoState, string[]> = {
  hover: ['pseudo-hover'],
  'focus-visible': ['pseudo-focus-visible', 'pseudo-focus', 'pseudo-focus-within'],
  active: ['pseudo-active', 'pseudo-hover'],
};

const INTERACTIVE = 'button, a[href], input, textarea, select, [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="combobox"], [tabindex]';

/** Applies the pseudo-state classes to the first interactive element of the cell (and its control root). */
function Cell({ pseudo, children }: { pseudo?: PseudoState; children: ReactNode }) {
  const ref = useRef<HTMLTableCellElement>(null);
  useEffect(() => {
    const target = pseudo ? ref.current?.querySelector(INTERACTIVE) : null;
    if (!target || !pseudo) return;
    const els = [target, target.closest('[data-pseudo-root]')].filter(Boolean) as Element[];
    els.forEach((el) => el.classList.add(...PSEUDO_CLASSES[pseudo]));
    return () => els.forEach((el) => el.classList.remove(...PSEUDO_CLASSES[pseudo]));
  });
  return (
    <td ref={ref} className={styles.cell}>
      {children}
    </td>
  );
}

export function StateGrid<Row>({ columns, rows, render }: StateGridProps<Row>) {
  return (
    <div className={styles.scroller}>
      <table className={styles.grid}>
        <thead>
          <tr>
            <td />
            {columns.map((c) => (
              <th key={c.label} scope="col" className={styles.colHead}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className={styles.rowHead}>
                {r.label}
              </th>
              {columns.map((c, i) => (
                <Cell key={c.label} pseudo={c.pseudo}>
                  {render(r.value, c, i)}
                </Cell>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Vertical list of labelled examples for states that are not pseudo-classes (sizes, content variations). */
export function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className={styles.specimen} aria-label={label}>
      <p className={styles.specimenLabel}>{label}</p>
      <div className={styles.specimenBody}>{children}</div>
    </section>
  );
}

export function SpecimenStack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}
