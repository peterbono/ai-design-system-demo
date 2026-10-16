// Props playground: the one React island of the component pages. It renders the REAL component from
// @bridge-ds/react with controls generated from the props parsed out of its TypeScript source (see playgroundSpec).
// Generic: any component in registry.tsx with string-literal, boolean or string props gets a playground.
import { Component, useId, useMemo, useState, type ReactNode } from 'react';
import type { Control, PlaygroundSpec } from '../lib/components';
import { REGISTRY, resolveProps } from './registry';

/** Some prop combinations are invalid for a component; show a note instead of a blank island. */
class Guard extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean; key: string }> {
  state = { failed: false, key: this.props.resetKey };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  static getDerivedStateFromProps(props: { resetKey: string }, state: { failed: boolean; key: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }
  render() {
    return this.state.failed ? <p className="pg-note">This combination does not render. Try other values.</p> : this.props.children;
  }
}

type Values = Record<string, string | boolean>;

const attr = (k: string, v: string | boolean) => (v === true ? k : `${k}=${JSON.stringify(v)}`);

function snippet(name: string, values: Values, children: string | null, defaults: Values) {
  const props = Object.entries(values)
    .filter(([k, v]) => v !== false && v !== '' && defaults[k] !== v)
    .map(([k, v]) => attr(k, v));
  const open = props.length > 2 ? `<${name}\n  ${props.join('\n  ')}\n` : `<${name}${props.length ? ' ' + props.join(' ') : ''}`;
  if (children) return `${open}>${props.length > 2 ? '\n  ' : ''}${children}${props.length > 2 ? '\n' : ''}</${name}>`;
  return `${open}${props.length > 2 ? '' : ' '}/>`;
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </svg>
  );
}

function Field({ control, value, onChange }: { control: Control; value: string | boolean | undefined; onChange: (v: string | boolean) => void }) {
  const id = useId();
  if (control.kind === 'enum') {
    return (
      <fieldset className="pg-field">
        <legend className="pg-label mono">{control.name}</legend>
        <div className="pg-seg" role="radiogroup" aria-label={control.name}>
          {control.options.map((o) => (
            <label key={o} className="pg-seg-opt">
              <input type="radio" name={id} value={o} checked={value === o} onChange={() => onChange(o)} />
              <span>{o}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (control.kind === 'boolean') {
    return (
      <div className="pg-field pg-field-row">
        <label className="pg-label mono" htmlFor={id}>
          {control.name}
        </label>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={value === true}
          className="pg-switch"
          onClick={() => onChange(!(value === true))}
        >
          <span className="pg-switch-thumb" aria-hidden="true" />
          <span className="sr-only">{value === true ? 'On' : 'Off'}</span>
        </button>
      </div>
    );
  }
  return (
    <div className="pg-field">
      <label className="pg-label mono" htmlFor={id}>
        {control.name}
      </label>
      <input id={id} className="pg-input" type="text" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export default function PropsPlayground({ spec }: { spec: PlaygroundSpec }) {
  const [values, setValues] = useState<Values>(spec.initial);
  const [children, setChildren] = useState(spec.children ?? '');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [copied, setCopied] = useState(false);
  const childId = useId();
  const Comp = REGISTRY[spec.component];
  const controls = [...spec.controls, ...spec.native];

  const code = useMemo(() => snippet(spec.component, values, spec.children !== null ? children : null, spec.defaults), [values, children, spec]);
  if (!Comp) return <p className="muted">No playground: {spec.component} is not in the registry yet.</p>;

  const set = (k: string) => (v: string | boolean) => setValues((prev) => ({ ...prev, [k]: v }));
  const renderProps = { ...resolveProps(spec.fixed), ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '')) };

  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className="pg">
      <div className="pg-stage-wrap">
        <div className="pg-toolbar">
          <div className="cp-seg" role="group" aria-label="Playground theme">
            {(['light', 'dark'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}>
                {t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
          <div className="cp-seg" role="radiogroup" aria-label="Brand">
            {(['bridge', 'ocean'] as const).map((b) => (
              <button key={b} type="button" role="radio" aria-checked={b === 'bridge'} data-set-brand={b}>
                {b === 'bridge' ? 'Bridge' : 'Ocean'}
              </button>
            ))}
          </div>
          <div className="cp-seg" role="radiogroup" aria-label="Density">
            {(['comfortable', 'compact'] as const).map((d) => (
              <button key={d} type="button" role="radio" aria-checked={d === 'comfortable'} data-set-density={d}>
                {d === 'comfortable' ? 'Comfortable' : 'Compact'}
              </button>
            ))}
          </div>
          <button type="button" className="pg-reset" onClick={() => { setValues(spec.initial); setChildren(spec.children ?? ''); }}>
            Reset
          </button>
        </div>
        <div className="pg-stage stage-checker" data-theme={theme}>
          <div className="pg-stage-inner">
            <Guard resetKey={JSON.stringify(values) + children}>
              {spec.children !== null ? <Comp {...renderProps}>{children}</Comp> : <Comp {...renderProps} />}
            </Guard>
          </div>
        </div>
        <div className="pg-code">
          <pre aria-label="Code for the current props">
            <code>{code}</code>
          </pre>
          <button type="button" className="copy copy-ui pg-copy" onClick={copy} data-copied={copied || undefined} aria-label="Copy code">
            {copied ? <Check /> : <CopyIcon />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
      <form className="pg-controls" onSubmit={(e) => e.preventDefault()} aria-label={`${spec.component} props`}>
        {controls.map((c) => (
          <Field key={c.name} control={c} value={values[c.name]} onChange={set(c.name)} />
        ))}
        {spec.children !== null && (
          <div className="pg-field">
            <label className="pg-label mono" htmlFor={childId}>
              children
            </label>
            <input id={childId} className="pg-input" type="text" value={children} onChange={(e) => setChildren(e.target.value)} />
          </div>
        )}
        <span className="sr-only" role="status" aria-live="polite">
          {copied ? 'Code copied to clipboard' : ''}
        </span>
      </form>
    </div>
  );
}
