import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Progress } from './Progress';

const meta = {
  title: 'Feedback/Progress',
  component: Progress,
  args: { value: 64, label: 'Publishing tokens', variant: 'linear', size: 'md', tone: 'signal' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['linear', 'circular'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    tone: { control: 'inline-radio', options: ['signal', 'success', 'warning', 'danger'] },
  },
  decorators: [(Story) => <div style={{ maxWidth: 420 }}><Story /></div>],
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Linear: Story = {};
export const Indeterminate: Story = { args: { value: null, label: 'Syncing from Figma' } };
export const Circular: Story = { args: { variant: 'circular', size: 'lg', label: 'Contrast checks' } };

export const AllStates: Story = {
  decorators: [(Story) => <div style={{ maxWidth: 720 }}><Story /></div>],
  render: () => (
    <SpecimenStack>
      <Specimen label="Linear sizes">
        <div style={{ display: 'grid', gap: 20, width: 360 }}>
          <Progress value={24} size="sm" label="Small" />
          <Progress value={64} label="Medium" />
          <Progress value={88} size="lg" label="Large" />
        </div>
      </Specimen>
      <Specimen label="Linear states">
        <div style={{ display: 'grid', gap: 20, width: 360 }}>
          <Progress value={null} label="Syncing from Figma" />
          <Progress value={100} tone="success" label="Published" />
          <Progress value={40} tone="danger" label="Build stopped at 40%" />
          <Progress value={12} max={40} label="Checking contrast" getAriaValueText={(_, v) => `${v} of 40 pairs`} />
          <Progress value={52} aria-label="Upload" />
        </div>
      </Specimen>
      <Specimen label="Circular">
        <Progress variant="circular" size="sm" value={30} aria-label="Small ring" />
        <Progress variant="circular" value={64} aria-label="Medium ring" />
        <Progress variant="circular" size="lg" value={88} aria-label="Large ring with value" />
        <Progress variant="circular" value={null} aria-label="Working" />
        <Progress variant="circular" size="lg" value={100} tone="success" label="Contrast checks passed" />
      </Specimen>
    </SpecimenStack>
  ),
};
