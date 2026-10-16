import type { Meta, StoryObj } from '@storybook/react-vite';
import { DemoBox } from '../../stories/LayoutDemo';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Grid } from './Grid';

const meta = {
  title: 'Layout/Grid',
  component: Grid,
  tags: ['autodocs'],
  args: { columns: 3, gap: '4' },
  argTypes: {
    gap: { control: 'select', options: ['0', '1', '2', '3', '4', '5', '6', '8'] },
    minItemWidth: { control: 'select', options: [undefined, '60', '72', '80', '96', '120'] },
    render: { control: false },
  },
} satisfies Meta<typeof Grid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Grid {...args}>
      {Array.from({ length: 6 }, (_, i) => (
        <DemoBox key={i} tall>{i + 1}</DemoBox>
      ))}
    </Grid>
  ),
};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Fixed columns: 4">
        <Grid columns={4} gap="3" style={{ width: '100%' }}>
          {Array.from({ length: 8 }, (_, i) => (
            <DemoBox key={i}>{i + 1}</DemoBox>
          ))}
        </Grid>
      </Specimen>
      <Specimen label="Auto-fit, min item width 60 (240px)">
        <Grid minItemWidth="60" style={{ width: '100%' }}>
          {Array.from({ length: 5 }, (_, i) => (
            <DemoBox key={i} tall>Component {i + 1}</DemoBox>
          ))}
        </Grid>
      </Specimen>
    </SpecimenStack>
  ),
};
