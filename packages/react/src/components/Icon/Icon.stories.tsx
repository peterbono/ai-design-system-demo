import type { Meta, StoryObj } from '@storybook/react-vite';
import { CircleCheck, GitBranch, GitPullRequest, Pencil, TriangleAlert } from 'lucide-react';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Icon, type IconSize } from './Icon';

const meta = {
  title: 'Foundations/Icon',
  component: Icon,
  args: { icon: GitPullRequest, size: 'sm' },
  argTypes: {
    icon: { control: false },
    size: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg'] },
    label: { control: 'text' },
  },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Large: Story = { args: { size: 'lg' } };
export const WithLabel: Story = { args: { icon: TriangleAlert, size: 'md', label: 'Contrast below 4.5:1' } };

const SIZES: { label: string; value: IconSize }[] = [
  { label: 'xs (12)', value: 'xs' },
  { label: 'sm (16)', value: 'sm' },
  { label: 'md (20)', value: 'md' },
  { label: 'lg (24)', value: 'lg' },
];

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid
        columns={[{ label: 'Pull request' }, { label: 'Branch' }, { label: 'Edit' }, { label: 'Passed' }]}
        rows={SIZES}
        render={(size, col) => <Icon icon={{ 'Pull request': GitPullRequest, Branch: GitBranch, Edit: Pencil, Passed: CircleCheck }[col.label] ?? GitPullRequest} size={size} />}
      />
      <Specimen label="Inherits the text color">
        <span style={{ color: 'var(--color-feedback-success-text)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon icon={CircleCheck} /> Contrast 4.8:1
        </span>
        <span style={{ color: 'var(--color-feedback-warning-text)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon icon={TriangleAlert} label="Warning" /> 2 unused tokens
        </span>
      </Specimen>
    </SpecimenStack>
  ),
};
