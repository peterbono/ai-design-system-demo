import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CSSProperties } from 'react';
import { cssVar } from '@demo-ds/tokens';
import styles from './Foundations.module.css';

const meta = { title: 'Foundations/Tokens', tags: ['!autodocs'], parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const names = Object.keys(cssVar);
const group = (prefix: string) => names.filter((n) => n.startsWith(prefix));

function Swatch({ name }: { name: string }) {
  return (
    <div className={styles.swatch}>
      <span className={styles.chip} style={{ backgroundColor: `var(--${name})` } as CSSProperties} />
      <code className={styles.name}>{name.replace(/^color-/, '')}</code>
    </div>
  );
}

export const Color: Story = {
  render: () => (
    <div className={styles.page}>
      {['color-bg', 'color-surface', 'color-text', 'color-border', 'color-action', 'color-control', 'color-signal', 'color-feedback', 'focus-ring-color'].map((g) => (
        <section key={g} className={styles.section}>
          <h2 className={styles.h2}>{g.replace(/^color-/, '').replace('-', ' ')}</h2>
          <div className={styles.swatches}>
            {group(g).filter((n) => !n.endsWith('width') && !n.endsWith('offset')).map((n) => <Swatch key={n} name={n} />)}
          </div>
        </section>
      ))}
    </div>
  ),
};

const SIZES = ['800', '700', '600', '500', '400', '300', '200', '100'];
export const Typography: Story = {
  render: () => (
    <div className={styles.page}>
      {SIZES.map((s) => (
        <div key={s} className={styles.typeRow}>
          <code className={styles.name}>font.size.{s}</code>
          <span
            style={{
              fontSize: `var(--font-size-${s})`,
              fontWeight: Number(s) >= 400 ? 'var(--font-weight-semibold)' : 'var(--font-weight-regular)',
              lineHeight: Number(s) >= 500 ? 'var(--font-line-height-tight)' : 'var(--font-line-height-normal)',
              letterSpacing: Number(s) >= 500 ? 'var(--font-tracking-tight)' : 'var(--font-tracking-normal)',
            }}
          >
            Review 12 token changes before publishing
          </span>
        </div>
      ))}
      <div className={styles.typeRow}>
        <code className={styles.name}>font.family.mono</code>
        <code style={{ fontFamily: 'var(--font-family-mono)', fontSize: 'var(--font-size-200)' }}>color.action.primary.bg = #1C2735</code>
      </div>
    </div>
  ),
};

export const SpaceRadiusElevation: Story = {
  name: 'Space, radius, elevation',
  render: () => (
    <div className={styles.page}>
      <section className={styles.section}>
        <h2 className={styles.h2}>Space</h2>
        {['0-5', '1', '1-5', '2', '3', '4', '5', '6', '8', '10', '12', '16', '20'].map((k) => (
          <div key={k} className={styles.spaceRow}>
            <code className={styles.name}>space.{k}</code>
            <span className={styles.bar} style={{ width: `var(--space-${k})` }} />
          </div>
        ))}
      </section>
      <section className={styles.section}>
        <h2 className={styles.h2}>Radius roles</h2>
        <div className={styles.swatches}>
          {['inset', 'control', 'container', 'overlay', 'pill'].map((r) => (
            <div key={r} className={styles.radius} style={{ borderRadius: `var(--radius-${r})` }}>
              <code className={styles.name}>radius.{r}</code>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.section}>
        <h2 className={styles.h2}>Elevation</h2>
        <div className={styles.swatches}>
          {['raised', 'overlay', 'modal'].map((e) => (
            <div key={e} className={styles.elevation} style={{ boxShadow: `var(--elevation-${e})` }}>
              <code className={styles.name}>elevation.{e}</code>
            </div>
          ))}
        </div>
      </section>
    </div>
  ),
};
