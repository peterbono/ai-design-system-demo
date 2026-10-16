import type { Meta, StoryObj } from '@storybook/react-vite';
import { Palette } from 'lucide-react';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Icon } from '../Icon';
import { Select, type SelectOption } from './Select';

const THEMES: SelectOption[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'contrast', label: 'High contrast', description: 'Not available for the ocean brand', disabled: true },
];

const TOKEN_GROUPS: SelectOption[] = [
  { value: 'color.action.primary.bg', label: 'color.action.primary.bg', group: 'Color' },
  { value: 'color.border.strong', label: 'color.border.strong', group: 'Color' },
  { value: 'color.signal.default', label: 'color.signal.default', group: 'Color' },
  { value: 'space.4', label: 'space.4', group: 'Space' },
  { value: 'space.6', label: 'space.6', group: 'Space' },
  { value: 'radius.control', label: 'radius.control', group: 'Radius' },
  { value: 'radius.overlay', label: 'radius.overlay', group: 'Radius' },
];

const meta = {
  title: 'Forms/Select',
  component: Select,
  tags: ['autodocs'],
  args: { label: 'Theme', options: THEMES, placeholder: 'No theme', hint: 'Applies to the preview only.' },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    prefix: { control: false },
    options: { control: false },
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

const narrow = [(Story: () => JSX.Element) => <div style={{ maxWidth: 320 }}><Story /></div>];

export const Default: Story = { decorators: narrow };
export const WithValue: Story = { decorators: narrow, args: { defaultValue: 'dark' } };
export const WithError: Story = { decorators: narrow, args: { error: 'Pick a theme before you publish the preview.' } };
export const Grouped: Story = {
  decorators: narrow,
  args: { label: 'Token', options: TOKEN_GROUPS, placeholder: 'Choose a token', hint: undefined },
};

/** The popup rendered open, for review and screenshots. */
export const Open: Story = {
  decorators: [(Story) => <div style={{ maxWidth: 320, minHeight: 360 }}><Story /></div>],
  args: { label: 'Token', options: TOKEN_GROUPS, defaultValue: 'color.border.strong', defaultOpen: true, hint: undefined },
};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus visible', pseudo: 'focus-visible' }]}
        rows={[
          { label: 'Placeholder', value: 'placeholder' },
          { label: 'Selected', value: 'selected' },
          { label: 'Invalid', value: 'invalid' },
          { label: 'Disabled', value: 'disabled' },
        ]}
        render={(state, col) => (
          <div style={{ width: 220 }}>
            <Select
              label={`${state} ${col.label}`}
              hideLabel
              options={THEMES}
              placeholder="No theme"
              defaultValue={state === 'placeholder' ? undefined : 'dark'}
              error={state === 'invalid' ? 'Pick a theme.' : undefined}
              disabled={state === 'disabled'}
            />
          </div>
        )}
      />
      <Specimen label="Sizes (follow density)">
        <div style={{ display: 'grid', gap: 12, width: 260 }}>
          <Select label="Small" size="sm" options={THEMES} defaultValue="light" />
          <Select label="Medium" options={THEMES} defaultValue="light" />
          <Select label="Large" size="lg" options={THEMES} defaultValue="light" />
        </div>
      </Specimen>
      <Specimen label="Prefix icon">
        <div style={{ width: 260 }}>
          <Select label="Brand" options={[{ value: 'bridge', label: 'Bridge' }, { value: 'ocean', label: 'Ocean' }]} defaultValue="bridge" prefix={<Icon icon={Palette} size="sm" />} />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
