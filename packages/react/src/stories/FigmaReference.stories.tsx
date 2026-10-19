import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentType, ReactNode } from 'react';
import { icons } from 'lucide-react';
import * as DS from '../index';

// Hidden fixture for the Figma fidelity check (bridge figma-references): renders one generated Figma variant from
// code, with the same props, texts, icons, state and width as the variant the DS Bridge plugin draws. The capture
// passes the render plan (planReference in @bridge-ds/core) as a JSON string arg over the Storybook channel.
// Not in the sidebar, not a workbench story.

interface Render {
  component: string;
  props: Record<string, string | boolean>;
  text?: string;
  parts?: { component: string; text: string }[];
  icons?: Record<string, string>;
  pseudo?: 'hover' | 'active' | 'focus-visible';
  width?: string;
}

const registry = DS as unknown as Record<string, ComponentType<Record<string, unknown>> | undefined>;
const lucide = icons as Record<string, unknown>;

function FigmaReference({ plan }: { plan: string }) {
  let r: Render;
  try {
    r = JSON.parse(plan) as Render;
  } catch {
    return <p data-fidelity-error="">No render plan</p>;
  }
  const Comp = registry[r.component];
  if (!Comp) return <p data-fidelity-error="">{`${r.component} is not exported by @bridge-ds/react`}</p>;
  const props: Record<string, unknown> = { ...r.props };
  for (const [prop, name] of Object.entries(r.icons ?? {})) {
    if (!lucide[name]) return <p data-fidelity-error="">{`Icon ${name} is not in lucide-react`}</p>;
    props[prop] = lucide[name];
  }
  // Icon-only components need an accessible name; it is not drawn.
  if (r.icons && r.text === undefined && !r.parts) props.label = r.component;
  let children: ReactNode = r.text;
  if (r.parts) {
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
    <div data-fidelity-root="" className={pseudo} style={{ display: 'inline-block', width: r.width ? `var(--${r.width.split('.').join('-')})` : undefined }}>
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
