// "Compare all 4" view of one group on the Accessibility page: rows are pairs, columns are brand x theme combos,
// cells are the ratio and a small status mark (a dot for a pass, an alert icon for a failure, with the status in
// text for screen readers). A .tsx component because Astro wraps React children in <astro-static-slot>, which is not
// valid inside <table>. Rendered statically; the page script marks the current combo's cells with data-on, and below
// 640px only that column shows.
import { Icon, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, VisuallyHidden } from '@bridge-ds/react';
import { CircleAlert } from 'lucide-react';
import type { Status } from '../../lib/a11y-checks';

export interface MatrixCombo {
  key: string;
  label: string;
}

export interface MatrixRow {
  id: string;
  /** `text.default on bg.default` */
  name: string;
  cells: { key: string; ratio: string; status: Status; label: string; title: string }[];
}

export default function ContrastMatrix({ label, combos, rows }: { label: string; combos: MatrixCombo[]; rows: MatrixRow[] }) {
  return (
    <Table aria-label={`${label}: contrast ratio in every brand and theme`} className="ds-a11y-matrix">
      <TableHeader>
        <TableRow>
          <TableHead>Pair</TableHead>
          {combos.map((c) => (
            <TableHead key={c.key} data-c={c.key}>
              {c.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableHead scope="row">{r.name}</TableHead>
            {r.cells.map((c) => (
              <TableCell key={c.key} data-c={c.key} data-s={c.status} title={c.title}>
                <span className="a11y-cell">
                  {c.status === 'fail' ? <Icon icon={CircleAlert} size="xs" className="a11y-mark" /> : <span className="a11y-mark" aria-hidden="true" />}
                  <span className="num">{c.ratio}</span>
                  <VisuallyHidden>{c.label}</VisuallyHidden>
                </span>
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
