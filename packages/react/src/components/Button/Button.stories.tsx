import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { ChevronDown, GitPullRequest, Plus, Trash2, Check, Columns2 } from 'lucide-react';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Button, type ButtonVariant } from './Button';

const meta = {
  title: 'Actions/Button',
  component: Button,
  args: { children: 'Publish tokens', variant: 'primary', size: 'md' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost', 'danger', 'link', 'inverse'] },
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
export const Link: Story = {
  args: { variant: 'link', children: 'Show only these' },
  render: (args) => (
    <p style={{ margin: 0, fontSize: 'var(--font-size-300)' }}>
      2 components need guidance. <Button {...args} />
    </p>
  ),
};
export const Inverse: Story = {
  args: { variant: 'inverse', children: 'Copy command' },
  decorators: [
    (S) => (
      <div style={{ padding: 'var(--space-6)', borderRadius: 'var(--radius-container)', backgroundColor: 'var(--color-surface-inverse)' }}>
        <S />
      </div>
    ),
  ],
};
function ToggleDemo() {
  const [on, setOn] = useState(false);
  return (
    <Button variant="secondary" iconStart={Columns2} pressed={on} onClick={() => setOn((v) => !v)}>
      Compare
    </Button>
  );
}
export const Toggle: Story = { render: () => <ToggleDemo /> };
export const FullWidth: Story = { args: { fullWidth: true }, decorators: [(S) => <div style={{ maxWidth: 360 }}><S /></div>] };

type Filled = Exclude<ButtonVariant, 'link' | 'inverse'>;
const VARIANTS: { label: string; value: Filled }[] = [
  { label: 'Primary', value: 'primary' },
  { label: 'Secondary', value: 'secondary' },
  { label: 'Ghost', value: 'ghost' },
  { label: 'Danger', value: 'danger' },
];
const LABEL: Record<Filled, string> = { primary: 'Publish', secondary: 'Save draft', ghost: 'View diff', danger: 'Delete' };

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
      <StateGrid
        columns={[{ label: 'Not pressed' }, { label: 'Pressed' }, { label: 'Pressed, hover', pseudo: 'hover' }, { label: 'Pressed, focus visible', pseudo: 'focus-visible' }]}
        rows={[
          { label: 'Toggle, secondary', value: 'secondary' as ButtonVariant },
          { label: 'Toggle, ghost', value: 'ghost' as ButtonVariant },
          { label: 'Toggle, link', value: 'link' as ButtonVariant },
        ]}
        render={(variant, col) => (
          <Button variant={variant} size="sm" pressed={col.label !== 'Not pressed'} iconStart={variant === 'link' ? undefined : col.label === 'Not pressed' ? undefined : Check}>
            {variant === 'link' ? 'Show only these' : 'Show what changed'}
          </Button>
        )}
      />
      <Specimen label="Link inside a sentence">
        <span>
          3 components need guidance. <Button variant="link">Show only these</Button>
        </span>
      </Specimen>
      <Specimen label="Inverse on a strong surface">
        <div style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-4)', borderRadius: 'var(--radius-container)', backgroundColor: 'var(--color-surface-inverse)' }}>
          <Button variant="inverse" size="sm">Copy command</Button>
          <Button variant="inverse" size="sm" disabled>Disabled</Button>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-4)', borderRadius: 'var(--radius-container)', backgroundColor: 'var(--color-action-primary-bg)' }}>
          <Button variant="inverse" size="sm">Review the change</Button>
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
