import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronDown, Copy, FolderInput, GitBranch, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../Button';
import { IconButton } from '../IconButton';
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenu,
  MenuTrigger,
} from './Menu';

const meta = {
  title: 'Overlays/Menu',
  component: Menu,
} satisfies Meta<typeof Menu>;

export default meta;
type Story = StoryObj<typeof meta>;

function TokenActions({ defaultOpen }: { defaultOpen?: boolean }) {
  return (
    <Menu defaultOpen={defaultOpen}>
      <MenuTrigger render={<Button variant="secondary" iconEnd={ChevronDown} />}>Token actions</MenuTrigger>
      <MenuContent>
        <MenuItem icon={Pencil} shortcut="E">Rename</MenuItem>
        <MenuItem icon={Copy} shortcut="Cmd+D">Duplicate</MenuItem>
        <MenuSubmenu icon={FolderInput} label="Move to group">
          <MenuItem>color.action</MenuItem>
          <MenuItem>color.feedback</MenuItem>
          <MenuItem>color.surface</MenuItem>
        </MenuSubmenu>
        <MenuItem icon={GitBranch} disabled>Open in branch</MenuItem>
        <MenuSeparator />
        <MenuItem icon={Trash2} tone="danger" shortcut="Del">Delete token</MenuItem>
      </MenuContent>
    </Menu>
  );
}

export const Actions: Story = { render: () => <TokenActions /> };

export const RowOverflow: Story = {
  render: () => (
    <Menu>
      <MenuTrigger render={<IconButton icon={MoreHorizontal} label="More actions for color.signal.default" />} />
      <MenuContent align="end">
        <MenuItem>View usage</MenuItem>
        <MenuItem>Copy CSS variable</MenuItem>
        <MenuSeparator />
        <MenuItem tone="danger">Deprecate</MenuItem>
      </MenuContent>
    </Menu>
  ),
};

function ViewOptions({ defaultOpen }: { defaultOpen?: boolean }) {
  return (
    <Menu defaultOpen={defaultOpen}>
      <MenuTrigger render={<Button variant="ghost" iconEnd={ChevronDown} />}>View</MenuTrigger>
      <MenuContent>
        <MenuGroup label="Columns">
          <MenuCheckboxItem defaultChecked>Light value</MenuCheckboxItem>
          <MenuCheckboxItem defaultChecked>Dark value</MenuCheckboxItem>
          <MenuCheckboxItem>Description</MenuCheckboxItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuRadioGroup label="Sort by" defaultValue="name">
          <MenuRadioItem value="name">Name</MenuRadioItem>
          <MenuRadioItem value="updated">Last updated</MenuRadioItem>
          <MenuRadioItem value="usage">Usage</MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

export const CheckableItems: Story = { render: () => <ViewOptions /> };

export const AllStates: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-6)', minHeight: 'var(--size-96)' }}>
      <TokenActions defaultOpen />
    </div>
  ),
};

export const AllStatesCheckable: Story = {
  name: 'All states (checkable)',
  parameters: { layout: 'padded' },
  render: () => (
    <div style={{ minHeight: 'var(--size-96)' }}>
      <ViewOptions defaultOpen />
    </div>
  ),
};
