import type { Meta, StoryObj } from '@storybook/react-vite';
import { FigmaReference } from './FigmaReference';

// Hidden fixture for the Figma fidelity check (bridge figma-references); the renderer is FigmaReference.tsx.
// Not in the sidebar, not a workbench story.

const meta = {
  title: 'Internal/Figma reference',
  component: FigmaReference,
  tags: ['!dev', '!autodocs', '!test'],
  parameters: { layout: 'centered' },
  args: { plan: JSON.stringify({ component: 'Button', props: { variant: 'primary', size: 'md' }, text: 'Button' }) },
} satisfies Meta<typeof FigmaReference>;

export default meta;

export const Variant: StoryObj<typeof meta> = {};
