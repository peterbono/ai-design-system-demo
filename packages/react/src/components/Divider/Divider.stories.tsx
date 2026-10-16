import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Divider } from './Divider';

const meta = {
  title: 'Data display/Divider',
  component: Divider,
  args: { orientation: 'horizontal', spacing: 'md' },
  argTypes: {
    orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] },
    spacing: { control: 'inline-radio', options: ['none', 'sm', 'md'] },
  },
  decorators: [(Story) => <div style={{ maxWidth: 420 }}><Story /></div>],
} satisfies Meta<typeof Divider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {};
export const Labelled: Story = { args: { label: 'Older changes' } };

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Horizontal between groups">
        <div style={{ width: '100%' }}>
          <p style={{ margin: 0 }}>Light theme: 220 contrast checks passing.</p>
          <Divider />
          <p style={{ margin: 0 }}>Dark theme: 220 contrast checks passing.</p>
        </div>
      </Specimen>
      <Specimen label="With label">
        <div style={{ width: '100%' }}>
          <Divider label="Or" />
        </div>
      </Specimen>
      <Specimen label="Vertical in a toolbar">
        <div style={{ display: 'flex', alignItems: 'center', height: 24 }}>
          <span>Light</span>
          <Divider orientation="vertical" spacing="sm" />
          <span>Dark</span>
          <Divider orientation="vertical" spacing="sm" />
          <span>Compact</span>
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
