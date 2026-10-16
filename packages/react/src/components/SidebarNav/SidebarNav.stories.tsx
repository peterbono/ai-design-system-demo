import type { Meta, StoryObj } from '@storybook/react-vite';
import { Boxes, GitPullRequest, History, LayoutDashboard, Palette, Settings, ShieldCheck } from 'lucide-react';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { SidebarNav, SidebarNavItem, SidebarNavSection } from './SidebarNav';

const meta = {
  title: 'Navigation/SidebarNav',
  component: SidebarNav,
  tags: ['autodocs'],
  args: { 'aria-label': 'Library' },
} satisfies Meta<typeof SidebarNav>;

export default meta;
type Story = StoryObj<typeof meta>;

const AppNav = ({ label = 'Library' }: { label?: string }) => (
  <SidebarNav aria-label={label}>
    <SidebarNavSection>
      <SidebarNavItem href="#overview" icon={LayoutDashboard}>Overview</SidebarNavItem>
    </SidebarNavSection>
    <SidebarNavSection title="Library">
      <SidebarNavItem href="#tokens" icon={Palette} active>Tokens</SidebarNavItem>
      <SidebarNavItem href="#components" icon={Boxes}>Components</SidebarNavItem>
      <SidebarNavItem href="#changelog" icon={History}>Changelog</SidebarNavItem>
    </SidebarNavSection>
    <SidebarNavSection title="Governance" collapsible>
      <SidebarNavItem href="#reviews" icon={GitPullRequest} count={3}>Reviews</SidebarNavItem>
      <SidebarNavItem href="#contrast" icon={ShieldCheck}>Contrast checks</SidebarNavItem>
    </SidebarNavSection>
    <SidebarNavSection title="Workspace" collapsible defaultOpen={false}>
      <SidebarNavItem href="#settings" icon={Settings}>Settings</SidebarNavItem>
    </SidebarNavSection>
  </SidebarNav>
);

export const Default: Story = { render: () => <div style={{ width: 248 }}><AppNav /></div> };

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid
        columns={[
          { label: 'Default' },
          { label: 'Hover', pseudo: 'hover' },
          { label: 'Focus visible', pseudo: 'focus-visible' },
          { label: 'Pressed', pseudo: 'active' },
        ]}
        rows={[
          { label: 'Item', value: false },
          { label: 'Current page', value: true },
        ]}
        render={(active, col) => (
          <div style={{ width: 200 }}>
            <SidebarNav aria-label={`${active ? 'Current' : 'Item'} ${col.label}`}>
              <SidebarNavSection>
                <SidebarNavItem href="#reviews" icon={GitPullRequest} count={3} active={active}>
                  Reviews
                </SidebarNavItem>
              </SidebarNavSection>
            </SidebarNav>
          </div>
        )}
      />
      <Specimen label="Full navigation (sections, collapsible, counts)">
        <div style={{ width: 248 }}>
          <AppNav label="Full navigation" />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
