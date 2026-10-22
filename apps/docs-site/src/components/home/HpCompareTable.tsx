// One comparison table of "How Bridge compares." (homepage): the DS Table, a sticky feature column, and a mark per tool:
// a check (does it), a half mark (does part of it) or a dash (does not, or not documented). A mark with a note is a
// ghost DS IconButton whose Tooltip says how; its accessible name carries the same words. Hydrated by HpCompare.astro
// (short table) and inside the HpCompareMore island (every feature, by group). Words and data: lib/compare.ts.
// Styles: styles/home-compare.css.
import { Icon, IconButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tooltip, VisuallyHidden } from '@bridge-ds/react';
import { Check, Contrast, Minus } from 'lucide-react';
import { STATE_LABEL, TOOLS, cellText, type Cell, type CellState, type CompareGroup, type CompareRow } from '../../lib/compare';

/** The glyph for each state, shared with the legend. */
export const MARK_ICON: Record<CellState, typeof Check> = { yes: Check, partial: Contrast, no: Minus };

function Mark({ cell, tool }: { cell: Cell; tool: string }) {
  if (cell.note) {
    return (
      <Tooltip content={cell.note}>
        <IconButton
          icon={MARK_ICON[cell.state]}
          label={`${tool}, ${cellText(cell)}`}
          variant="ghost"
          size="sm"
          className="hp-cmp-mark hp-cmp-tip"
          data-state={cell.state}
        />
      </Tooltip>
    );
  }
  return (
    <span className="hp-cmp-mark" data-state={cell.state}>
      <Icon icon={MARK_ICON[cell.state]} size="md" className="hp-cmp-icon" />
      <VisuallyHidden>{STATE_LABEL[cell.state]}</VisuallyHidden>
    </span>
  );
}

function Row({ row }: { row: CompareRow }) {
  return (
    <TableRow className="hp-cmp-row">
      <TableHead scope="row" className="hp-cmp-c hp-cmp-feat">
        {row.feature}
        {row.detail && <small className="hp-cmp-detail">{row.detail}</small>}
      </TableHead>
      {row.cells.map((cell, i) => (
        <TableCell key={TOOLS[i]} className={i === 0 ? 'hp-cmp-c hp-cmp-b' : 'hp-cmp-c'}>
          <Mark cell={cell} tool={TOOLS[i]} />
        </TableCell>
      ))}
    </TableRow>
  );
}

export interface HpCompareTableProps {
  /** Names the scroll region and the table. */
  label: string;
  /** Text of the feature column head. */
  firstHead: string;
  /** Plain rows (the short table)... */
  rows?: CompareRow[];
  /** ...or rows under group headings (every feature). */
  groups?: CompareGroup[];
}

export default function HpCompareTable({ label, firstHead, rows, groups }: HpCompareTableProps) {
  return (
    <Table aria-label={label} layout="fixed" className="hp-cmp-table">
      <TableHeader>
        <TableRow>
          <TableHead scope="col" className="hp-cmp-c hp-cmp-feat hp-cmp-h0">
            {firstHead}
          </TableHead>
          {TOOLS.map((t, i) => (
            <TableHead key={t} scope="col" className={i === 0 ? 'hp-cmp-c hp-cmp-tool hp-cmp-b hp-cmp-bh' : 'hp-cmp-c hp-cmp-tool'}>
              {t}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      {rows && (
        <TableBody>
          {rows.map((r) => (
            <Row key={r.feature} row={r} />
          ))}
        </TableBody>
      )}
      {groups?.map((g) => (
        <TableBody key={g.name}>
          <TableRow className="hp-cmp-group">
            <TableHead scope="rowgroup" className="hp-cmp-c hp-cmp-feat hp-cmp-gh">
              {g.name}
            </TableHead>
            <TableCell className="hp-cmp-c hp-cmp-b" />
            <TableCell className="hp-cmp-c" colSpan={TOOLS.length - 1} />
          </TableRow>
          {g.rows.map((r) => (
            <Row key={r.feature} row={r} />
          ))}
        </TableBody>
      ))}
    </Table>
  );
}
