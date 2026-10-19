// Props playground: the one React island of the component pages. It renders the REAL component from
// @bridge-ds/react with controls generated from the props parsed out of its TypeScript source (see playgroundSpec).
// Generic: any component in registry.tsx with string-literal, boolean or string props gets a playground.
import { Component, useId, useMemo, useState, type ReactNode } from 'react';
import { Button, CodeBlock, Input, SegmentedControl, Select, Switch } from '@bridge-ds/react';
import { RotateCcw } from 'lucide-react';
import { requestScope, useScope } from './ds/scope';
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

/** Enums with up to four short options read best side by side; longer lists go in a Select. */
const segmentable = (options: string[]) => options.length <= 4 && options.every((o) => o.length <= 12);

/** One prop's control, composed from DS controls (SegmentedControl, Select, Switch, Input). */
function PropControl({ control, value, onChange }: { control: Control; value: string | boolean | undefined; onChange: (v: string | boolean) => void }) {
  const labelId = useId();
  if (control.kind === 'enum') {
    const current = typeof value === 'string' ? value : control.options[0]!;
    return (
      <div className="pg-field">
        {segmentable(control.options) ? (
          <>
            <p className="pg-label mono" id={labelId}>
              {control.name}
            </p>
            <SegmentedControl
              aria-labelledby={labelId}
              size="sm"
              items={control.options.map((o) => ({ value: o, label: o }))}
              value={current}
              onValueChange={onChange}
            />
          </>
        ) : (
          <Select label={control.name} size="sm" options={control.options.map((o) => ({ value: o, label: o }))} value={current} onValueChange={(v) => v != null && onChange(v)} />
        )}
      </div>
    );
  }
  if (control.kind === 'boolean') {
    return (
      <div className="pg-field">
        <Switch label={control.name} size="sm" labelPlacement="start" checked={value === true} onCheckedChange={onChange} />
      </div>
    );
  }
  return (
    <div className="pg-field">
      <Input label={control.name} size="sm" value={typeof value === 'string' ? value : ''} onValueChange={onChange} />
    </div>
  );
}

const DEFAULT_BRANDS = [
  { value: 'bridge', label: 'Bridge' },
  { value: 'ocean', label: 'Ocean' },
];

/** `brands`: every brand of this build (bridge.config.json), so a merged brand shows up here too. */
export default function PropsPlayground({ spec, brands = DEFAULT_BRANDS }: { spec: PlaygroundSpec; brands?: { value: string; label: string }[] }) {
  const [values, setValues] = useState<Values>(spec.initial);
  const [children, setChildren] = useState(spec.children ?? '');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const scope = useScope();
  const Comp = REGISTRY[spec.component];
  const controls = [...spec.controls, ...spec.native];

  const code = useMemo(() => snippet(spec.component, values, spec.children !== null ? children : null, spec.defaults), [values, children, spec]);
  if (!Comp) return <p className="muted">No playground: {spec.component} is not in the registry yet.</p>;

  const set = (k: string) => (v: string | boolean) => setValues((prev) => ({ ...prev, [k]: v }));
  const renderProps = { ...resolveProps(spec.fixed), ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '')) };

  return (
    <div className="pg">
      <div className="pg-stage-wrap">
        <div className="pg-toolbar">
          <SegmentedControl
            label="Playground theme"
            size="sm"
            items={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={theme}
            onValueChange={(v) => setTheme(v as 'light' | 'dark')}
          />
          <SegmentedControl
            label="Brand"
            size="sm"
            items={brands}
            value={scope.brand}
            onValueChange={(brand) => requestScope({ brand })}
          />
          <SegmentedControl
            label="Density"
            size="sm"
            items={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
            value={scope.density}
            onValueChange={(density) => requestScope({ density })}
          />
          <Button
            variant="ghost"
            size="sm"
            iconStart={RotateCcw}
            className="lib-push-end"
            onClick={() => {
              setValues(spec.initial);
              setChildren(spec.children ?? '');
            }}
          >
            Reset props
          </Button>
        </div>
        <div className="pg-stage stage-checker" data-theme={theme}>
          <div className="pg-stage-inner">
            <Guard resetKey={JSON.stringify(values) + children}>
              {spec.children !== null ? <Comp {...renderProps}>{children}</Comp> : <Comp {...renderProps} />}
            </Guard>
          </div>
        </div>
        <CodeBlock className="pg-code" code={code} label="Code for these props" />
      </div>
      <form className="pg-controls" onSubmit={(e) => e.preventDefault()} aria-label={`${spec.component} props`}>
        {controls.map((c) => (
          <PropControl key={c.name} control={c} value={values[c.name]} onChange={set(c.name)} />
        ))}
        {spec.children !== null && (
          <div className="pg-field">
            <Input label="children" size="sm" value={children} onValueChange={setChildren} />
          </div>
        )}
      </form>
    </div>
  );
}
