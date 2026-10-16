import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { SpecimenStack, Specimen } from '../../stories/StateGrid';
import { Button } from '../Button';
import { Link } from '../Link';
import { Alert, type AlertTone } from './Alert';

const meta = {
  title: 'Feedback/Alert',
  component: Alert,
  tags: ['autodocs'],
  args: {
    tone: 'info',
    title: 'Figma sync is running',
    children: 'New variables appear here when the sync finishes. You can keep editing.',
  },
  argTypes: {
    tone: { control: 'inline-radio', options: ['neutral', 'info', 'success', 'warning', 'danger'] },
    icon: { control: false },
    actions: { control: false },
  },
  decorators: [(Story) => <div style={{ maxWidth: 640 }}><Story /></div>],
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {};
export const Success: Story = { args: { tone: 'success', title: 'Tokens published', children: 'Version 1.4.0 is live. 12 tokens changed, 0 removed.' } };
export const Warning: Story = {
  args: { tone: 'warning', title: '3 tokens fail contrast', children: 'color.text.muted is below 4.5:1 on color.bg.subtle in the ocean brand.' },
};
export const Danger: Story = {
  args: {
    tone: 'danger',
    title: 'Publish failed',
    children: 'The token build found 2 broken aliases. Fix them and publish again.',
    actions: <Button size="sm" variant="secondary">View build log</Button>,
  },
};
export const Dismissible: Story = {
  render: (args) => {
    const [open, setOpen] = useState(true);
    return open ? (
      <Alert {...args} onDismiss={() => setOpen(false)} />
    ) : (
      <Button variant="secondary" onClick={() => setOpen(true)}>Show alert again</Button>
    );
  },
};

const COPY: Record<AlertTone, [string, string]> = {
  neutral: ['Read only', 'This branch is protected. Open a pull request to propose changes.'],
  info: ['Figma sync is running', 'New variables appear here when the sync finishes.'],
  success: ['Tokens published', 'Version 1.4.0 is live. 12 tokens changed.'],
  warning: ['3 tokens fail contrast', 'Review them before you publish.'],
  danger: ['Publish failed', 'The token build found 2 broken aliases.'],
};

export const AllStates: Story = {
  decorators: [(Story) => <div style={{ maxWidth: 720 }}><Story /></div>],
  render: () => (
    <SpecimenStack>
      <Specimen label="Tones (title, description, dismiss)">
        <div style={{ display: 'grid', gap: 12, width: '100%' }}>
          {(Object.keys(COPY) as AlertTone[]).map((tone) => (
            <Alert key={tone} tone={tone} title={COPY[tone][0]} onDismiss={() => {}} announce="off">
              {COPY[tone][1]}
            </Alert>
          ))}
        </div>
      </Specimen>
      <Specimen label="With actions">
        <Alert
          tone="warning"
          title="2 pull requests wait for design review"
          announce="off"
          actions={
            <>
              <Button size="sm" variant="secondary">Review now</Button>
              <Button size="sm" variant="ghost">Remind me later</Button>
            </>
          }
        >
          Token changes need a design owner and a tech owner before merge.
        </Alert>
      </Specimen>
      <Specimen label="Description only">
        <Alert tone="info" announce="off">
          Tokens Studio reads these files directly. <Link href="#import">See the import guide</Link>.
        </Alert>
      </Specimen>
    </SpecimenStack>
  ),
};
