// The "Motion and interaction" table of a component page, like the Props table: rendered entirely in React with the
// DS Table parts (Astro cannot nest table parts from an .astro file). Static, no client JS. Data: lib/motion-docs.ts.
import { Link, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bridge-ds/react';
import type { MotionRow, MotionValue } from '../../lib/motion-docs';

const ownTokenHref = (path: string) => `/tokens/?t=${encodeURIComponent(path)}`;

function Value({ v, tokenHref }: { v: MotionValue; tokenHref: (path: string) => string }) {
  return (
    <span className="motion-value">
      {v.token && (
        <Link variant="subtle" href={tokenHref(v.token)}>
          <code>{v.token}</code>
        </Link>
      )}
      <span className={v.token ? 'muted' : undefined}>{v.value}</span>
    </span>
  );
}

/** `tokenHref`: where a motion token opens (a team's Library passes its own All tokens page). */
export default function MotionTable({ component, rows, showPart, tokenHref = ownTokenHref }: { component: string; rows: MotionRow[]; showPart: boolean; tokenHref?: (path: string) => string }) {
  return (
    <Table aria-label={`${component} motion`} className="motion-table">
      <TableHeader>
        <TableRow>
          {showPart && <TableHead>Part</TableHead>}
          <TableHead>When</TableHead>
          <TableHead>What changes</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Easing</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={`${r.part ?? ''}|${r.when}|${i}`}>
            {showPart && <TableCell>{r.part}</TableCell>}
            <TableHead scope="row">{r.when}</TableHead>
            <TableCell>{r.what}</TableCell>
            <TableCell>
              <Value tokenHref={tokenHref} v={r.duration} />
            </TableCell>
            <TableCell>{r.easing ? <Value tokenHref={tokenHref} v={r.easing} /> : <span className="muted">Part of the loop</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
