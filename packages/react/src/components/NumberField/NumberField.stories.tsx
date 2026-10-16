import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { NumberField } from './NumberField';

const meta = {
  title: 'Forms/NumberField',
  component: NumberField,
  tags: ['autodocs'],
  args: { label: 'Required approvals', defaultValue: 2, min: 1, max: 5, hint: 'Reviews needed before a token change merges.' },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] } },
} satisfies Meta<typeof NumberField>;

export default meta;
type Story = StoryObj<typeof meta>;

const narrow: Story['decorators'] = [(S) => <div style={{ maxWidth: 240 }}><S /></div>];

export const Default: Story = { decorators: narrow };
export const WithUnit: Story = { decorators: narrow, args: { label: 'Base spacing', hint: undefined, defaultValue: 4, min: 1, max: 16, suffix: 'px' } };
export const Invalid: Story = { decorators: narrow, args: { defaultValue: 0, error: 'Use at least 1 approval.' } };

type Row = 'default' | 'invalid' | 'disabled' | 'readonly';

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid<Row>
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus', pseudo: 'focus-visible' }]}
        rows={[
          { label: 'Default', value: 'default' },
          { label: 'Invalid', value: 'invalid' },
          { label: 'Disabled', value: 'disabled' },
          { label: 'Read only', value: 'readonly' },
        ]}
        render={(row, col) => (
          <div style={{ width: 180 }}>
            <NumberField
              label={`Approvals ${row} ${col.label}`}
              hideLabel
              defaultValue={2}
              min={1}
              max={5}
              disabled={row === 'disabled'}
              readOnly={row === 'readonly'}
              error={row === 'invalid' ? 'Use 1 to 5.' : undefined}
            />
          </div>
        )}
      />
      <Specimen label="Sizes and unit">
        <div style={{ display: 'grid', gap: 12, width: 200 }}>
          <NumberField label="Small" size="sm" defaultValue={8} suffix="px" />
          <NumberField label="Medium" defaultValue={16} suffix="px" />
          <NumberField label="Large" size="lg" defaultValue={24} suffix="px" />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
