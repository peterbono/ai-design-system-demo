// The failing contrast checks, one row per pair and brand/theme combination, as a DS Table.
import { Link, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bridge-ds/react';

export interface ContrastFailRow {
  id: string;
  fg: string;
  bg: string;
  where: string;
  ratio: string;
  hexes: string;
  needs: string;
}

const focusHref = (path: string) => `/studio/tokens/?focus=${encodeURIComponent(path)}`;

export default function ContrastFailTable({ rows }: { rows: ContrastFailRow[] }) {
  return (
    <Table aria-label="Failing contrast checks">
      <TableHeader>
        <TableRow>
          <TableHead>Pair</TableHead>
          <TableHead>Where</TableHead>
          <TableHead numeric>Ratio</TableHead>
          <TableHead numeric>Needs</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} id={r.id}>
            <TableCell role="rowheader">
              <Link variant="standalone" href={focusHref(r.fg)} data-keep-branch="">
                {r.fg}
              </Link>
              <span className="muted small"> on </span>
              <Link variant="standalone" href={focusHref(r.bg)} data-keep-branch="">
                {r.bg}
              </Link>
            </TableCell>
            <TableCell>{r.where}</TableCell>
            <TableCell numeric>
              <strong>{r.ratio}</strong> <span className="chain">{r.hexes}</span>
            </TableCell>
            <TableCell numeric>{r.needs}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
