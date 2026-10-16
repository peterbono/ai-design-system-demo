import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from './Badge';

const meta = {
  title: 'Components/Badge',
  component: Badge,
  tags: ['autodocs'],
  args: { children: 'Draft', tone: 'neutral' },
  argTypes: { tone: { control: 'select', options: ['neutral', 'success', 'warning', 'danger', 'info'] } },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};
export const Success: Story = { args: { tone: 'success', children: 'Published' } };
export const Warning: Story = { args: { tone: 'warning', children: 'Needs review' } };
export const Danger: Story = { args: { tone: 'danger', children: 'Failed' } };
export const Info: Story = { args: { tone: 'info', children: 'Beta' } };

export const AllTones: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <Badge tone="neutral">Draft</Badge>
      <Badge tone="success">Published</Badge>
      <Badge tone="warning">Needs review</Badge>
      <Badge tone="danger">Failed</Badge>
      <Badge tone="info">Beta</Badge>
    </div>
  ),
};
