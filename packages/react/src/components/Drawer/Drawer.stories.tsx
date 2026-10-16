import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../Button';
import { ButtonGroup } from '../ButtonGroup';
import { Input } from '../Input';
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger, type DrawerSide } from './Drawer';

const meta = {
  title: 'Overlays/Drawer',
  component: Drawer,
  args: { side: 'end' },
  argTypes: { side: { control: 'inline-radio', options: ['start', 'end', 'bottom'] } },
} satisfies Meta<typeof Drawer>;

export default meta;
type Story = StoryObj<typeof meta>;

function TokenDetails({ side, defaultOpen }: { side: DrawerSide; defaultOpen?: boolean }) {
  return (
    <Drawer side={side} defaultOpen={defaultOpen}>
      <DrawerTrigger render={<Button variant="secondary" />}>Edit token</DrawerTrigger>
      <DrawerContent
        title="color.signal.default"
        description="Used by focus rings, active tabs and progress."
        footer={
          <ButtonGroup align="end">
            <DrawerClose render={<Button variant="ghost" />}>Cancel</DrawerClose>
            <DrawerClose render={<Button />}>Save changes</DrawerClose>
          </ButtonGroup>
        }
      >
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Input label="Light value" defaultValue="{palette.accent.500}" />
          <Input label="Dark value" defaultValue="{palette.accent.400}" />
          <Input label="Description" defaultValue="The signal: active indicators, progress, slider range." />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export const End: Story = { render: (args) => <TokenDetails side={args.side ?? 'end'} /> };
export const Start: Story = { args: { side: 'start' }, render: (args) => <TokenDetails side={args.side ?? 'start'} /> };
export const Bottom: Story = { args: { side: 'bottom' }, render: (args) => <TokenDetails side={args.side ?? 'bottom'} /> };

export const AllStates: Story = { render: () => <TokenDetails side="end" defaultOpen /> };
