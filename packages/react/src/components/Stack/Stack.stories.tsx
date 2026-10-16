import type { Meta, StoryObj } from '@storybook/react-vite';
import { DemoBox } from '../../stories/LayoutDemo';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Stack } from './Stack';

const GAPS = ['0', '0-5', '1', '1-5', '2', '3', '4', '5', '6', '8', '10', '12', '16'] as const;

const meta = {
  title: 'Layout/Stack',
  component: Stack,
  args: { gap: '3', align: 'stretch', justify: 'start' },
  argTypes: {
    gap: { control: 'select', options: GAPS },
    align: { control: 'inline-radio', options: ['start', 'center', 'end', 'stretch', 'baseline'] },
    justify: { control: 'inline-radio', options: ['start', 'center', 'end', 'between'] },
    render: { control: false },
  },
} satisfies Meta<typeof Stack>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Stack {...args} style={{ maxWidth: 320 }}>
      <DemoBox>Token name</DemoBox>
      <DemoBox>Value</DemoBox>
      <DemoBox>Description</DemoBox>
    </Stack>
  ),
};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Default gap (layout.gap: 16 comfortable, 12 compact)">
        <Stack style={{ width: 200 }}>
          <DemoBox>1</DemoBox>
          <DemoBox>2</DemoBox>
          <DemoBox>3</DemoBox>
        </Stack>
      </Specimen>
      <Specimen label="Gap scale">
        {(['1', '2', '4', '8'] as const).map((g) => (
          <Stack key={g} gap={g} style={{ width: 96 }}>
            <DemoBox>gap {g}</DemoBox>
            <DemoBox />
            <DemoBox />
          </Stack>
        ))}
      </Specimen>
      <Specimen label="Align start, center, end">
        {(['start', 'center', 'end'] as const).map((a) => (
          <Stack key={a} align={a} gap="2" style={{ width: 160 }}>
            <DemoBox>{a}</DemoBox>
            <DemoBox>longer item</DemoBox>
          </Stack>
        ))}
      </Specimen>
    </SpecimenStack>
  ),
};
