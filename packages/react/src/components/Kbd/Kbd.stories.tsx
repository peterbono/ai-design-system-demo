import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Kbd } from './Kbd';

const meta = {
  title: 'Data display/Kbd',
  component: Kbd,
  tags: ['autodocs'],
  args: { keys: ['Cmd', 'K'], size: 'md' },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md'] } },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Combination: Story = {};
export const SingleKey: Story = { args: { keys: 'Esc' } };

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Single keys">
        <Kbd keys="Esc" />
        <Kbd keys="Enter" />
        <Kbd keys="/" />
        <Kbd keys="↑" />
      </Specimen>
      <Specimen label="Combinations, md and sm">
        <Kbd keys={['Cmd', 'K']} />
        <Kbd keys={['Shift', 'Cmd', 'P']} />
        <Kbd keys={['Ctrl', 'Enter']} size="sm" />
      </Specimen>
      <Specimen label="In running text">
        <p style={{ margin: 0 }}>
          Press <Kbd keys={['Cmd', 'K']} size="sm" /> to search tokens, components and pages.
        </p>
      </Specimen>
    </SpecimenStack>
  ),
};
