import type { Meta, StoryObj } from '@storybook/react-vite';
import { Copy, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { IconButton, type IconButtonVariant } from './IconButton';

const meta = {
  title: 'Actions/IconButton',
  component: IconButton,
  args: { icon: Pencil, label: 'Edit token', variant: 'ghost', size: 'md' },
  argTypes: {
    icon: { control: false },
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Secondary: Story = { args: { variant: 'secondary', icon: Copy, label: 'Copy token name' } };
export const Loading: Story = { args: { loading: true } };

const ROWS: { label: string; value: IconButtonVariant }[] = [
  { label: 'Ghost', value: 'ghost' },
  { label: 'Secondary', value: 'secondary' },
  { label: 'Primary', value: 'primary' },
  { label: 'Danger', value: 'danger' },
];

export const AllStates: Story = {
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
        rows={ROWS}
        render={(variant, col) => (
          <IconButton
            variant={variant}
            icon={variant === 'danger' ? Trash2 : MoreHorizontal}
            label={variant === 'danger' ? 'Delete token' : 'More actions'}
            loading={col.label === 'Loading'}
            disabled={col.label === 'Disabled'}
          />
        )}
      />
      <Specimen label="Sizes">
        <IconButton size="sm" icon={X} label="Close" />
        <IconButton size="md" icon={X} label="Close" />
        <IconButton size="lg" icon={X} label="Close" />
      </Specimen>
    </SpecimenStack>
  ),
};
