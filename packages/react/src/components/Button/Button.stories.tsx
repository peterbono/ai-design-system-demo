import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronDown, GitPullRequest, Plus, Trash2 } from 'lucide-react';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Button, type ButtonVariant } from './Button';

const meta = {
  title: 'Actions/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Publish tokens', variant: 'primary', size: 'md' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    iconStart: { control: false },
    iconEnd: { control: false },
    render: { control: false },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: 'secondary', children: 'Save as draft' } };
export const Ghost: Story = { args: { variant: 'ghost', children: 'View diff' } };
export const Danger: Story = { args: { variant: 'danger', children: 'Delete 3 tokens', iconStart: Trash2 } };
export const WithIcons: Story = { args: { iconStart: GitPullRequest, children: 'Open pull request' } };
export const Loading: Story = { args: { loading: true, children: 'Publishing' } };
export const Disabled: Story = { args: { disabled: true } };
export const FullWidth: Story = { args: { fullWidth: true }, decorators: [(S) => <div style={{ maxWidth: 360 }}><S /></div>] };

const VARIANTS: { label: string; value: ButtonVariant }[] = [
  { label: 'Primary', value: 'primary' },
  { label: 'Secondary', value: 'secondary' },
  { label: 'Ghost', value: 'ghost' },
  { label: 'Danger', value: 'danger' },
];
const LABEL: Record<ButtonVariant, string> = { primary: 'Publish', secondary: 'Save draft', ghost: 'View diff', danger: 'Delete' };

export const AllStates: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <SpecimenStack>
      <StateGrid
        columns={[
          { label: 'Default' },
          { label: 'Hover', pseudo: 'hover' },
          { label: 'Focus visible', pseudo: 'focus-visible' },
          { label: 'Pressed', pseudo: 'active' },
          { label: 'Loading' },
          { label: 'Disabled' },
        ]}
        rows={VARIANTS}
        render={(variant, col) => (
          <Button variant={variant} loading={col.label === 'Loading'} disabled={col.label === 'Disabled'}>
            {LABEL[variant]}
          </Button>
        )}
      />
      <Specimen label="Sizes (follow density)">
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
      </Specimen>
      <Specimen label="Icons">
        <Button iconStart={Plus}>New token</Button>
        <Button variant="secondary" iconEnd={ChevronDown}>Theme</Button>
        <Button variant="ghost" size="sm" iconStart={GitPullRequest}>Review</Button>
      </Specimen>
    </SpecimenStack>
  ),
};
