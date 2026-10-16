import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { Button } from '../Button';
import { ButtonGroup } from '../ButtonGroup';
import { ToastProvider, useToast } from './Toast';

function Demo() {
  const toast = useToast();
  return (
    <ButtonGroup aria-label="Show a toast">
      <Button variant="secondary" onClick={() => toast.add({ title: 'Link copied', description: 'Share it with your reviewer.' })}>
        Neutral
      </Button>
      <Button variant="secondary" onClick={() => toast.info('Figma sync started', { description: 'It usually takes under a minute.' })}>
        Info
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast.success('Tokens published', { description: 'Version 1.4.0 is live.', action: { label: 'View release', onClick: () => {} } })
        }
      >
        Success
      </Button>
      <Button variant="secondary" onClick={() => toast.warning('Contrast check has 3 warnings', { description: 'Review before you publish.' })}>
        Warning
      </Button>
      <Button variant="secondary" onClick={() => toast.error('Publish failed', { description: '2 broken aliases. Fix them and try again.' })}>
        Danger
      </Button>
      <Button
        onClick={() =>
          toast.promise(new Promise((resolve) => setTimeout(resolve, 2000)), {
            loading: 'Publishing tokens',
            success: 'Tokens published',
            error: 'Publish failed',
          })
        }
      >
        Publish (promise)
      </Button>
    </ButtonGroup>
  );
}

function Undo() {
  const toast = useToast();
  return (
    <Button
      variant="danger"
      onClick={() =>
        toast.add({ title: 'Token deleted', description: 'color.brand.legacy was removed.', action: { label: 'Undo', onClick: () => toast.success('Token restored') } })
      }
    >
      Delete token
    </Button>
  );
}

function Visible() {
  const toast = useToast();
  useEffect(() => {
    toast.add({ id: 'v3', tone: 'danger', title: 'Publish failed', description: '2 broken aliases. Fix them and try again.', timeout: 0 });
    toast.add({ id: 'v2', tone: 'warning', title: 'Contrast check has 3 warnings', timeout: 0 });
    toast.add({
      id: 'v1',
      tone: 'success',
      title: 'Tokens published',
      description: 'Version 1.4.0 is live. 12 tokens changed.',
      action: { label: 'View release', onClick: () => {} },
      timeout: 0,
    });
  }, [toast]);
  return <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Hover or focus the stack (F6) to expand it.</p>;
}

const meta = {
  title: 'Feedback/Toast',
  component: ToastProvider,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ToastProvider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tones: Story = { render: () => <Demo /> };
export const UndoAction: Story = { render: () => <Undo /> };
export const AllStates: Story = { parameters: { layout: 'fullscreen' }, render: () => <div style={{ minHeight: 420, padding: 24 }}><Visible /></div> };
