// A table from docs/*.md as a DS Table: header cells as text, body cells as trusted inline markdown (rendered from
// the repo at build time). The first cell of each row is its row header.
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bridge-ds/react';

export interface MarkdownTableProps {
  label: string;
  head: string[];
  /** Each row: cells as HTML (inline markdown). */
  rows: string[][];
  /** Optional id per row, for anchors (tier-1). */
  rowIds?: string[];
  className?: string;
}

export default function MarkdownTable({ label, head, rows, rowIds, className }: MarkdownTableProps) {
  return (
    <Table aria-label={label} className={className}>
      <TableHeader>
        <TableRow>
          {head.map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={i} id={rowIds?.[i]}>
            {row.map((cell, j) => (
              <TableCell key={j} role={j === 0 ? 'rowheader' : undefined} dangerouslySetInnerHTML={{ __html: cell }} />
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
