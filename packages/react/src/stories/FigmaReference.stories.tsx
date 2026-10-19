import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { icons } from 'lucide-react';
import * as DS from '../index';
import type { ToastProps } from '../components/Toast';

// Hidden fixture for the Figma fidelity check (bridge figma-references): renders one generated Figma variant from
// code, with the same props, texts, icons, state and width as the variant the DS Bridge plugin draws. The capture
// passes the render plan (planReference in @bridge-ds/core) as a JSON string arg over the Storybook channel.
// Not in the sidebar, not a workbench story.

/** An element of a code example (a table row, a form field): component, props, children. */
interface ExampleNode {
  c: string;
  p?: Record<string, unknown>;
  children?: (string | ExampleNode)[];
}

interface Render {
  component: string;
  props: Record<string, unknown>;
  text?: string;
  parts?: { component: string; text: string }[];
  icons?: Record<string, string>;
  pseudo?: 'hover' | 'active' | 'focus-visible';
  width?: string;
  children?: (string | ExampleNode)[];
}

const lucide = icons as Record<string, unknown>;

/**
 * A toast is shown from the useToast hook under its provider, not placed: shown once, and marked as the capture target
 * (`data-fidelity-target`) where Base UI renders it, at the bottom end of the screen.
 */
function ToastReference(props: Record<string, unknown>) {
  return (
    <DS.ToastProvider>
      <ShowToast toast={{ ...(props as unknown as ToastProps), timeout: 0 }} />
    </DS.ToastProvider>
  );
}
function ShowToast({ toast }: { toast: ToastProps }) {
  const api = DS.useToast();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    api.add(toast);
    const mark = () => {
      const el = document.querySelector('[role="dialog"][data-type], [role="alertdialog"][data-type]');
      if (el) el.setAttribute('data-fidelity-target', '');
      else requestAnimationFrame(mark);
    };
    mark();
  }, [api, toast]);
  return null;
}

/** Components shown from a hook rather than placed (drafted sets): rendered through their hook. */
const HOOK_SHOWN: Record<string, ComponentType<Record<string, unknown>>> = { Toast: ToastReference };

const registry = { ...(DS as unknown as Record<string, ComponentType<Record<string, unknown>> | undefined>), ...HOOK_SHOWN };

/** Icon props given by name ("Pencil") become the lucide icon. */
function withIcons(p: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, v] of Object.entries(out)) if (/^icon/i.test(k) && typeof v === 'string' && lucide[v]) out[k] = lucide[v];
  return out;
}

/** A code example's children: texts as they are, elements through the design system. Missing names throw. */
function example(nodes: (string | ExampleNode)[]): ReactNode {
  return nodes.map((n, i) => {
    if (typeof n === 'string') return n;
    const Comp = registry[n.c];
    if (!Comp) throw new Error(`${n.c} is not exported by @bridge-ds/react`);
    return (
      <Comp key={i} {...withIcons(n.p)}>
        {n.children?.length ? example(n.children) : undefined}
      </Comp>
    );
  });
}

function FigmaReference({ plan }: { plan: string }) {
  let r: Render;
  try {
    r = JSON.parse(plan) as Render;
  } catch {
    return <p data-fidelity-error="">No render plan</p>;
  }
  const Comp = registry[r.component];
  if (!Comp) return <p data-fidelity-error="">{`${r.component} is not exported by @bridge-ds/react`}</p>;
  const props: Record<string, unknown> = withIcons(r.props);
  for (const [prop, name] of Object.entries(r.icons ?? {})) {
    if (!lucide[name]) return <p data-fidelity-error="">{`Icon ${name} is not in lucide-react`}</p>;
    props[prop] = lucide[name];
  }
  // Icon-only components need an accessible name; it is not drawn.
  if (r.icons && r.text === undefined && !r.parts && !r.children) props.label = r.component;
  let children: ReactNode = r.text;
  if (r.children) {
    try {
      children = example(r.children);
    } catch (err) {
      return <p data-fidelity-error="">{(err as Error).message}</p>;
    }
  } else if (r.parts) {
    const missing = r.parts.find((p) => !registry[p.component]);
    if (missing) return <p data-fidelity-error="">{`${missing.component} is not exported by @bridge-ds/react`}</p>;
    children = r.parts.map((p) => {
      const Part = registry[p.component]!;
      return <Part key={p.component}>{p.text}</Part>;
    });
  }
  // pseudo-states addon classes: every descendant behaves as hovered, pressed or focused.
  const pseudo = r.pseudo ? `pseudo-${r.pseudo}-all` : undefined;
  return (
    <div key={plan} data-fidelity-root="" className={pseudo} style={{ display: 'inline-block', width: r.width ? `var(--${r.width.split('.').join('-')})` : undefined }}>
      <Comp {...props}>{children}</Comp>
    </div>
  );
}

const meta = {
  title: 'Internal/Figma reference',
  component: FigmaReference,
  tags: ['!dev', '!autodocs', '!test'],
  parameters: { layout: 'centered' },
  args: { plan: JSON.stringify({ component: 'Button', props: { variant: 'primary', size: 'md' }, text: 'Button' }) },
} satisfies Meta<typeof FigmaReference>;

export default meta;

export const Variant: StoryObj<typeof meta> = {};
