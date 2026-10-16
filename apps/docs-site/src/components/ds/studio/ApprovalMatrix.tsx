// Settings Governance: who approves what, by area, as a DS Table. Cells come from docs/GOVERNANCE.md; the first
// column is already rendered inline markdown (trusted, from the repo at build time).
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bridge-ds/react';
import { Check } from 'lucide-react';

export interface ApprovalMatrixProps {
  head: string[];
  /** Each row: first cell as HTML (inline markdown), then plain cells. */
  rows: { areaHtml: string; cells: string[] }[];
}

export default function ApprovalMatrix({ head, rows }: ApprovalMatrixProps) {
  return (
    <Table aria-label="Approvals by area">
      <TableHeader>
        <TableRow>
          {head.map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={i}>
            <TableCell role="rowheader" dangerouslySetInnerHTML={{ __html: row.areaHtml }} />
            {row.cells.map((cell, j) => (
              <TableCell key={j}>
                {cell === 'Approves' ? (
                  <Badge size="sm" tone="success" icon={Check}>
                    Approves
                  </Badge>
                ) : (
                  <Badge size="sm" tone="neutral">
                    {cell}
                  </Badge>
                )}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
