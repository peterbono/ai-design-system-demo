import type { Meta, StoryObj } from '@storybook/react-vite';
import { DemoBox } from '../../stories/LayoutDemo';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Button } from '../Button';
import { Inline } from './Inline';

const meta = {
  title: 'Layout/Inline',
  component: Inline,
  tags: ['autodocs'],
  args: { gap: '2', align: 'center', justify: 'start', wrap: true },
  argTypes: {
    gap: { control: 'select', options: ['0', '0-5', '1', '1-5', '2', '3', '4', '5', '6', '8'] },
    align: { control: 'inline-radio', options: ['start', 'center', 'end', 'stretch', 'baseline'] },
    justify: { control: 'inline-radio', options: ['start', 'center', 'end', 'between'] },
    render: { control: false },
  },
} satisfies Meta<typeof Inline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Inline {...args}>
      <DemoBox>color</DemoBox>
      <DemoBox>space</DemoBox>
      <DemoBox>radius</DemoBox>
      <DemoBox>motion</DemoBox>
    </Inline>
  ),
};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Wraps on narrow widths">
        <Inline style={{ width: 240, outline: 'var(--border-width-1) dashed var(--color-border-default)' }}>
          {['color', 'space', 'radius', 'motion', 'elevation', 'layer'].map((t) => (
            <DemoBox key={t}>{t}</DemoBox>
          ))}
        </Inline>
      </Specimen>
      <Specimen label="Justify between (page header)">
        <Inline justify="between" style={{ width: 480 }}>
          <DemoBox>Tokens</DemoBox>
          <Inline gap="2">
            <Button variant="secondary" size="sm">Export</Button>
            <Button size="sm">New token</Button>
          </Inline>
        </Inline>
      </Specimen>
      <Specimen label="No wrap">
        <Inline wrap={false} gap="1" style={{ width: 200, overflow: 'hidden' }}>
          {['a', 'b', 'c', 'd', 'e', 'f'].map((t) => (
            <DemoBox key={t}>{t}</DemoBox>
          ))}
        </Inline>
      </Specimen>
    </SpecimenStack>
  ),
};
