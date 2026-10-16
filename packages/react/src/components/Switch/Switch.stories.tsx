import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Switch } from './Switch';

const meta = {
  title: 'Forms/Switch',
  component: Switch,
  args: { label: 'Auto-publish approved tokens' },
  argTypes: { labelPlacement: { control: 'inline-radio', options: ['end', 'start'] }, size: { control: 'inline-radio', options: ['sm', 'md'] } },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const On: Story = { args: { defaultChecked: true } };
export const WithDescription: Story = { args: { description: 'Publishes a new package version after two approvals.' } };
export const SettingsRow: Story = {
  args: { labelPlacement: 'start', description: 'Email me when someone requests my review.', label: 'Review requests' },
  decorators: [(S) => <div style={{ maxWidth: 480 }}><S /></div>],
};

type Row = 'off' | 'on' | 'disabledOff' | 'disabledOn';

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid<Row>
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus visible', pseudo: 'focus-visible' }]}
        rows={[
          { label: 'Off', value: 'off' },
          { label: 'On', value: 'on' },
          { label: 'Disabled off', value: 'disabledOff' },
          { label: 'Disabled on', value: 'disabledOn' },
        ]}
        render={(row) => <Switch label="Dark theme" defaultChecked={row === 'on' || row === 'disabledOn'} disabled={row.startsWith('disabled')} />}
      />
      <Specimen label="Sizes">
        <Switch size="sm" label="Small" defaultChecked />
        <Switch size="md" label="Medium" defaultChecked />
      </Specimen>
      <Specimen label="Settings list (label first)">
        <div style={{ display: 'grid', gap: 12, width: 420 }}>
          <Switch labelPlacement="start" label="Review requests" description="Email me when someone requests my review." defaultChecked />
          <Switch labelPlacement="start" label="Weekly digest" description="A summary of token changes every Monday." />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
