import type { Meta, StoryObj } from '@storybook/react-vite';
import { Boxes, GitPullRequest, History, Palette } from 'lucide-react';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Tab, Tabs, TabsList, TabsPanel, type TabsVariant } from './Tabs';

const meta = {
  title: 'Navigation/Tabs',
  component: Tabs,
  args: { variant: 'underline', size: 'md', defaultValue: 'tokens' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['underline', 'contained'] },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] },
  },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

const Library = (args: Story['args']) => (
  <Tabs {...args}>
    <TabsList aria-label="Library views">
      <Tab value="tokens" icon={Palette}>Tokens</Tab>
      <Tab value="components" icon={Boxes}>Components</Tab>
      <Tab value="reviews" icon={GitPullRequest} count={3}>Reviews</Tab>
      <Tab value="changelog" icon={History}>Changelog</Tab>
    </TabsList>
    <TabsPanel value="tokens">412 tokens across 2 brands and 2 themes.</TabsPanel>
    <TabsPanel value="components">38 components, 4 with open changes.</TabsPanel>
    <TabsPanel value="reviews">3 pull requests wait for design review.</TabsPanel>
    <TabsPanel value="changelog">Version 1.0.0 published today.</TabsPanel>
  </Tabs>
);

export const Underline: Story = { render: (args) => <Library {...args} /> };
export const Contained: Story = { args: { variant: 'contained' }, render: (args) => <Library {...args} /> };
export const Vertical: Story = { args: { orientation: 'vertical' }, render: (args) => <Library {...args} /> };

const VARIANTS: { label: string; value: TabsVariant }[] = [
  { label: 'Underline', value: 'underline' },
  { label: 'Contained', value: 'contained' },
];

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus visible', pseudo: 'focus-visible' }]}
        rows={VARIANTS}
        render={(variant, col) => (
          <Tabs variant={variant} defaultValue="tokens">
            <TabsList aria-label={`${variant} ${col.label}`}>
              {/* The forced state lands on the first tab, the selected one. */}
              <Tab value="tokens">Tokens</Tab>
              <Tab value="components">Components</Tab>
              <Tab value="archived" disabled>Archived</Tab>
            </TabsList>
          </Tabs>
        )}
      />
      <Specimen label="Sizes">
        <Tabs size="sm" defaultValue="a">
          <TabsList aria-label="Diff view small">
            <Tab value="a">Unified</Tab>
            <Tab value="b">Split</Tab>
          </TabsList>
        </Tabs>
        <Tabs size="sm" variant="contained" defaultValue="a">
          <TabsList aria-label="Theme preview small">
            <Tab value="a">Light</Tab>
            <Tab value="b">Dark</Tab>
          </TabsList>
        </Tabs>
      </Specimen>
      <Specimen label="Icons and counts">
        <Library defaultValue="reviews" />
      </Specimen>
      <Specimen label="Vertical">
        <Library defaultValue="components" orientation="vertical" />
      </Specimen>
    </SpecimenStack>
  ),
};
