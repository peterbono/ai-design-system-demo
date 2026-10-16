import type { Meta, StoryObj } from '@storybook/react-vite';
import { Info } from 'lucide-react';
import { Button } from '../Button';
import { IconButton } from '../IconButton';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './Popover';

const meta = {
  title: 'Overlays/Popover',
  component: Popover,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger render={<IconButton icon={Info} label="About contrast checks" variant="secondary" />} />
      <PopoverContent title="Contrast checks" description="The token build checks 55 color pairs in every brand and theme and fails below WCAG minimums." />
    </Popover>
  ),
};

export const WithActions: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger render={<Button variant="secondary" />}>Branch: feat/tokens-v2</PopoverTrigger>
      <PopoverContent title="Switch branch" showClose side="bottom" align="start">
        <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>3 commits ahead of main, 1 open review.</p>
        <PopoverClose render={<Button size="sm" />}>Open pull request</PopoverClose>
      </PopoverContent>
    </Popover>
  ),
};

export const AllStates: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div style={{ display: 'flex', justifyContent: 'center', paddingBlock: 'var(--space-20) var(--space-24)' }}>
      <Popover defaultOpen>
        <PopoverTrigger render={<Button variant="secondary" />}>Reviewers</PopoverTrigger>
        <PopoverContent title="Required reviewers" description="One design owner and one tech owner must approve token changes." showClose />
      </Popover>
    </div>
  ),
};
