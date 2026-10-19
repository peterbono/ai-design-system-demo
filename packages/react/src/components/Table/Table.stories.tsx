import { useMemo, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MoreHorizontal } from 'lucide-react';
import { Badge, type BadgeTone } from '../Badge';
import { Checkbox } from '../Checkbox';
import { IconButton } from '../IconButton';
import { VisuallyHidden } from '../VisuallyHidden';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, useTableSort } from './Table';

const meta = {
  title: 'Data display/Table',
  component: Table,
  args: { caption: 'Tokens changed in this release', stickyHeader: false, gridLines: false },
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

interface Row {
  name: string;
  owner: string;
  uses: number;
  contrast: number;
  status: { tone: BadgeTone; label: string };
}

const ROWS: Row[] = [
  { name: 'color.text.default', owner: 'Design', uses: 212, contrast: 15.1, status: { tone: 'success', label: 'Published' } },
  { name: 'color.border.strong', owner: 'Design', uses: 48, contrast: 3.25, status: { tone: 'info', label: 'Changed' } },
  { name: 'color.signal.default', owner: 'Platform', uses: 31, contrast: 3.72, status: { tone: 'success', label: 'Published' } },
  { name: 'color.feedback.danger.text', owner: 'Design', uses: 19, contrast: 6.4, status: { tone: 'warning', label: 'In review' } },
  { name: 'radius.overlay', owner: 'Platform', uses: 7, contrast: 0, status: { tone: 'neutral', label: 'Draft' } },
];

type Key = 'name' | 'uses' | 'contrast';

function TokenTable({ rows = ROWS, sticky = false, maxHeight, caption = 'Tokens changed in this release' }: { rows?: Row[]; sticky?: boolean; maxHeight?: string; caption?: string }) {
  const { sort, headProps } = useTableSort<Key>({ key: 'uses', direction: 'descending' });
  const [selected, setSelected] = useState<string[]>(['color.border.strong']);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const dir = sort.direction === 'ascending' ? 1 : -1;
    return [...rows].sort((a, b) => (a[sort.key] < b[sort.key] ? -dir : a[sort.key] > b[sort.key] ? dir : 0));
  }, [rows, sort]);
  const all = rows.length > 0 && selected.length === rows.length;
  const some = selected.length > 0 && !all;
  return (
    <Table caption={caption} stickyHeader={sticky} maxHeight={maxHeight}>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Checkbox
              label={<VisuallyHidden>Select all tokens</VisuallyHidden>}
              checked={all}
              indeterminate={some}
              onCheckedChange={(c) => setSelected(c ? rows.map((r) => r.name) : [])}
            />
          </TableHead>
          <TableHead {...headProps('name')}>Token</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead numeric {...headProps('uses')}>Uses</TableHead>
          <TableHead numeric {...headProps('contrast')}>Contrast</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>
            <VisuallyHidden>Actions</VisuallyHidden>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.length === 0 && <TableEmpty colSpan={7}>No tokens changed. Changes you sync from Figma appear here.</TableEmpty>}
        {sorted.map((r) => {
          const isSelected = selected.includes(r.name);
          return (
            <TableRow key={r.name} selected={isSelected}>
              <TableCell select>
                <Checkbox
                  label={<VisuallyHidden>Select {r.name}</VisuallyHidden>}
                  checked={isSelected}
                  onCheckedChange={(c) => setSelected((s) => (c ? [...s, r.name] : s.filter((x) => x !== r.name)))}
                />
              </TableCell>
              <TableCell>
                <code>{r.name}</code>
              </TableCell>
              <TableCell>{r.owner}</TableCell>
              <TableCell numeric>{r.uses}</TableCell>
              <TableCell numeric>{r.contrast ? `${r.contrast.toFixed(2)}:1` : 'n/a'}</TableCell>
              <TableCell>
                <Badge tone={r.status.tone}>{r.status.label}</Badge>
              </TableCell>
              <TableCell numeric>
                <IconButton icon={MoreHorizontal} label={`More actions for ${r.name}`} size="sm" />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export const SortableAndSelectable: Story = { render: () => <TokenTable /> };
export const StickyHeader: Story = { render: () => <TokenTable sticky maxHeight="var(--size-60)" rows={[...ROWS, ...ROWS.map((r) => ({ ...r, name: `${r.name}-alt` }))]} /> };
/** Column widths: a fixed token width, a fraction of the table and a minimum. layout="fixed" keeps them exact. */
export const ColumnWidths: Story = {
  render: () => (
    <Table aria-label="What each kind of change needs" layout="fixed">
      <TableHeader>
        <TableRow>
          <TableHead width={0.35}>Change</TableHead>
          <TableHead>Needs</TableHead>
          <TableHead width="var(--size-20)" numeric>
            Approvals
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Token value</TableCell>
          <TableCell>A design owner approves; the visual before and after runs on every theme.</TableCell>
          <TableCell numeric>1</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>New component</TableCell>
          <TableCell>A design owner and a tech owner approve; tests and the accessibility checks pass.</TableCell>
          <TableCell numeric>2</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

/** narrowLayout="stack" in a phone-wide container: every row is a card, each value under its column name. */
export const StackedOnPhone: Story = {
  decorators: [(S) => <div style={{ width: 358, maxWidth: '100%' }}><S /></div>],
  render: () => (
    <Table caption="Tokens changed in this release" narrowLayout="stack">
      <TableHeader>
        <TableRow>
          <TableHead>Token</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead numeric>Uses</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.slice(0, 3).map((r) => (
          <TableRow key={r.name}>
            <TableCell label="">
              <code>{r.name}</code>
            </TableCell>
            <TableCell>{r.owner}</TableCell>
            <TableCell numeric>{r.uses}</TableCell>
            <TableCell>
              <Badge tone={r.status.tone}>{r.status.label}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

export const Empty: Story = { render: () => <TokenTable rows={[]} /> };

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Sortable (Uses descending), one selected row">
        <div style={{ width: '100%' }}>
          <TokenTable />
        </div>
      </Specimen>
      <Specimen label="Narrow container: the region scrolls sideways and is keyboard focusable">
        <div style={{ width: 360 }}>
          <TokenTable caption="Tokens changed in 1.3.0" />
        </div>
      </Specimen>
      <Specimen label="Empty">
        <div style={{ width: '100%' }}>
          <TokenTable rows={[]} caption="Tokens changed in 1.2.1" />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
