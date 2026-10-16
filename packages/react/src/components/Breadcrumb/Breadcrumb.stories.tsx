import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Breadcrumb } from './Breadcrumb';

const PATH = [
  { label: 'Library', href: '#library' },
  { label: 'Components', href: '#components' },
  { label: 'Forms', href: '#forms' },
  { label: 'Input', href: '#input' },
  { label: 'Accessibility' },
];

const meta = {
  title: 'Navigation/Breadcrumb',
  component: Breadcrumb,
  tags: ['autodocs'],
  args: { items: PATH.slice(1) },
} satisfies Meta<typeof Breadcrumb>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Collapsed: Story = { args: { items: PATH, maxItems: 3 } };
export const LongLabels: Story = {
  args: {
    items: [
      { label: 'Tokens', href: '#tokens' },
      { label: 'color.feedback.warning.border-subtle-hover', href: '#t' },
      { label: 'History of changes for this token across every release' },
    ],
  },
};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus visible', pseudo: 'focus-visible' }]}
        rows={[{ label: 'Link', value: 'link' }]}
        render={(_, col) => <Breadcrumb aria-label={`Breadcrumb ${col.label}`} items={PATH.slice(1, 4)} />}
      />
      <Specimen label="Collapsed (maxItems 3)">
        <Breadcrumb aria-label="Collapsed breadcrumb" items={PATH} maxItems={3} />
      </Specimen>
      <Specimen label="Long labels truncate">
        <Breadcrumb
          aria-label="Long breadcrumb"
          items={[
            { label: 'Tokens', href: '#tokens' },
            { label: 'color.feedback.warning.border-subtle-hover', href: '#t' },
            { label: 'History of changes for this token across every release' },
          ]}
        />
      </Specimen>
    </SpecimenStack>
  ),
};
