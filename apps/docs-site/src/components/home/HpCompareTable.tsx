// One comparison table of "How Bridge compares." (homepage): the DS Table, a sticky feature column, and a check or a
// dash per tool. Rendered statically by HpCompare.astro (short table) and inside the HpCompareMore island (every
// feature, by group). Words and data: lib/compare-home.ts. Styles: styles/home-compare.css.
import { Icon, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, VisuallyHidden } from '@bridge-ds/react';
import { Check, Minus } from 'lucide-react';
import { NO, TOOLS, YES, type HomeGroup, type HomeRow } from '../../lib/compare-home';

/** The glyph for a check (true) and a dash (false), shared with the legend. */
export const markIcon = (yes: boolean) => (yes ? Check : Minus);

function Mark({ yes }: { yes: boolean }) {
  return (
    <span className="hp-cmp-mark" data-state={yes ? 'yes' : 'no'}>
      <Icon icon={markIcon(yes)} size="md" className="hp-cmp-icon" />
      <VisuallyHidden>{yes ? YES : NO}</VisuallyHidden>
    </span>
  );
}

function Row({ row }: { row: HomeRow }) {
  return (
    <TableRow className="hp-cmp-row">
      <TableHead scope="row" className="hp-cmp-c hp-cmp-feat">
        {row.feature}
        {row.detail && <small className="hp-cmp-detail">{row.detail}</small>}
      </TableHead>
      {row.cells.map((yes, i) => (
        <TableCell key={TOOLS[i]} className={i === 0 ? 'hp-cmp-c hp-cmp-b' : 'hp-cmp-c'}>
          <Mark yes={yes} />
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
  rows?: HomeRow[];
  /** ...or rows under group headings (every feature). */
  groups?: HomeGroup[];
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
