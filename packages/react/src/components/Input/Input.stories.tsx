import type { Meta, StoryObj } from '@storybook/react-vite';
import { Search } from 'lucide-react';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Icon } from '../Icon';
import { Input } from './Input';

const meta = {
  title: 'Forms/Input',
  component: Input,
  tags: ['autodocs'],
  args: { label: 'Token name', placeholder: 'color.action.primary.bg', hint: 'Dot-separated path, lowercase.' },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] }, prefix: { control: false }, suffix: { control: false } },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

const narrow = [(Story: () => JSX.Element) => <div style={{ maxWidth: 360 }}><Story /></div>];

export const Default: Story = { decorators: narrow };
export const WithError: Story = { decorators: narrow, args: { defaultValue: 'Color Primary', error: 'Use lowercase and dots, like color.action.primary.' } };
export const Required: Story = { decorators: narrow, args: { required: true } };
export const PrefixAndSuffix: Story = {
  decorators: narrow,
  args: { label: 'Spacing value', hint: undefined, placeholder: '16', suffix: 'px', type: 'number', inputMode: 'numeric' },
};
export const Search_: Story = {
  name: 'Search',
  decorators: narrow,
  args: { label: 'Search tokens', hint: undefined, placeholder: 'Search tokens', type: 'search', prefix: <Icon icon={Search} size="sm" /> },
};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid
        columns={[
          { label: 'Default' },
          { label: 'Hover', pseudo: 'hover' },
          { label: 'Focus', pseudo: 'focus-visible' },
        ]}
        rows={[
          { label: 'Empty', value: 'empty' },
          { label: 'Filled', value: 'filled' },
          { label: 'Invalid', value: 'invalid' },
          { label: 'Disabled', value: 'disabled' },
          { label: 'Read only', value: 'readonly' },
        ]}
        render={(state, col, i) => (
          <div style={{ width: 240 }}>
            <Input
              label="Token name"
              hideLabel
              id={`input-${state}-${i}`}
              placeholder="color.action.primary.bg"
              defaultValue={state === 'empty' ? undefined : state === 'invalid' ? 'Color Primary' : 'color.signal.default'}
              error={state === 'invalid' ? 'Use lowercase and dots.' : undefined}
              disabled={state === 'disabled'}
              readOnly={state === 'readonly'}
              aria-label={`${state} ${col.label}`}
            />
          </div>
        )}
      />
      <Specimen label="Sizes">
        <div style={{ display: 'grid', gap: 12, width: 280 }}>
          <Input label="Small" size="sm" placeholder="sm" />
          <Input label="Medium" placeholder="md" />
          <Input label="Large" size="lg" placeholder="lg" />
        </div>
      </Specimen>
      <Specimen label="Field anatomy">
        <div style={{ width: 320 }}>
          <Input label="Figma file URL" required hint="Paste the link from Share, Copy link." placeholder="https://www.figma.com/design/..." error="Enter a Figma design link." />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
