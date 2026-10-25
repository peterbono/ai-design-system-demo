import type { Meta, StoryObj } from '@storybook/react-vite';
import { Table, TableBody, TableEmpty, TableHead, TableHeader, TableRow } from './Table';

// Figma variant of the TableEmpty set: the empty row inside a table, so the Storybook measure (bridge specs --measure)
// finds it. The text is the set's default.

const meta = {
  title: 'Figma variants/TableEmpty',
  args: { label: 'TableEmpty' },
  argTypes: { label: { control: 'text' } },
  render: ({ label }) => (
    <Table aria-label="Empty table">
      <TableHeader>
        <TableRow>
          <TableHead>Token</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableEmpty colSpan={1}>{label}</TableEmpty>
      </TableBody>
    </Table>
  ),
} satisfies Meta<{ label: string }>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
