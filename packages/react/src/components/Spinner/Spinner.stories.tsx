import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Button } from '../Button';
import { Spinner } from './Spinner';

const meta = {
  title: 'Feedback/Spinner',
  component: Spinner,
  args: { size: 'md', tone: 'signal', label: 'Loading tokens' },
  argTypes: {
    size: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg'] },
    tone: { control: 'inline-radio', options: ['current', 'signal'] },
  },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Sizes (signal tone)">
        <Spinner size="xs" tone="signal" label="Loading" />
        <Spinner size="sm" tone="signal" label="Loading" />
        <Spinner size="md" tone="signal" label="Loading" />
        <Spinner size="lg" tone="signal" label="Loading" />
      </Specimen>
      <Specimen label="Current color (inherits text)">
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', color: 'var(--color-text-muted)' }}>
          <Spinner size="sm" /> Checking contrast pairs
        </span>
      </Specimen>
      <Specimen label="Inside a control (hidden from assistive tech, the button sets aria-busy)">
        <Button loading>Publishing</Button>
        <Button variant="secondary" loading>Syncing</Button>
      </Specimen>
    </SpecimenStack>
  ),
};
