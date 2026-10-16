import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Layers } from 'lucide-react';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Tag } from './Tag';

const meta = {
  title: 'Data display/Tag',
  component: Tag,
  args: { children: 'color.action', tone: 'neutral', size: 'md' },
  argTypes: {
    tone: { control: 'inline-radio', options: ['neutral', 'signal'] },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    icon: { control: false },
  },
} satisfies Meta<typeof Tag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Static: Story = {};
export const Removable: Story = { args: { onRemove: () => {}, children: 'Button' } };
export const Toggle: Story = { args: { defaultSelected: true, children: 'Dark theme' } };

export const FilterChips: Story = {
  render: () => {
    const [themes, setThemes] = useState<string[]>(['Light']);
    return (
      <div role="group" aria-label="Filter by theme" style={{ display: 'flex', gap: 8 }}>
        {['Light', 'Dark', 'Ocean'].map((t) => (
          <Tag
            key={t}
            selected={themes.includes(t)}
            onSelectedChange={(on) => setThemes((s) => (on ? [...s, t] : s.filter((x) => x !== t)))}
          >
            {t}
          </Tag>
        ))}
      </div>
    );
  },
};

type Kind = 'static' | 'toggle' | 'selected' | 'removable';

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus visible', pseudo: 'focus-visible' }, { label: 'Disabled' }]}
        rows={[
          { label: 'Static', value: 'static' as Kind },
          { label: 'Toggle', value: 'toggle' as Kind },
          { label: 'Selected', value: 'selected' as Kind },
          { label: 'Removable', value: 'removable' as Kind },
        ]}
        render={(kind, col) => (
          <Tag
            disabled={col.label === 'Disabled'}
            selected={kind === 'toggle' ? false : kind === 'selected' ? true : undefined}
            onSelectedChange={kind === 'toggle' || kind === 'selected' ? () => {} : undefined}
            onRemove={kind === 'removable' ? () => {} : undefined}
          >
            {kind === 'removable' ? 'Badge' : 'Compact density'}
          </Tag>
        )}
      />
      <Specimen label="Tones, icon, small">
        <Tag tone="signal">Matches "border"</Tag>
        <Tag icon={Layers}>Primitives</Tag>
        <Tag size="sm" onRemove={() => {}}>ocean</Tag>
      </Specimen>
    </SpecimenStack>
  ),
};
