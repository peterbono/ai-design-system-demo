import type { Meta, StoryObj } from '@storybook/react-vite';
import { LayoutGrid, List, Moon, Sun } from 'lucide-react';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { SegmentedControl, type SegmentedControlItem } from './SegmentedControl';

const density: SegmentedControlItem[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

const meta = {
  title: 'Forms/SegmentedControl',
  component: SegmentedControl,
  args: { label: 'Density', items: density, defaultValue: 'comfortable', size: 'md' },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md'] }, items: { control: false } },
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Small: Story = { args: { size: 'sm' } };
export const WithIcons: Story = {
  args: {
    label: 'Theme',
    defaultValue: 'light',
    items: [
      { value: 'light', label: 'Light', icon: Sun },
      { value: 'dark', label: 'Dark', icon: Moon },
    ],
  },
};
export const ThreeOptions: Story = {
  args: {
    label: 'Themes shown',
    defaultValue: 'both',
    items: [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
      { value: 'both', label: 'Both' },
    ],
  },
};
export const FullWidth: Story = { args: { fullWidth: true }, decorators: [(S) => <div style={{ maxWidth: 320 }}><S /></div>] };
export const Disabled: Story = { args: { disabled: true } };

type Row = 'md' | 'sm' | 'icons' | 'disabled' | 'disabledItem';

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid<Row>
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus visible', pseudo: 'focus-visible' }, { label: 'Active', pseudo: 'active' }]}
        rows={[
          { label: 'Size md', value: 'md' },
          { label: 'Size sm', value: 'sm' },
          { label: 'With icons', value: 'icons' },
          { label: 'Disabled group', value: 'disabled' },
          { label: 'Disabled segment', value: 'disabledItem' },
        ]}
        render={(row, col) => (
          <SegmentedControl
            label={`${row} ${col.label}`}
            size={row === 'sm' ? 'sm' : 'md'}
            disabled={row === 'disabled'}
            defaultValue="grid"
            items={[
              { value: 'list', label: 'List', icon: row === 'icons' ? List : undefined },
              { value: 'grid', label: 'Grid', icon: row === 'icons' ? LayoutGrid : undefined },
              { value: 'table', label: 'Table', disabled: row === 'disabledItem' },
            ]}
          />
        )}
      />
      <Specimen label="Full width">
        <div style={{ maxWidth: 320 }}>
          <SegmentedControl label="Density" items={density} defaultValue="compact" fullWidth />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
