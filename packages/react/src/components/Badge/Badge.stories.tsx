import type { Meta, StoryObj } from '@storybook/react-vite';
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Badge, type BadgeTone } from './Badge';

const meta = {
  title: 'Data display/Badge',
  component: Badge,
  args: { children: 'Draft', tone: 'neutral', appearance: 'subtle', size: 'md' },
  argTypes: {
    tone: { control: 'select', options: ['neutral', 'success', 'warning', 'danger', 'info'] },
    appearance: { control: 'inline-radio', options: ['subtle', 'solid'] },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    icon: { control: false },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Subtle: Story = { args: { tone: 'success', children: 'Published' } };
export const Solid: Story = { args: { tone: 'danger', appearance: 'solid', children: 'Build failed' } };
export const WithDot: Story = { args: { tone: 'warning', dot: true, children: 'Needs review' } };

const TONES: { label: string; value: BadgeTone }[] = [
  { label: 'Neutral', value: 'neutral' },
  { label: 'Success', value: 'success' },
  { label: 'Warning', value: 'warning' },
  { label: 'Danger', value: 'danger' },
  { label: 'Info', value: 'info' },
];
const TEXT: Record<BadgeTone, string> = { neutral: 'Draft', success: 'Published', warning: 'Needs review', danger: 'Failed', info: 'Beta' };

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid
        columns={[{ label: 'Subtle' }, { label: 'Subtle with dot' }, { label: 'Solid' }, { label: 'Small' }]}
        rows={TONES}
        render={(tone, col) => (
          <Badge
            tone={tone}
            appearance={col.label === 'Solid' ? 'solid' : 'subtle'}
            dot={col.label === 'Subtle with dot'}
            size={col.label === 'Small' ? 'sm' : 'md'}
          >
            {TEXT[tone]}
          </Badge>
        )}
      />
      <Specimen label="With icons">
        <Badge tone="success" icon={CircleCheck}>Contrast 4.8:1</Badge>
        <Badge tone="warning" icon={TriangleAlert}>2 unused tokens</Badge>
        <Badge tone="danger" icon={CircleAlert} appearance="solid">Breaking</Badge>
      </Specimen>
    </SpecimenStack>
  ),
};
