// Props playground of a component page: controls generated from the props parsed out of the component's TypeScript
// source (playgroundSpec) drive the component's story in the team's Storybook (decision D2: every Library previews
// with its own Storybook, Bridge's included), through the story's `args=` and the theme, brand and density globals.
// One React component for Bridge's own page (a hydrated island) and a team's Library (rendered in the browser).
import { useEffect, useId, useMemo, useState } from 'react';
import { Button, CodeBlock, Input, SegmentedControl, Select, Switch } from '@bridge-ds/react';
import { RotateCcw } from 'lucide-react';
import { requestScope, useScope } from './ds/scope';
import type { Control, PlaygroundSpec } from '../lib/components';
import { previewUrl, storyArgs } from '../lib/library/component-page';

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

const DEFAULT_DENSITIES = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

/** Waits for typing to settle before the story reloads with new args. */
function useSettled<T>(value: T, ms = 350): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export interface PropsPlaygroundProps {
  spec: PlaygroundSpec;
  /** The Storybook the story loads from (https, no trailing slash). */
  storybook: string;
  /** The story the controls drive (the component's first story). */
  storyId: string;
  /** Every brand of the design system (bridge.config.json), the default first: the switch shows when there are several. */
  brands: { value: string; label: string }[];
  densities?: { value: string; label: string }[];
}

export default function PropsPlayground({ spec, storybook, storyId, brands, densities = DEFAULT_DENSITIES }: PropsPlaygroundProps) {
  const [values, setValues] = useState<Values>(spec.initial);
  const [children, setChildren] = useState(spec.children ?? '');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const scope = useScope();
  const controls = [...spec.controls, ...spec.native];

  const code = useMemo(() => snippet(spec.component, values, spec.children !== null ? children : null, spec.defaults), [values, children, spec]);
  const args = useSettled(JSON.stringify(storyArgs(values, spec.children !== null ? children : null)));
  // The default brand and density (listed first) stay out of the address: the story starts on them.
  const brand = brands.length > 1 && scope.brand !== brands[0]?.value ? scope.brand : undefined;
  const density = densities.length > 1 && scope.density !== densities[0]?.value ? scope.density : undefined;
  const src = previewUrl(storybook, storyId, { theme, brand, density }, JSON.parse(args) as Record<string, string>);

  const set = (k: string) => (v: string | boolean) => setValues((prev) => ({ ...prev, [k]: v }));

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
          {brands.length > 1 && <SegmentedControl label="Brand" size="sm" items={brands} value={scope.brand} onValueChange={(brand) => requestScope({ brand })} />}
          {densities.length > 1 && <SegmentedControl label="Density" size="sm" items={densities} value={scope.density} onValueChange={(density) => requestScope({ density })} />}
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
        <div className="pg-stage pg-stage-frame" data-theme={theme} data-sb-needs-story="">
          <iframe className="sb-frame" src={src} title={`${spec.component} playground, ${theme} theme`} sandbox="allow-scripts allow-same-origin allow-popups" referrerPolicy="no-referrer" loading="lazy" />
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
