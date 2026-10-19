// Studio Adoption: the static table of an audit report (hard-coded values by category), as a DS Table.
// The Adoption page formats every value; these only lay them out. Row headers use role="rowheader". On a phone each
// row stacks as a card (narrowLayout="stack"), every value beside its column name: label on each cell, since the page
// is static and the Table cannot copy the header text without JavaScript.
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bridge-ds/react';
import type { CategoryRow } from '../../../lib/audits';

const share = (n: number, max: number) => `${max ? (n / max) * 100 : 0}%`;

/** Hard-coded values per category: a share bar (exact, near and no token) and the counts. */
export function HardcodedCategoriesTable({ rows }: { rows: CategoryRow[] }) {
  const max = Math.max(1, ...rows.map((c) => c.hardcoded));
  return (
    <Table narrowLayout="stack" aria-label="Hard-coded values per category, split by how well a token matches">
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead width={0.4} minWidth="calc(var(--size-64) / 2)">
            Share
          </TableHead>
          <TableHead numeric>Values</TableHead>
          <TableHead numeric>Exact</TableHead>
          <TableHead numeric>Near</TableHead>
          <TableHead numeric>None</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((c) => (
          <TableRow key={c.key}>
            <TableCell role="rowheader" label="">
              {c.label}
            </TableCell>
            <TableCell label="Share">
              <span className="ad-track" style={{ width: share(c.hardcoded, max) }}>
                {c.exact > 0 && <span className="ad-seg ad-exact" style={{ width: share(c.exact, c.hardcoded) }} />}
                {c.near > 0 && <span className="ad-seg ad-near" style={{ width: share(c.near, c.hardcoded) }} />}
                {c.none > 0 && <span className="ad-seg ad-none" style={{ width: share(c.none, c.hardcoded) }} />}
              </span>
            </TableCell>
            <TableCell numeric label="Values">
              {c.hardcoded}
            </TableCell>
            <TableCell numeric label="Exact">
              {c.exact}
            </TableCell>
            <TableCell numeric label="Near">
              {c.near}
            </TableCell>
            <TableCell numeric label="None">
              {c.none}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
