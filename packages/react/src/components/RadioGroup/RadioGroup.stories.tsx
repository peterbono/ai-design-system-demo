import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Radio, RadioGroup } from './RadioGroup';

const meta = {
  title: 'Forms/RadioGroup',
  component: RadioGroup,
  args: { label: 'Merge strategy', defaultValue: 'squash', children: null },
  argTypes: { orientation: { control: 'inline-radio', options: ['vertical', 'horizontal'] } },
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

const options = (
  <>
    <Radio value="merge" label="Merge commit" description="Keeps every commit from the branch." />
    <Radio value="squash" label="Squash and merge" description="One commit per pull request. Recommended for token changes." />
    <Radio value="rebase" label="Rebase and merge" />
  </>
);

export const Default: Story = { render: (args) => <RadioGroup {...args}>{options}</RadioGroup> };
export const Horizontal: Story = {
  args: { label: 'Theme', orientation: 'horizontal', defaultValue: 'light' },
  render: (args) => (
    <RadioGroup {...args}>
      <Radio value="light" label="Light" />
      <Radio value="dark" label="Dark" />
      <Radio value="system" label="System" />
    </RadioGroup>
  ),
};
export const Invalid: Story = { args: { defaultValue: undefined, required: true, error: 'Pick a merge strategy before you publish.' }, render: (args) => <RadioGroup {...args}>{options}</RadioGroup> };

type Row = 'unchecked' | 'checked' | 'disabled' | 'disabledChecked';

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid<Row>
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus visible', pseudo: 'focus-visible' }]}
        rows={[
          { label: 'Unselected', value: 'unchecked' },
          { label: 'Selected', value: 'checked' },
          { label: 'Disabled', value: 'disabled' },
          { label: 'Disabled selected', value: 'disabledChecked' },
        ]}
        render={(row, col) => (
          <RadioGroup label={`${row} ${col.label}`} hideLabel defaultValue={row === 'checked' || row === 'disabledChecked' ? 'a' : undefined} disabled={row.startsWith('disabled')}>
            <Radio value="a" label="Squash and merge" />
          </RadioGroup>
        )}
      />
      <Specimen label="Invalid">
        <RadioGroup label="Merge strategy" required error="Pick a merge strategy before you publish.">
          {options}
        </RadioGroup>
      </Specimen>
    </SpecimenStack>
  ),
};
