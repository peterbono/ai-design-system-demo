import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Checkbox } from '../Checkbox';
import { VisuallyHidden } from '../VisuallyHidden';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, useTableSort } from './Table';

const ROWS = [
  { name: 'color.text.default', uses: 212 },
  { name: 'color.border.strong', uses: 48 },
];

function Example() {
  const { headProps } = useTableSort<'name' | 'uses'>();
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <Table caption="Tokens in this release">
      <TableHeader>
        <TableRow>
          <TableHead>
            <VisuallyHidden>Select</VisuallyHidden>
          </TableHead>
          <TableHead {...headProps('name')}>Token</TableHead>
          <TableHead numeric {...headProps('uses')}>Uses</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map((r) => (
          <TableRow key={r.name} selected={selected.includes(r.name)}>
            <TableCell select>
              <Checkbox
                label={<VisuallyHidden>Select {r.name}</VisuallyHidden>}
                checked={selected.includes(r.name)}
                onCheckedChange={(c) => setSelected((s) => (c ? [...s, r.name] : s.filter((x) => x !== r.name)))}
              />
            </TableCell>
            <TableCell>{r.name}</TableCell>
            <TableCell numeric>{r.uses}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

describe('Table', () => {
  it('wraps the table in a focusable region named by the caption', async () => {
    render(<Example />);
    const region = screen.getByRole('region', { name: 'Tokens in this release' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(within(region).getByRole('table', { name: 'Tokens in this release' })).toBeInTheDocument();
  });

  it('sortable header cycles aria-sort ascending, descending, none', async () => {
    render(<Example />);
    const header = screen.getByRole('columnheader', { name: /Token/ });
    const button = within(header).getByRole('button', { name: /Token/ });
    expect(header).not.toHaveAttribute('aria-sort');
    await userEvent.click(button);
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(button);
    expect(header).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(button);
    expect(header).not.toHaveAttribute('aria-sort');
    await userEvent.click(button);
    await userEvent.click(within(screen.getByRole('columnheader', { name: /Uses/ })).getByRole('button'));
    expect(header).not.toHaveAttribute('aria-sort');
    expect(screen.getByRole('columnheader', { name: /Uses/ })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('checking a row checkbox sets aria-selected on the row', async () => {
    render(<Example />);
    const checkbox = screen.getByRole('checkbox', { name: 'Select color.border.strong' });
    const row = checkbox.closest('tr')!;
    expect(row).toHaveAttribute('aria-selected', 'false');
    await userEvent.click(checkbox);
    expect(row).toHaveAttribute('aria-selected', 'true');
  });

  it('empty row spans all columns', () => {
    render(
      <Table aria-label="Pull requests">
        <TableBody>
          <TableEmpty colSpan={3}>No pull requests yet.</TableEmpty>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole('cell', { name: 'No pull requests yet.' })).toHaveAttribute('colspan', '3');
  });

  it('has no axe violations', async () => {
    render(<Example />);
    await expectNoAxeViolations();
  });
});
