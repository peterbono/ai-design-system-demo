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
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    appearance: { control: 'inline-radio', options: ['default', 'strong'] },
    items: { control: false },
  },
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

const statuses: SegmentedControlItem[] = [
  { value: 'open', label: 'Open' },
  { value: 'you', label: 'Needs you' },
  { value: 'review', label: 'In review' },
  { value: 'ready', label: 'Ready' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'closed', label: 'Closed' },
];
export const Strong: Story = { args: { label: 'Status', appearance: 'strong', items: statuses.slice(0, 4), defaultValue: 'open' } };
/** Seven segments in a phone-wide container: the track scrolls sideways, the page does not. */
export const ManyOnPhone: Story = {
  args: { label: 'Status', appearance: 'strong', size: 'sm', items: statuses, defaultValue: 'blocked' },
  decorators: [(S) => <div style={{ width: 358, outline: '1px dashed var(--color-border-default)' }}><S /></div>],
};

/** A visible label sits outside the track, to its left, as a caption on the track's center line. Inside the track it
 * would read as one more option. The group takes its name from it with aria-labelledby. */
function ExternalLabel({ id, text, size = 'sm' }: { id: string; text: string; size?: 'sm' | 'md' }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <span id={id} style={{ color: 'var(--color-text-muted)', fontSize: 'var(--typography-caption-size)', fontWeight: 'var(--font-weight-medium)' }}>
        {text}
      </span>
      <SegmentedControl
        aria-labelledby={id}
        size={size}
        defaultValue="bridge"
        items={[
          { value: 'bridge', label: 'Bridge' },
          { value: 'ocean', label: 'Ocean' },
        ]}
      />
    </div>
  );
}

export const WithVisibleLabel: Story = { render: () => <ExternalLabel id="story-preview-brand" text="Preview brand" /> };

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
      <Specimen label="External label (sm and md)">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-6)', alignItems: 'center' }}>
          <ExternalLabel id="all-states-label-sm" text="Preview brand" />
          <ExternalLabel id="all-states-label-md" text="Preview brand" size="md" />
        </div>
      </Specimen>
      <Specimen label="Strong (Deep Harbor selection)">
        <SegmentedControl label="Status strong" appearance="strong" items={statuses.slice(0, 4)} defaultValue="you" />
        <SegmentedControl label="Status strong sm" appearance="strong" size="sm" items={statuses.slice(0, 4)} defaultValue="you" />
      </Specimen>
      <Specimen label="Seven segments at phone width (scrolls sideways)">
        <div style={{ width: 358 }}>
          <SegmentedControl label="Status phone" appearance="strong" size="sm" items={statuses} defaultValue="open" />
        </div>
      </Specimen>
      <Specimen label="Full width">
        <div style={{ maxWidth: 320 }}>
          <SegmentedControl label="Density" items={density} defaultValue="compact" fullWidth />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
