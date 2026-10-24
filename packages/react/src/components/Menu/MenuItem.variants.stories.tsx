import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronDown } from 'lucide-react';
import { Button } from '../Button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from './Menu';

// Figma variants of the MenuItem set, one story per tone and state, in an open menu, named like the Figma axes so the
// Storybook measure (bridge specs --measure) maps each story to its variant. The label is the set's default.

type Args = { label: string; tone: 'default' | 'danger'; disabled: boolean };

const meta = {
  title: 'Figma variants/MenuItem',
  args: { label: 'MenuItem', tone: 'default', disabled: false },
  argTypes: { tone: { control: 'inline-radio', options: ['default', 'danger'] }, disabled: { control: 'boolean' }, label: { control: 'text' } },
  render: ({ label, tone, disabled }) => (
    <Menu defaultOpen>
      <MenuTrigger render={<Button variant="ghost" iconEnd={ChevronDown} />}>Actions</MenuTrigger>
      <MenuContent>
        <MenuItem tone={tone} disabled={disabled}>
          {label}
        </MenuItem>
      </MenuContent>
    </Menu>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Danger: Story = { args: { tone: 'danger' } };
export const Disabled: Story = { args: { disabled: true } };
export const DangerDisabled: Story = { args: { tone: 'danger', disabled: true } };
