import type { Meta, StoryObj } from '@storybook/react-vite';
import { Copy, GitBranch, Pencil, Trash2 } from 'lucide-react';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { IconButton } from '../IconButton';
import { Tooltip, TooltipProvider } from './Tooltip';

const meta = {
  title: 'Overlays/Tooltip',
  component: Tooltip,
  args: { content: 'Copy token name', side: 'top', children: <IconButton icon={Copy} label="Copy token name" /> },
  argTypes: { side: { control: 'inline-radio', options: ['top', 'bottom', 'left', 'right'] }, children: { control: false } },
  parameters: { layout: 'centered' },
  decorators: [(Story) => <TooltipProvider><Story /></TooltipProvider>],
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Toolbar: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
      <Tooltip content="Edit token"><IconButton icon={Pencil} label="Edit token" /></Tooltip>
      <Tooltip content="Copy token name"><IconButton icon={Copy} label="Copy token name" /></Tooltip>
      <Tooltip content="Start a change"><IconButton icon={GitBranch} label="Start a change" /></Tooltip>
      <Tooltip content="Delete token"><IconButton icon={Trash2} label="Delete token" /></Tooltip>
    </div>
  ),
};

export const AllStates: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <SpecimenStack>
      <Specimen label="Sides (open)">
        <div style={{ display: 'flex', gap: 'var(--space-24)', padding: 'var(--space-12) var(--space-24)' }}>
          <Tooltip content="Top" side="top" defaultOpen><IconButton icon={Pencil} label="Top" variant="secondary" /></Tooltip>
          <Tooltip content="Bottom" side="bottom" defaultOpen><IconButton icon={Copy} label="Bottom" variant="secondary" /></Tooltip>
          <Tooltip content="Left" side="left" defaultOpen><IconButton icon={GitBranch} label="Left" variant="secondary" /></Tooltip>
          <Tooltip content="Right" side="right" defaultOpen><IconButton icon={Trash2} label="Right" variant="secondary" /></Tooltip>
        </div>
      </Specimen>
      <Specimen label="Long text wraps and balances">
        <div style={{ padding: 'var(--space-12) var(--space-24) 0' }}>
          <Tooltip content="Publishing is blocked until a design owner and a tech owner approve" side="bottom" defaultOpen>
            <IconButton icon={GitBranch} label="Publishing is blocked until a design owner and a tech owner approve" variant="secondary" />
          </Tooltip>
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
