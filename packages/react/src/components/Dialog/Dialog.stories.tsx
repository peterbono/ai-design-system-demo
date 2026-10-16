import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '../Button';
import { ButtonGroup } from '../ButtonGroup';
import { Input } from '../Input';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from './Dialog';

const meta = {
  title: 'Overlays/Dialog',
  component: Dialog,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const footer = (
  <ButtonGroup align="end">
    <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
    <DialogClose render={<Button />}>Rename token</DialogClose>
  </ButtonGroup>
);

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary" />}>Rename token</DialogTrigger>
      <DialogContent title="Rename token" description="References in components update in the next release." footer={footer}>
        <Input label="New name" defaultValue="color.signal.default" hint="Dot-separated path, lowercase." />
      </DialogContent>
    </Dialog>
  ),
};

export const LongContent: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary" />}>Review release notes</DialogTrigger>
      <DialogContent
        size="lg"
        title="Release 2.4.0"
        description="12 token changes and 3 component updates since 2.3.1."
        footer={
          <ButtonGroup align="end">
            <DialogClose render={<Button variant="ghost" />}>Close</DialogClose>
            <DialogClose render={<Button />}>Publish release</DialogClose>
          </ButtonGroup>
        }
      >
        {Array.from({ length: 14 }, (_, i) => (
          <p key={i} style={{ margin: '0 0 var(--space-3)' }}>
            Change {i + 1}: color.action.primary.bg now aliases palette.primary.900 in light and palette.primary.50 in dark,
            so primary buttons keep 4.5:1 contrast in both themes.
          </p>
        ))}
      </DialogContent>
    </Dialog>
  ),
};

export const Controlled: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Invite reviewer</Button>
        <Dialog open={open} onOpenChange={setOpen} disablePointerDismissal>
          <DialogContent
            size="sm"
            title="Invite reviewer"
            description="They can approve token and component changes."
            footer={
              <ButtonGroup align="end">
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => setOpen(false)}>Send invite</Button>
              </ButtonGroup>
            }
          >
            <Input label="Work email" type="email" placeholder="name@company.com" />
          </DialogContent>
        </Dialog>
      </>
    );
  },
};

/** Open by default so the surface, header, body and footer can be reviewed in every theme. */
export const AllStates: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="secondary" />}>Rename token</DialogTrigger>
      <DialogContent title="Rename token" description="References in components update in the next release." footer={footer}>
        <Input label="New name" defaultValue="color.signal.default" hint="Dot-separated path, lowercase." />
      </DialogContent>
    </Dialog>
  ),
};
