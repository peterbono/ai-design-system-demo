import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { VisuallyHidden } from '../VisuallyHidden';
import { Skeleton } from './Skeleton';

const meta = {
  title: 'Feedback/Skeleton',
  component: Skeleton,
  args: { variant: 'text', lines: 3 },
  argTypes: { variant: { control: 'inline-radio', options: ['text', 'circle', 'rect'] } },
  decorators: [(Story) => <div style={{ maxWidth: 420 }}><Story /></div>],
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Text: Story = {};
export const Circle: Story = { args: { variant: 'circle' } };
export const Rect: Story = { args: { variant: 'rect', height: '120px' } };

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Loading a token row (aria-busy pattern)">
        <div aria-busy="true" style={{ display: 'flex', gap: 12, alignItems: 'center', width: 380 }}>
          <VisuallyHidden>Loading tokens</VisuallyHidden>
          <Skeleton variant="circle" />
          <div style={{ flex: 1 }}>
            <Skeleton width="60%" />
            <Skeleton width="35%" />
          </div>
        </div>
      </Specimen>
      <Specimen label="Paragraph">
        <div style={{ width: 380 }}>
          <Skeleton lines={4} />
        </div>
      </Specimen>
      <Specimen label="Card">
        <div style={{ width: 280, display: 'grid', gap: 12 }}>
          <Skeleton variant="rect" height="120px" />
          <Skeleton width="70%" />
          <Skeleton lines={2} />
        </div>
      </Specimen>
      <Specimen label="Static (no shimmer)">
        <div style={{ width: 280 }}>
          <Skeleton lines={2} static />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
