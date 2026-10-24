import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronDown } from 'lucide-react';
import { Button } from '../Button';
import { Menu, MenuContent, MenuItem, MenuSubmenu, MenuTrigger } from './Menu';

// Figma variants of the MenuSubmenu set (its trigger row), one story per state, in an open menu, named like the Figma
// axes so the Storybook measure (bridge specs --measure) maps each story to its variant. The label is the set's default.

type Args = { label: string; disabled: boolean };

const meta = {
  title: 'Figma variants/MenuSubmenu',
  args: { label: 'Label', disabled: false },
  argTypes: { disabled: { control: 'boolean' }, label: { control: 'text' } },
  render: ({ label, disabled }) => (
    <Menu defaultOpen>
      <MenuTrigger render={<Button variant="ghost" iconEnd={ChevronDown} />}>More</MenuTrigger>
      <MenuContent>
        <MenuSubmenu label={label} disabled={disabled}>
          <MenuItem>Item</MenuItem>
        </MenuSubmenu>
      </MenuContent>
    </Menu>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
