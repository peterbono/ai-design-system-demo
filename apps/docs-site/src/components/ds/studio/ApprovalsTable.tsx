// Settings Approvals: who approves what, one row per risk tier, as a DS Table. The tier is a neutral label that
// opens Changes filtered to that tier; approvals come from docs/GOVERNANCE.md as trusted inline markdown. On a phone
// each tier stacks as a card (narrowLayout stack), every value under its column name.
import { Link, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bridge-ds/react';

export interface ApprovalsTableProps {
  rows: { tier: number; level: string; approvalsHtml: string; example: string; href: string }[];
}

export default function ApprovalsTable({ rows }: ApprovalsTableProps) {
  return (
    <Table aria-label="Who approves what" className="set-table" narrowLayout="stack">
      <TableHeader>
        <TableRow>
          <TableHead>Tier</TableHead>
          <TableHead>Approvals required</TableHead>
          <TableHead>Example</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.tier} id={`tier-${r.tier}`}>
            <TableCell role="rowheader" label="">
              <Link variant="subtle" className="pill set-tier" href={r.href} aria-label={`Tier ${r.tier}, ${r.level} risk: open pull requests at this tier`}>
                Tier {r.tier}
              </Link>
            </TableCell>
            <TableCell label="Approvals required" dangerouslySetInnerHTML={{ __html: r.approvalsHtml }} />
            <TableCell label="Example">{r.example}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
