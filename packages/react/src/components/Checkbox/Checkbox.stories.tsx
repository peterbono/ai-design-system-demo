import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Checkbox } from './Checkbox';

const meta = {
  title: 'Forms/Checkbox',
  component: Checkbox,
  args: { label: 'Notify reviewers when I open a pull request' },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Checked: Story = { args: { defaultChecked: true } };
export const Indeterminate: Story = { args: { label: 'All tokens', indeterminate: true } };
export const WithDescription: Story = {
  args: { label: 'Require two approvals', description: 'Token changes merge only after a designer and an engineer approve.' },
};
export const Disabled: Story = { args: { disabled: true, defaultChecked: true } };

type Row = 'unchecked' | 'checked' | 'indeterminate' | 'invalid' | 'disabled' | 'disabledChecked';

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid<Row>
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus visible', pseudo: 'focus-visible' }]}
        rows={[
          { label: 'Unchecked', value: 'unchecked' },
          { label: 'Checked', value: 'checked' },
          { label: 'Indeterminate', value: 'indeterminate' },
          { label: 'Invalid', value: 'invalid' },
          { label: 'Disabled', value: 'disabled' },
          { label: 'Disabled checked', value: 'disabledChecked' },
        ]}
        render={(row) => (
          <Checkbox
            label="Dark theme"
            defaultChecked={row === 'checked' || row === 'disabledChecked'}
            indeterminate={row === 'indeterminate' || undefined}
            invalid={row === 'invalid'}
            disabled={row === 'disabled' || row === 'disabledChecked'}
          />
        )}
      />
      <Specimen label="With description">
        <Checkbox label="Require two approvals" description="Token changes merge only after a designer and an engineer approve." defaultChecked />
      </Specimen>
    </SpecimenStack>
  ),
};
