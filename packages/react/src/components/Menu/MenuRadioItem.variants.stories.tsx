import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronDown } from 'lucide-react';
import { Button } from '../Button';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from './Menu';

// Figma variants of the MenuRadioItem set, one story per state, in an open menu. An item is checked through its
// radio group's value, not a prop of its own: `checked` is a story arg the render turns into the group's value, named
// like the Figma axis so the Storybook measure (bridge specs --measure) maps each story to its variant. The label is
// the set's default.

type Args = { label: string; checked: boolean; disabled: boolean };

const meta = {
  title: 'Figma variants/MenuRadioItem',
  args: { label: 'MenuRadioItem', checked: false, disabled: false },
  argTypes: { checked: { control: 'boolean' }, disabled: { control: 'boolean' }, label: { control: 'text' } },
  render: ({ label, checked, disabled }) => (
    <Menu defaultOpen>
      <MenuTrigger render={<Button variant="ghost" iconEnd={ChevronDown} />}>Sort</MenuTrigger>
      <MenuContent>
        <MenuRadioGroup value={checked ? 'item' : ''}>
          <MenuRadioItem value="item" disabled={disabled}>
            {label}
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};
export const Checked: Story = { args: { checked: true } };
export const Disabled: Story = { args: { disabled: true } };
