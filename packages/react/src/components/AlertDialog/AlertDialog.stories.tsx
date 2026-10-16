import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../Button';
import { AlertDialog, AlertDialogContent, AlertDialogTrigger } from './AlertDialog';

const meta = {
  title: 'Overlays/AlertDialog',
  component: AlertDialog,
  tags: ['autodocs'],
} satisfies Meta<typeof AlertDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Destructive: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="danger" iconStart={Trash2} />}>Delete 3 tokens</AlertDialogTrigger>
      <AlertDialogContent
        title="Delete 3 tokens?"
        description="Components that use them fall back to their defaults. This cannot be undone."
        confirmLabel="Delete tokens"
      />
    </AlertDialog>
  ),
};

export const Consequential: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger render={<Button />}>Publish release</AlertDialogTrigger>
      <AlertDialogContent
        tone="primary"
        title="Publish release 2.4.0?"
        description="Consumers on the latest channel get it on their next install."
        confirmLabel="Publish release"
      />
    </AlertDialog>
  ),
};

export const AsyncConfirm: Story = {
  render: function Render() {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    return (
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger render={<Button variant="danger" />}>Revoke access</AlertDialogTrigger>
        <AlertDialogContent
          title="Revoke access for Ines?"
          description="She can no longer review or merge changes in this system."
          confirmLabel={busy ? 'Revoking' : 'Revoke access'}
          loading={busy}
          closeOnConfirm={false}
          onConfirm={() => {
            setBusy(true);
            setTimeout(() => {
              setBusy(false);
              setOpen(false);
            }, 1200);
          }}
        />
      </AlertDialog>
    );
  },
};

export const AllStates: Story = {
  render: () => (
    <AlertDialog defaultOpen>
      <AlertDialogTrigger render={<Button variant="danger" iconStart={Trash2} />}>Delete 3 tokens</AlertDialogTrigger>
      <AlertDialogContent
        title="Delete 3 tokens?"
        description="Components that use them fall back to their defaults. This cannot be undone."
        confirmLabel="Delete tokens"
      >
        <ul style={{ margin: 0, paddingInlineStart: 'var(--space-5)', fontFamily: 'var(--font-family-mono)', fontSize: 'var(--font-size-100)' }}>
          <li>color.legacy.brand</li>
          <li>color.legacy.accent</li>
          <li>space.legacy.gutter</li>
        </ul>
      </AlertDialogContent>
    </AlertDialog>
  ),
};
