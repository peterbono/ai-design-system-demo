import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronDown } from 'lucide-react';
import { Button } from '../Button';
import { Menu, MenuCheckboxItem, MenuContent, MenuTrigger } from './Menu';

// Figma variants of the MenuCheckboxItem set, one story per state, in an open menu, named like the Figma axes so the
// Storybook measure (bridge specs --measure) maps each story to its variant. The label is the set's default.

type Args = { label: string; checked: boolean; disabled: boolean };

const meta = {
  title: 'Figma variants/MenuCheckboxItem',
  args: { label: 'MenuCheckboxItem', checked: false, disabled: false },
  argTypes: { checked: { control: 'boolean' }, disabled: { control: 'boolean' }, label: { control: 'text' } },
  render: ({ label, checked, disabled }) => (
    <Menu defaultOpen>
      <MenuTrigger render={<Button variant="ghost" iconEnd={ChevronDown} />}>View</MenuTrigger>
      <MenuContent>
        <MenuCheckboxItem checked={checked} disabled={disabled}>
          {label}
        </MenuCheckboxItem>
      </MenuContent>
    </Menu>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};
export const Checked: Story = { args: { checked: true } };
export const Disabled: Story = { args: { disabled: true } };
export const CheckedDisabled: Story = { args: { checked: true, disabled: true } };
