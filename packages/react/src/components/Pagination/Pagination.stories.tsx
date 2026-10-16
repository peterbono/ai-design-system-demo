import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Pagination } from './Pagination';

const meta = {
  title: 'Navigation/Pagination',
  component: Pagination,
  args: { pageCount: 12, defaultPage: 6, siblingCount: 1, variant: 'full', size: 'md' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['full', 'compact'] },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
  },
} satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Compact: Story = { args: { variant: 'compact' } };
export const Controlled: Story = {
  render: (args) => {
    const [page, setPage] = useState(1);
    return <Pagination {...args} page={page} onPageChange={setPage} />;
  },
};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus visible', pseudo: 'focus-visible' }]}
        rows={[{ label: 'Previous', value: 'previous' }]}
        render={(_, col) => (
          <Pagination aria-label={`Pagination ${col.label}`} pageCount={3} defaultPage={3} />
        )}
      />
      <Specimen label="First page (previous disabled)">
        <Pagination aria-label="First page" pageCount={12} defaultPage={1} />
      </Specimen>
      <Specimen label="Middle page (two ellipses)">
        <Pagination aria-label="Middle page" pageCount={48} defaultPage={24} />
      </Specimen>
      <Specimen label="Last page, size sm">
        <Pagination aria-label="Last page" pageCount={12} defaultPage={12} size="sm" />
      </Specimen>
      <Specimen label="Compact">
        <Pagination aria-label="Compact" variant="compact" pageCount={12} defaultPage={3} />
      </Specimen>
    </SpecimenStack>
  ),
};
