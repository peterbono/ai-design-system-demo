import type { Meta, StoryObj } from '@storybook/react-vite';
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Button } from '../Button';
import { IconButton } from '../IconButton';
import { ButtonGroup } from './ButtonGroup';

const meta = {
  title: 'Actions/ButtonGroup',
  component: ButtonGroup,
  tags: ['autodocs'],
  args: { appearance: 'spaced', orientation: 'horizontal', align: 'start' },
  argTypes: {
    appearance: { control: 'inline-radio', options: ['spaced', 'attached'] },
    orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] },
    align: { control: 'inline-radio', options: ['start', 'end', 'between'] },
  },
} satisfies Meta<typeof ButtonGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Footer: Story = {
  args: { align: 'end', 'aria-label': 'Review actions' },
  render: (args) => (
    <ButtonGroup {...args}>
      <Button variant="ghost">Cancel</Button>
      <Button variant="secondary">Request changes</Button>
      <Button>Approve</Button>
    </ButtonGroup>
  ),
};

export const Attached: Story = {
  args: { appearance: 'attached', 'aria-label': 'Preview theme' },
  render: (args) => (
    <ButtonGroup {...args}>
      <Button variant="secondary">Light</Button>
      <Button variant="secondary">Dark</Button>
      <Button variant="secondary">System</Button>
    </ButtonGroup>
  ),
};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Spaced, end aligned (dialog and form footers)">
        <ButtonGroup align="end" aria-label="Dialog actions" style={{ width: '100%' }}>
          <Button variant="ghost">Cancel</Button>
          <Button>Save changes</Button>
        </ButtonGroup>
      </Specimen>
      <Specimen label="Attached text buttons">
        <ButtonGroup appearance="attached" aria-label="Diff view">
          <Button variant="secondary" size="sm">Unified</Button>
          <Button variant="secondary" size="sm">Split</Button>
        </ButtonGroup>
      </Specimen>
      <Specimen label="Attached icon buttons">
        <ButtonGroup appearance="attached" aria-label="Text alignment">
          <IconButton variant="secondary" icon={AlignLeft} label="Align left" />
          <IconButton variant="secondary" icon={AlignCenter} label="Align center" />
          <IconButton variant="secondary" icon={AlignRight} label="Align right" />
        </ButtonGroup>
      </Specimen>
      <Specimen label="Vertical">
        <ButtonGroup orientation="vertical" appearance="attached" aria-label="Export format" style={{ width: 200 }}>
          <Button variant="secondary">CSS variables</Button>
          <Button variant="secondary">TypeScript</Button>
          <Button variant="secondary">DTCG JSON</Button>
        </ButtonGroup>
      </Specimen>
    </SpecimenStack>
  ),
};
